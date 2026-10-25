//! Writing frames and recordings to disk.
//!
//! The webview can only hand us base64, so both paths land here: `save_data_url`
//! for canvas captures and `write_chunk` for MediaRecorder output (streamed in
//! pieces so a long clip never becomes one giant IPC message).

use std::fs::OpenOptions;
use std::io::Write;

fn val(c: u8) -> Option<u8> {
    match c {
        b'A'..=b'Z' => Some(c - b'A'),
        b'a'..=b'z' => Some(c - b'a' + 26),
        b'0'..=b'9' => Some(c - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Minimal base64 decoder: ignores whitespace/padding, rejects stray bytes.
pub fn b64_decode(text: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(text.len() / 4 * 3);
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    for &c in text.as_bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c).ok_or_else(|| "invalid base64 payload".to_string())? as u32;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Ok(out)
}

fn ensure_parent(path: &str) -> Result<(), String> {
    if let Some(dir) = std::path::Path::new(path).parent() {
        if !dir.as_os_str().is_empty() && !dir.exists() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Write a `data:image/jpeg;base64,…` payload to a real file.
#[tauri::command]
pub fn save_data_url(path: String, data_url: String) -> Result<String, String> {
    let payload = data_url
        .split_once(',')
        .map(|(_, b)| b)
        .ok_or_else(|| "nothing to save".to_string())?;
    let bytes = b64_decode(payload)?;
    if bytes.is_empty() {
        return Err("nothing to save".into());
    }
    ensure_parent(&path)?;
    std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Append (or start) a recording chunk. Returns the file size so far.
#[tauri::command]
pub fn write_chunk(path: String, data_b64: String, append: bool) -> Result<u64, String> {
    let bytes = b64_decode(&data_b64)?;
    ensure_parent(&path)?;
    let mut file = if append {
        OpenOptions::new().append(true).create(true).open(&path)
    } else {
        std::fs::File::create(&path)
    }
    .map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0))
}

/// Last-resort frame grab with FFmpeg, for sources the canvas refuses to read.
#[tauri::command]
pub async fn save_frame(path: String, seconds: f64, dest: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        ensure_parent(&dest)?;
        let at = format!("{seconds:.3}");
        let out = crate::tools::run_hidden(crate::ffmpeg::ffmpeg().args([
            "-y",
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-ss",
            at.as_str(),
            "-i",
            path.as_str(),
            "-frames:v",
            "1",
            "-q:v",
            "2",
            dest.as_str(),
        ]))?;
        if !out.status.success() {
            return Err("could not grab this frame".to_string());
        }
        Ok(dest)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn pictures_dir(app: tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    app.path()
        .picture_dir()
        .ok()
        .map(|p| p.display().to_string())
        .or_else(|| {
            app.path()
                .document_dir()
                .ok()
                .map(|p| p.display().to_string())
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_padded_and_padded_free() {
        assert_eq!(b64_decode("aGk=").unwrap(), b"hi");
        assert_eq!(b64_decode("aGk").unwrap(), b"hi");
        assert_eq!(b64_decode("aGVsbG8=").unwrap(), b"hello");
        assert_eq!(b64_decode("").unwrap(), b"");
    }

    #[test]
    fn rejects_garbage() {
        assert!(b64_decode("!!!!").is_err());
    }

    #[test]
    fn alphabet_is_complete() {
        assert_eq!(val(b'A'), Some(0));
        assert_eq!(val(b'z'), Some(51));
        assert_eq!(val(b'0'), Some(52));
        assert_eq!(val(b'/'), Some(63));
    }
}

// ---------- folders and playlists ----------

/// Extensions G9 will queue from a folder drop or *Open folder…*.
pub const VIDEO_EXT: &[&str] = &[
    "mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "mpg", "mpeg", "m2ts", "mts", "ts",
    "ogv", "3gp", "m3u8",
];

/// True when the file name looks like something `<video>` can open.
pub fn is_video(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit_once('.').map(|(_, e)| e).unwrap_or("");
    VIDEO_EXT.contains(&ext)
}

/// One file from a folder.
#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct FolderItem {
    pub name: String,
    pub path: String,
}

/// Video files directly inside `path`, sorted the way Explorer sorts them.
pub fn videos_in(path: &str) -> Result<Vec<FolderItem>, String> {
    let dir = std::path::Path::new(path);
    if !dir.is_dir() {
        return Err("That folder is not there any more".into());
    }
    let mut items: Vec<FolderItem> = std::fs::read_dir(dir)
        .map_err(|_| "Could not read that folder".to_string())?
        .flatten()
        .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            is_video(&name).then(|| FolderItem {
                path: e.path().display().to_string(),
                name,
            })
        })
        .collect();
    items.sort_by_key(|a| natural_key(&a.name));
    items.truncate(2000);
    Ok(items)
}

/// Case-insensitive, digit-aware sort key, so `Ep 2` comes before `Ep 10`.
fn natural_key(name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut num = String::new();
    let mut word = String::new();
    for ch in name.chars() {
        if ch.is_ascii_digit() {
            if !word.is_empty() {
                out.push(word.to_ascii_lowercase());
                word.clear();
            }
            num.push(ch);
        } else {
            if !num.is_empty() {
                let n: u64 = num.parse().unwrap_or(0);
                out.push(format!("\u{0}{n:020}"));
                num.clear();
            }
            word.push(ch);
        }
    }
    if !word.is_empty() {
        out.push(word.to_ascii_lowercase());
    }
    if !num.is_empty() {
        let n: u64 = num.parse().unwrap_or(0);
        out.push(format!("\u{0}{n:020}"));
    }
    out
}

/// Read a small text file (a dropped `.srt`, for instance) over IPC.
#[tauri::command]
pub fn read_text(path: String) -> Result<String, String> {
    const CAP: u64 = 4 * 1024 * 1024;
    let meta =
        std::fs::metadata(&path).map_err(|_| "That file is not there any more".to_string())?;
    if !meta.is_file() {
        return Err("That is a folder, not a file".into());
    }
    if meta.len() > CAP {
        return Err("That file is too big to read".into());
    }
    std::fs::read_to_string(&path).map_err(|_| "Could not read that file".to_string())
}

/// Scan a folder for playable files.
#[tauri::command]
pub fn list_folder(path: String) -> Result<Vec<FolderItem>, String> {
    videos_in(&path)
}

/// One row of the player queue, as written to an `.m3u8`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub struct PlayEntry {
    pub title: String,
    pub url: String,
}

impl PlayEntry {
    fn clean(&self) -> PlayEntry {
        let title = self.title.replace(['\r', '\n'], " ").trim().to_string();
        PlayEntry {
            title: if title.is_empty() {
                self.url.clone()
            } else {
                title
            },
            url: self.url.trim().to_string(),
        }
    }
}

/// Render a queue as M3U8 text.
pub fn playlist_text(entries: &[PlayEntry]) -> String {
    let mut out = String::from("#EXTM3U\n");
    for e in entries {
        let e = e.clean();
        if e.url.is_empty() {
            continue;
        }
        out.push_str("#EXTINF:-1,");
        out.push_str(&e.title);
        out.push('\n');
        out.push_str(&e.url);
        out.push('\n');
    }
    out
}

/// Read an M3U/M3U8 back into queue rows.
pub fn parse_playlist(text: &str) -> Vec<PlayEntry> {
    let mut out = Vec::new();
    let mut title = String::new();
    for raw in text.lines() {
        let line = raw.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        if let Some(rest) = line.strip_prefix("#EXTINF:") {
            title = rest
                .split_once(',')
                .map(|(_, t)| t.trim().to_string())
                .unwrap_or_default();
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        out.push(PlayEntry {
            title: if title.is_empty() {
                line.rsplit(['/', '\\']).next().unwrap_or(line).to_string()
            } else {
                title.clone()
            },
            url: line.to_string(),
        });
        title.clear();
    }
    out.truncate(5000);
    out
}

/// Write the player queue as an `.m3u8`. Returns how many rows were written.
#[tauri::command]
pub fn playlist_save(path: String, entries: Vec<PlayEntry>) -> Result<usize, String> {
    let text = playlist_text(&entries);
    let count = text.matches("#EXTINF").count();
    if count == 0 {
        return Err("The playlist is empty".into());
    }
    ensure_parent(&path)?;
    std::fs::write(&path, text).map_err(|_| "Could not write that playlist".to_string())?;
    Ok(count)
}

/// Read an `.m3u8` into the player queue.
#[tauri::command]
pub fn playlist_load(path: String) -> Result<Vec<PlayEntry>, String> {
    let text =
        std::fs::read_to_string(&path).map_err(|_| "Could not read that playlist".to_string())?;
    let items = parse_playlist(&text);
    if items.is_empty() {
        return Err("That playlist has nothing to play".into());
    }
    Ok(items)
}

#[cfg(test)]
mod playlist_tests {
    use super::*;

    #[test]
    fn video_extensions() {
        assert!(is_video("Movie.MKV"));
        assert!(is_video("clip.mp4"));
        assert!(is_video("show.m3u8"));
        assert!(!is_video("notes.txt"));
        assert!(!is_video("no-extension"));
    }

    #[test]
    fn natural_order() {
        let mut names = vec!["Ep 10.mp4", "Ep 2.mp4", "Ep 1.mp4"];
        names.sort_by_key(|a| natural_key(a));
        assert_eq!(names, vec!["Ep 1.mp4", "Ep 2.mp4", "Ep 10.mp4"]);
    }

    #[test]
    fn playlist_round_trip() {
        let entries = vec![
            PlayEntry {
                title: "One".into(),
                url: "https://example.test/1.m3u8".into(),
            },
            PlayEntry {
                title: "Two, with a comma".into(),
                url: "C:\\media\\2.mkv".into(),
            },
        ];
        let text = playlist_text(&entries);
        assert!(text.starts_with("#EXTM3U"));
        let back = parse_playlist(&text);
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].url, "https://example.test/1.m3u8");
        assert_eq!(back[1].title, "Two, with a comma");
        assert_eq!(back[1].url, "C:\\media\\2.mkv");
    }

    #[test]
    fn plain_url_list_is_readable() {
        let back = parse_playlist("https://a.test/x.mp4\nhttps://a.test/y.mp4\n");
        assert_eq!(back.len(), 2);
        assert_eq!(back[1].title, "y.mp4");
    }
}

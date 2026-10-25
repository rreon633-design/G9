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

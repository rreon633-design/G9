//! Managed FFmpeg: download a static build into app data and use it before PATH.
//!
//! G9 does not ship FFmpeg inside the installer (that would add ~100 MB to a
//! "lightweight Windows player"). Instead the user can fetch it once from
//! Settings → FFmpeg, and every tool then prefers the managed copy.

#[cfg(windows)]
use std::io::{Read, Write};
#[cfg(windows)]
use std::path::Path;
use std::path::PathBuf;
use std::sync::OnceLock;
#[cfg(windows)]
use std::time::Duration;

use serde::Serialize;
#[cfg(windows)]
use tauri::Emitter;
use tauri::{AppHandle, Manager};

static BIN_DIR: OnceLock<PathBuf> = OnceLock::new();

/// Static Windows build (GPL, no installer). Downloaded only on request.
pub const WIN_ZIP: &str =
    "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";

#[cfg(windows)]
pub const PROGRESS_EVENT: &str = "ffmpeg-progress";

#[derive(Debug, Clone, Serialize)]
pub struct Status {
    /// A working `ffmpeg -version` exists (managed or PATH).
    pub available: bool,
    /// The copy in app data exists.
    pub managed: bool,
    pub ffmpeg: Option<String>,
    pub ffprobe: Option<String>,
    pub dir: Option<String>,
    pub version: Option<String>,
}

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_data_dir() {
        let bin = dir.join("ffmpeg");
        let _ = std::fs::create_dir_all(&bin);
        let _ = BIN_DIR.set(bin);
    }
}

pub fn dir() -> Option<PathBuf> {
    BIN_DIR.get().cloned()
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

fn managed(name: &str) -> Option<PathBuf> {
    let p = dir()?.join(exe(name));
    p.is_file().then_some(p)
}

/// `ffmpeg` command: managed binary if installed, else whatever PATH has.
pub fn ffmpeg() -> std::process::Command {
    match managed("ffmpeg") {
        Some(p) => std::process::Command::new(p),
        None => std::process::Command::new("ffmpeg"),
    }
}

pub fn ffprobe() -> std::process::Command {
    match managed("ffprobe") {
        Some(p) => std::process::Command::new(p),
        None => std::process::Command::new("ffprobe"),
    }
}

fn version_of(cmd: &mut std::process::Command) -> Option<String> {
    let out = crate::tools::run_hidden(cmd.arg("-version")).ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().next().map(|l| l.trim().to_string())
}

pub fn status() -> Status {
    let ff = managed("ffmpeg");
    let fp = managed("ffprobe");
    let version = version_of(&mut ffmpeg());
    Status {
        available: version.is_some(),
        managed: ff.is_some() && fp.is_some(),
        ffmpeg: ff.map(|p| p.display().to_string()),
        ffprobe: fp.map(|p| p.display().to_string()),
        dir: dir().map(|p| p.display().to_string()),
        version,
    }
}

/// Download + unpack the static build into app data.
pub fn install(app: &AppHandle) -> Result<Status, String> {
    install_inner(app)
}

#[cfg(not(windows))]
fn install_inner(_app: &AppHandle) -> Result<Status, String> {
    Err(
        "The managed FFmpeg download is Windows-only. Install ffmpeg with your package manager."
            .into(),
    )
}

#[cfg(windows)]
fn install_inner(app: &AppHandle) -> Result<Status, String> {
    let dir = dir().ok_or("app data directory unavailable")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip_path = dir.join("ffmpeg-download.zip");
    download(app, WIN_ZIP, &zip_path)?;

    let file = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive =
        zip::ZipArchive::new(std::io::BufReader::new(file)).map_err(|e| format!("bad zip: {e}"))?;
    let mut found = 0u32;
    for i in 0..archive.len() {
        let mut entry = match archive.by_index(i) {
            Ok(e) => e,
            Err(_) => continue,
        };
        if entry.is_dir() {
            continue;
        }
        let name = entry
            .name()
            .rsplit('/')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        if name == "ffmpeg.exe" || name == "ffprobe.exe" {
            let dest = dir.join(&name);
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            found += 1;
        }
    }
    let _ = std::fs::remove_file(&zip_path);
    if found < 2 {
        return Err("archive did not contain ffmpeg.exe and ffprobe.exe".into());
    }
    let st = status();
    if !st.available {
        return Err("ffmpeg.exe was extracted but does not run".into());
    }
    Ok(st)
}

#[cfg(windows)]
fn download(app: &AppHandle, url: &str, dest: &Path) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(1800))
        .user_agent(g9_core::USER_AGENT)
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 256 * 1024];
    let mut got: u64 = 0;
    let mut last_pct = 101u32;
    loop {
        let n = resp.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        let pct = if total > 0 {
            ((got * 100) / total) as u32
        } else {
            0
        };
        if pct != last_pct {
            last_pct = pct;
            let _ = app.emit(PROGRESS_EVENT, pct);
        }
    }
    if got == 0 {
        return Err("empty download".into());
    }
    Ok(())
}

pub fn remove() -> Result<Status, String> {
    let dir = dir().ok_or("app data directory unavailable")?;
    for name in ["ffmpeg", "ffprobe"] {
        let p = dir.join(exe(name));
        if p.is_file() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
        }
    }
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exe_suffix_matches_platform() {
        let name = exe("ffmpeg");
        assert!(name.starts_with("ffmpeg"));
        if cfg!(windows) {
            assert!(name.ends_with(".exe"));
        }
    }
}

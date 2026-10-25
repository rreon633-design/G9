//! Extra player windows + the system power timer.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Open another player window. `src` is the media URL the popup should start with.
pub fn open(app: &AppHandle, src: Option<String>, title: Option<String>) -> Result<String, String> {
    let existing = app.webview_windows();
    let mut n = existing.len() + 1;
    let mut label = format!("player-{n}");
    while existing.contains_key(&label) {
        n += 1;
        label = format!("player-{n}");
    }
    let mut route = String::from("index.html?popup=1");
    if let Some(s) = src.filter(|s| !s.trim().is_empty()) {
        route.push_str("&src=");
        route.push_str(&encode(&s));
    }
    WebviewWindowBuilder::new(app, label.clone(), WebviewUrl::App(route.into()))
        .title(title.unwrap_or_else(|| "G9 — player".into()))
        .inner_size(960.0, 560.0)
        .min_inner_size(480.0, 300.0)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(label)
}

fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b':' | b'/' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[tauri::command]
pub fn open_player_window(
    app: AppHandle,
    src: Option<String>,
    title: Option<String>,
) -> Result<String, String> {
    open(&app, src, title)
}

#[tauri::command]
pub fn schedule_pc_shutdown(seconds: u32) -> Result<String, String> {
    let secs = seconds.clamp(10, 86_400);
    if cfg!(windows) {
        let out = crate::tools::run_hidden(std::process::Command::new("shutdown").args([
            "/s",
            "/t",
            &secs.to_string(),
            "/c",
            "G9 sleep timer",
        ]))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok(format!("Windows will shut down in {secs} s"))
    } else {
        Err("PC shutdown is wired for Windows only".into())
    }
}

#[tauri::command]
pub fn cancel_pc_shutdown() -> Result<String, String> {
    if cfg!(windows) {
        let out = crate::tools::run_hidden(std::process::Command::new("shutdown").arg("/a"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).into_owned());
        }
        Ok("Shutdown cancelled".into())
    } else {
        Err("PC shutdown is wired for Windows only".into())
    }
}

/// User shaders: `<app data>/shaders/*.frag` (or `.glsl`), small text files.
pub fn list_shaders(app: &AppHandle) -> Vec<Shader> {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d.join("shaders"),
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|e| e.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if ext != "frag" && ext != "glsl" {
                continue;
            }
            if entry
                .metadata()
                .map(|m| m.len() > 64 * 1024)
                .unwrap_or(true)
            {
                continue;
            }
            if let Ok(src) = std::fs::read_to_string(&path) {
                out.push(Shader {
                    name: path
                        .file_stem()
                        .and_then(|s| s.to_str())
                        .unwrap_or("shader")
                        .to_string(),
                    source: src,
                });
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

#[derive(serde::Serialize)]
pub struct Shader {
    pub name: String,
    pub source: String,
}

#[tauri::command]
pub fn list_user_shaders(app: AppHandle) -> Vec<Shader> {
    list_shaders(&app)
}

#[tauri::command]
pub fn shaders_dir(app: AppHandle) -> Option<String> {
    app.path()
        .app_data_dir()
        .ok()
        .map(|d| d.join("shaders").display().to_string())
}

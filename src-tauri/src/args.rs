//! Files handed to G9 by Windows (Explorer "Open with", drag-to-exe, CLI).

use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
pub struct StartupFile {
    pub path: String,
    pub name: String,
    pub is_url: bool,
}

fn is_url(s: &str) -> bool {
    let l = s.to_ascii_lowercase();
    l.starts_with("http://")
        || l.starts_with("https://")
        || l.starts_with("rtsp://")
        || l.starts_with("rtmp://")
}

/// First argument that is not a flag and (for paths) actually exists.
pub fn from_args(args: impl IntoIterator<Item = String>) -> Option<StartupFile> {
    for raw in args {
        let arg = raw.trim().trim_matches('"');
        if arg.is_empty() || arg.starts_with('-') {
            continue;
        }
        if is_url(arg) {
            return Some(StartupFile {
                path: arg.to_string(),
                name: pretty_name(arg),
                is_url: true,
            });
        }
        let path = std::path::Path::new(arg);
        if path.is_file() {
            return Some(StartupFile {
                path: path.display().to_string(),
                name: pretty_name(arg),
                is_url: false,
            });
        }
    }
    None
}

fn pretty_name(s: &str) -> String {
    let cut = s.split(['?', '#']).next().unwrap_or(s);
    cut.rsplit(['/', '\\'])
        .next()
        .filter(|n| !n.is_empty())
        .unwrap_or(cut)
        .to_string()
}

#[tauri::command]
pub fn startup_file() -> Option<StartupFile> {
    from_args(std::env::args().skip(1))
}

/// Installer registers G9 as a Viewer for these; this is what "Open with" runs.
#[tauri::command]
pub fn reveal_in_folder(app: AppHandle, path: String) -> Result<String, String> {
    let target = std::path::Path::new(&path);
    if !target.exists() {
        return Err("file is gone".into());
    }
    #[cfg(windows)]
    {
        let arg = if target.is_dir() {
            path.clone()
        } else {
            format!("/select,{path}")
        };
        let _ = app;
        crate::tools::run_hidden(std::process::Command::new("explorer").arg(arg))
            .map_err(|e| e.to_string())?;
        Ok("Opened in Explorer".into())
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        Err("Explorer is Windows-only".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn picks_first_real_file() {
        let tmp = std::env::temp_dir().join("g9-args-test.mp4");
        std::fs::write(&tmp, b"x").unwrap();
        let got = from_args(args(&["--flag", "", &tmp.display().to_string()])).unwrap();
        assert!(got.path.ends_with("g9-args-test.mp4"));
        assert_eq!(got.name, "g9-args-test.mp4");
        assert!(!got.is_url);
        let _ = std::fs::remove_file(&tmp);
    }

    #[test]
    fn accepts_urls_and_ignores_flags() {
        let got = from_args(args(&["--a", "https://example.com/v.mp4?x=1"])).unwrap();
        assert!(got.is_url);
        assert_eq!(got.name, "v.mp4");
        assert!(from_args(args(&["--only-flag"])).is_none());
        assert!(from_args(args(&["/no/such/file.mp4"])).is_none());
    }
}

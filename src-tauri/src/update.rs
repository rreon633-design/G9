//! Update check against the project's GitHub releases.
//!
//! G9 has no updater plugin: the installer is per-user and unsigned for
//! auto-update, so "check for updates" only answers *is there a newer release*
//! and points at the download page. One request, cached in the UI.

use g9_core::{APP_VERSION, USER_AGENT};
use serde::Serialize;

const API: &str = "https://api.github.com/repos/rreon633-design/G9/releases/latest";

#[derive(Debug, Clone, Serialize)]
pub struct UpdateInfo {
    /// Version this build is running.
    pub current: String,
    /// Latest published tag, without the leading `v`.
    pub latest: String,
    /// True when `latest` is newer than `current`.
    pub newer: bool,
    /// Release page to open.
    pub url: String,
    /// ISO date the release was published, straight from GitHub.
    pub published: String,
}

fn parts(v: &str) -> Vec<u32> {
    let clean = v.trim().trim_start_matches(['v', 'V']);
    // A pre-release marker (`-beta.1`) never makes a build newer than the release.
    let core = clean.split(['-', '+']).next().unwrap_or(clean);
    core.split('.')
        .map(|p| p.parse::<u32>().unwrap_or(0))
        .collect()
}

/// Is `candidate` a higher version than `running`? Numeric, segment by segment.
pub fn is_newer(candidate: &str, running: &str) -> bool {
    let a = parts(candidate);
    let b = parts(running);
    for i in 0..a.len().max(b.len()) {
        let x = *a.get(i).unwrap_or(&0);
        let y = *b.get(i).unwrap_or(&0);
        if x != y {
            return x > y;
        }
    }
    false
}

/// Ask GitHub for the newest release. Errors are one short line.
pub fn check() -> Result<UpdateInfo, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(std::time::Duration::from_secs(10))
        .use_rustls_tls()
        .build()
        .map_err(|_| "Could not reach the update server".to_string())?;
    let resp = client
        .get(API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .map_err(|_| "Could not reach the update server".to_string())?;
    if !resp.status().is_success() {
        return Err("Could not reach the update server".into());
    }
    let body: serde_json::Value = resp
        .json()
        .map_err(|_| "The update answer was unreadable".to_string())?;
    let tag = body
        .get("tag_name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let latest = tag.trim_start_matches(['v', 'V']).to_string();
    if latest.is_empty() {
        return Err("No published release yet".into());
    }
    Ok(UpdateInfo {
        current: APP_VERSION.to_string(),
        newer: is_newer(&latest, APP_VERSION),
        latest,
        url: body
            .get("html_url")
            .and_then(|v| v.as_str())
            .unwrap_or("https://github.com/rreon633-design/G9/releases")
            .to_string(),
        published: body
            .get("published_at")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_versions() {
        assert!(is_newer("0.9.0", "0.8.0"));
        assert!(is_newer("v1.0.0", "0.9.9"));
        assert!(is_newer("0.9.1", "0.9"));
        assert!(!is_newer("0.8.0", "0.8.0"));
        assert!(!is_newer("0.7.9", "0.8.0"));
        assert!(!is_newer("0.8", "0.8.0"));
    }

    #[test]
    fn ignores_prerelease_noise() {
        assert!(is_newer("0.9.0-beta.1", "0.8.9"));
        assert!(!is_newer("0.9.0-beta.1", "0.9.0"));
    }

    #[test]
    fn current_is_known() {
        assert!(!APP_VERSION.is_empty());
        assert!(!is_newer(APP_VERSION, APP_VERSION));
    }
}

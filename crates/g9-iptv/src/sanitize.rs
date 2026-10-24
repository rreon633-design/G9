/// Returns true if a media URL from a playlist must be dropped.
///
/// Remote playlists are treated as hostile: they must not point at local
/// files, unix sockets, or raw data URIs.
pub fn is_dangerous_media_url(url: &str) -> bool {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return true;
    }
    let lower = trimmed.to_ascii_lowercase();
    let scheme = lower.split(':').next().unwrap_or("");
    matches!(
        scheme,
        "file"
            | "unix"
            | "fd"
            | "data"
            | "javascript"
            | "smb"
            | "nfs"
            | "gopher"
            | "dict"
            | "expect"
            | "php"
            | "zip"
            | "concat"
    )
}

/// Logos may be http(s) or data:image. Everything else is dropped.
pub fn sanitize_logo_url(url: &str) -> Option<String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return None;
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with("https://") || lower.starts_with("http://") {
        return Some(trimmed.to_string());
    }
    if lower.starts_with("data:image/") {
        return Some(trimmed.to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_file_and_unix() {
        assert!(is_dangerous_media_url("file:///etc/passwd"));
        assert!(is_dangerous_media_url("UNIX:/tmp/sock"));
        assert!(is_dangerous_media_url("data:text/plain,hi"));
    }

    #[test]
    fn allows_http() {
        assert!(!is_dangerous_media_url("https://cdn.example/live.ts"));
        assert!(!is_dangerous_media_url("http://192.168.1.20:8080/ch1"));
    }

    #[test]
    fn logo_http_ok() {
        assert!(sanitize_logo_url("https://img.example/a.png").is_some());
        assert!(sanitize_logo_url("file:///tmp/x.png").is_none());
    }
}

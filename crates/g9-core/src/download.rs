//! Parsing for the web-video downloader (`yt-dlp -J` output).
//!
//! Kept free of Tauri so it can be unit-tested on any platform.

use std::collections::HashMap;

#[derive(Debug, Clone, serde::Serialize)]
pub struct Choice {
    pub height: u32,
    pub label: String,
    pub ext: String,
    pub fps: Option<f32>,
    /// Estimated size in bytes (0 = unknown).
    pub size: u64,
    pub audio_only: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MediaInfo {
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    pub site: String,
    pub choices: Vec<Choice>,
}

/// Turn a `yt-dlp -J` document into the quality ladder the UI shows.
pub fn summarise(json: &str) -> Result<MediaInfo, String> {
    let v: serde_json::Value =
        serde_json::from_str(json).map_err(|_| "unreadable response".to_string())?;
    let title = v
        .get("title")
        .and_then(|t| t.as_str())
        .unwrap_or("Untitled")
        .to_string();
    let site = v
        .get("extractor_key")
        .or_else(|| v.get("extractor"))
        .and_then(|s| s.as_str())
        .unwrap_or("Web")
        .to_string();
    let formats = v
        .get("formats")
        .and_then(|f| f.as_array())
        .cloned()
        .unwrap_or_default();

    // Best size per height for video-only-capable formats.
    let mut by_height: HashMap<u32, (u64, Option<f32>, String)> = HashMap::new();
    let mut audio_size: u64 = 0;
    for f in &formats {
        let vcodec = f.get("vcodec").and_then(|x| x.as_str()).unwrap_or("none");
        let acodec = f.get("acodec").and_then(|x| x.as_str()).unwrap_or("none");
        let size = f
            .get("filesize")
            .or_else(|| f.get("filesize_approx"))
            .and_then(|x| x.as_u64())
            .unwrap_or(0);
        let ext = f
            .get("ext")
            .and_then(|x| x.as_str())
            .unwrap_or("mp4")
            .to_string();
        let fps = f.get("fps").and_then(|x| x.as_f64()).map(|x| x as f32);
        let height = f.get("height").and_then(|x| x.as_u64()).unwrap_or(0) as u32;

        if vcodec != "none" && height > 0 {
            let slot = by_height.entry(height).or_insert((0, fps, ext.clone()));
            if size > slot.0 {
                *slot = (size, fps, ext);
            }
        } else if vcodec == "none" && acodec != "none" && size > audio_size {
            audio_size = size;
        }
    }

    let mut ladder = vec![2160u32, 1440, 1080, 720, 480, 360];
    ladder.retain(|h| by_height.contains_key(h));
    // Anything above 2160 or odd heights still deserves an entry.
    for h in by_height.keys() {
        if !ladder.contains(h) {
            ladder.push(*h);
        }
    }
    ladder.sort_unstable_by(|a, b| b.cmp(a));
    ladder.truncate(6);

    let mut choices: Vec<Choice> = ladder
        .iter()
        .map(|h| {
            let (size, fps, ext) = by_height.get(h).cloned().unwrap_or((0, None, "mp4".into()));
            let name = match *h {
                2160 => "4K".to_string(),
                1440 => "1440p".to_string(),
                1080 => "1080p".to_string(),
                720 => "720p".to_string(),
                other => format!("{other}p"),
            };
            Choice {
                height: *h,
                label: name,
                ext,
                fps,
                size: if size > 0 { size + audio_size } else { 0 },
                audio_only: false,
            }
        })
        .collect();

    choices.push(Choice {
        height: 0,
        label: "Audio only".into(),
        ext: "m4a".into(),
        fps: None,
        size: audio_size,
        audio_only: true,
    });

    Ok(MediaInfo {
        title,
        uploader: v
            .get("uploader")
            .or_else(|| v.get("channel"))
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        duration: v.get("duration").and_then(|x| x.as_f64()),
        thumbnail: v
            .get("thumbnail")
            .and_then(|x| x.as_str())
            .map(|s| s.to_string()),
        site,
        choices,
    })
}

/// Only plain web links are handed to the downloader.
pub fn is_supported_url(url: &str) -> bool {
    let l = url.trim().to_ascii_lowercase();
    if !(l.starts_with("http://") || l.starts_with("https://")) {
        return false;
    }
    !l.contains("127.0.0.1") && !l.contains("localhost")
}

/// Friendly site key from a URL host (`www.youtube.com` -> `youtube`).
pub fn site_name(url: &str) -> String {
    let host = url
        .split("://")
        .nth(1)
        .unwrap_or(url)
        .split('/')
        .next()
        .unwrap_or(url)
        .to_ascii_lowercase();
    let host = host.trim_start_matches("www.");
    host.split('.').next().unwrap_or(host).to_string()
}

/// `yt-dlp -f` selector for a ladder height (0 = audio only).
pub fn format_selector(height: u32) -> String {
    if height == 0 {
        return "bestaudio/best".into();
    }
    format!("bestvideo[height<={height}]+bestaudio/best[height<={height}]/best")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"{
      "title": "Sample clip",
      "uploader": "Someone",
      "duration": 63.4,
      "extractor_key": "Youtube",
      "thumbnail": "https://img.example/t.jpg",
      "formats": [
        {"format_id":"137","ext":"mp4","height":1080,"fps":30,"vcodec":"avc1","acodec":"none","filesize":52428800},
        {"format_id":"136","ext":"mp4","height":720,"fps":30,"vcodec":"avc1","acodec":"none","filesize_approx":26214400},
        {"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1","acodec":"mp4a","filesize":5242880},
        {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a","filesize":1048576},
        {"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus","filesize":2097152}
      ]
    }"#;

    #[test]
    fn ladder_is_sorted_and_adds_audio() {
        let info = summarise(SAMPLE).unwrap();
        assert_eq!(info.title, "Sample clip");
        assert_eq!(info.site, "Youtube");
        let heights: Vec<u32> = info.choices.iter().map(|c| c.height).collect();
        assert_eq!(heights, vec![1080, 720, 360, 0]);
        let hd = &info.choices[0];
        assert_eq!(hd.label, "1080p");
        assert_eq!(hd.size, 52428800 + 2097152);
        assert!(info.choices.last().unwrap().audio_only);
    }

    #[test]
    fn missing_fields_do_not_panic() {
        let info = summarise(r#"{"title":"x"}"#).unwrap();
        assert_eq!(info.choices.len(), 1);
        assert!(summarise("not json").is_err());
    }

    #[test]
    fn odd_heights_are_kept() {
        let info = summarise(
            r#"{"title":"v","formats":[{"height":480,"vcodec":"vp9","acodec":"none","filesize":10},
                                      {"height":3600,"vcodec":"av1","acodec":"none","filesize":20}]}"#,
        )
        .unwrap();
        let heights: Vec<u32> = info.choices.iter().map(|c| c.height).collect();
        assert_eq!(heights, vec![3600, 480, 0]);
    }

    #[test]
    fn url_rules() {
        assert!(is_supported_url("https://www.youtube.com/watch?v=abc"));
        assert!(is_supported_url("https://www.instagram.com/reel/x"));
        assert!(!is_supported_url("file:///c:/x.mp4"));
        assert!(!is_supported_url("javascript:alert(1)"));
        assert!(!is_supported_url("https://127.0.0.1:18765/x"));
        assert_eq!(site_name("https://www.youtube.com/watch?v=1"), "youtube");
        assert_eq!(site_name("https://fb.watch/x"), "fb");
    }

    #[test]
    fn selectors() {
        assert_eq!(format_selector(0), "bestaudio/best");
        assert!(format_selector(1080).contains("height<=1080"));
    }
}

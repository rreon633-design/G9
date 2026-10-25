//! yt-dlp `-J` output → a stream list.
//!
//! G9 already installs and updates the yt-dlp engine (v0.5), so it doubles as a
//! resolver: paste any page URL, take the formats yt-dlp reports, and keep the
//! `http_headers` it says that CDN needs.

use serde_json::Value;

use crate::model::{Quality, Stream, Subtitle};

/// Formats that play in a WebView without muxing: video **and** audio present.
/// YouTube now serves these only up to 720p (or not at all), so the caller also
/// accepts `requested_formats` from a merged download and best-effort audio.
pub fn parse_probe(json: &str, provider: &str) -> Result<Vec<Stream>, String> {
    let v: Value = serde_json::from_str(json).map_err(|_| "yt-dlp returned no JSON".to_string())?;
    let title = v.get("title").and_then(Value::as_str).unwrap_or("");
    let mut out: Vec<Stream> = Vec::new();

    let formats = v
        .get("formats")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for f in &formats {
        let Some(url) = f.get("url").and_then(Value::as_str) else {
            continue;
        };
        if url.is_empty() {
            continue;
        }
        let vcodec = f.get("vcodec").and_then(Value::as_str).unwrap_or("none");
        let acodec = f.get("acodec").and_then(Value::as_str).unwrap_or("none");
        let ext = f.get("ext").and_then(Value::as_str).unwrap_or("mp4");
        let height = f.get("height").and_then(Value::as_i64).unwrap_or(0);
        let protocol = f.get("protocol").and_then(Value::as_str).unwrap_or("https");
        let is_hls = protocol.contains("m3u8");

        // Video-only DASH fragments are useless on their own; keep progressive
        // or HLS renditions, and audio-only as a last resort.
        let muxed = vcodec != "none" && acodec != "none";
        let video_only = vcodec != "none" && acodec == "none";
        if video_only && !is_hls {
            continue;
        }
        if !muxed && !is_hls && vcodec == "none" {
            continue; // audio-only: not a playable video surface
        }

        let mut label = if height > 0 {
            format!("{height}p")
        } else {
            f.get("format_note")
                .and_then(Value::as_str)
                .unwrap_or("stream")
                .to_string()
        };
        if is_hls {
            label.push_str(" · HLS");
        }
        if !ext.is_empty() && ext != "mp4" {
            label.push_str(&format!(" · {ext}"));
        }

        let mut st = Stream::http(url, label, provider.to_string());
        st.quality = if height > 0 {
            Quality::from_label(&format!("{height}p"))
        } else {
            Quality::from_label(f.get("format_note").and_then(Value::as_str).unwrap_or(""))
        };
        st.size = f
            .get("filesize")
            .or_else(|| f.get("filesize_approx"))
            .and_then(Value::as_i64)
            .map(|b| b as u64);
        if let Some(headers) = f.get("http_headers").and_then(Value::as_object) {
            for (k, val) in headers {
                if let Some(s) = val.as_str() {
                    st.headers.push((k.clone(), s.to_string()));
                }
            }
        }
        out.push(st);
    }

    // A merged download reports the real pair here; prefer it.
    if let Some(req) = v.get("requested_formats").and_then(Value::as_array) {
        if let Some(main) = req
            .iter()
            .find(|f| f.get("vcodec").and_then(Value::as_str).unwrap_or("none") != "none")
        {
            if let Some(url) = main.get("url").and_then(Value::as_str) {
                let height = main.get("height").and_then(Value::as_i64).unwrap_or(0);
                let label = if height > 0 {
                    format!("{height}p")
                } else {
                    "best".into()
                };
                let mut st = Stream::http(url, label, provider.to_string());
                st.quality = Quality::from_label(&format!("{height}p"));
                out.insert(0, st);
            }
        }
    }

    if out.is_empty() {
        return Err(format!(
            "{} has no direct stream — yt-dlp can still download it",
            if title.is_empty() { "that page" } else { title }
        ));
    }
    crate::model::rank_streams(&mut out);
    out.dedup_by(|a, b| a.url == b.url);
    Ok(out)
}

/// `{lang: [{ext, url, name}]}` → subtitles, preferring VTT.
pub fn parse_subs(json: &str) -> Vec<Subtitle> {
    let Ok(v) = serde_json::from_str::<Value>(json) else {
        return Vec::new();
    };
    let mut out = Vec::new();
    let Some(map) = v.get("subtitles").and_then(Value::as_object) else {
        return out;
    };
    for (lang, list) in map {
        let Some(entries) = list.as_array() else {
            continue;
        };
        let best = entries
            .iter()
            .find(|e| e.get("ext").and_then(Value::as_str) == Some("vtt"))
            .or_else(|| entries.first());
        if let Some(url) = best.and_then(|e| e.get("url")).and_then(Value::as_str) {
            out.push(Subtitle {
                label: best
                    .and_then(|e| e.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or(lang)
                    .to_string(),
                url: url.to_string(),
                lang: lang.clone(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROBE: &str = r#"{
        "title": "A video",
        "formats": [
            {"url":"https://cdn/a.m3u8","ext":"mp4","height":1080,"vcodec":"avc1","acodec":"mp4a","protocol":"m3u8_native","http_headers":{"Referer":"https://site/"}},
            {"url":"https://cdn/b.mp4","ext":"mp4","height":720,"vcodec":"avc1","acodec":"mp4a","protocol":"https"},
            {"url":"https://cdn/c.mp4","ext":"mp4","height":2160,"vcodec":"av01","acodec":"none","protocol":"https"},
            {"url":"https://cdn/d.m4a","ext":"m4a","height":0,"vcodec":"none","acodec":"mp4a","protocol":"https"}
        ],
        "subtitles": {"en":[{"ext":"vtt","url":"https://s/en.vtt","name":"English"}],"hi":[{"ext":"srv3","url":"https://s/hi.srv3"}]}
    }"#;

    #[test]
    fn progressive_formats_become_streams() {
        let s = parse_probe(PROBE, "yt-dlp").unwrap();
        // audio-only and video-only DASH are dropped
        assert_eq!(s.len(), 2, "{s:#?}");
        assert!(s[0].label.contains("HLS"));
        assert_eq!(s[1].quality, Quality::Hd);
        assert!(s[0].headers.iter().any(|(k, _)| k == "Referer"));
    }

    #[test]
    fn no_formats_is_explained() {
        let err = parse_probe(r#"{"title":"Locked","formats":[]}"#, "yt-dlp").unwrap_err();
        assert!(err.contains("Locked"), "{err}");
    }

    #[test]
    fn subtitles_prefer_vtt() {
        let subs = parse_subs(PROBE);
        assert_eq!(subs.len(), 2);
        assert!(subs.iter().any(|s| s.url.ends_with("en.vtt")));
        assert!(subs.iter().any(|s| s.lang == "hi"));
    }

    #[test]
    fn garbage_input_errors() {
        assert!(parse_probe("nope", "yt-dlp").is_err());
    }
}

use std::collections::BTreeSet;

use g9_core::{ParseReport, ParsedChannel, SourceKind, StreamType};

use crate::sanitize::{is_dangerous_media_url, sanitize_logo_url};

/// Hard caps so a hostile playlist cannot exhaust memory.
pub const MAX_BYTES: usize = 64 * 1024 * 1024;
pub const MAX_LINE: usize = 16 * 1024;
pub const MAX_CHANNELS: usize = 200_000;

#[derive(Debug, Clone)]
pub struct ParseOptions {
    pub source_kind: SourceKind,
    pub allow_local_media: bool,
}

impl Default for ParseOptions {
    fn default() -> Self {
        Self {
            source_kind: SourceKind::Url,
            allow_local_media: false,
        }
    }
}

impl ParseOptions {
    pub fn for_kind(kind: SourceKind) -> Self {
        Self {
            source_kind: kind,
            allow_local_media: matches!(kind, SourceKind::File),
        }
    }
}

#[derive(Default)]
struct ExtInf {
    name: String,
    group: Option<String>,
    tvg_id: Option<String>,
    tvg_name: Option<String>,
    tvg_logo: Option<String>,
    duration: Option<i64>,
}

/// Read `key="value"` out of the `#EXTM3U` header line.
fn header_attr(line: &str, key: &str) -> Option<String> {
    let lower = line.to_ascii_lowercase();
    let at = lower.find(&format!("{key}="))?;
    let rest = &line[at + key.len() + 1..];
    let rest = rest.trim_start();
    let quote = rest.chars().next()?;
    if quote == '"' || quote == '\'' {
        let end = rest[1..].find(quote)?;
        let value = rest[1..1 + end].trim();
        return (!value.is_empty()).then(|| value.to_string());
    }
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let value = rest[..end].trim();
    (!value.is_empty()).then(|| value.to_string())
}

/// Parse an M3U / M3U8 playlist into channels.
///
/// `#EXTVLCOPT` and unknown option directives are counted and discarded.
pub fn parse_m3u(
    input: &str,
    opts: ParseOptions,
) -> Result<(Vec<ParsedChannel>, ParseReport), String> {
    if input.len() > MAX_BYTES {
        return Err(format!("playlist exceeds {MAX_BYTES} byte cap"));
    }

    let mut channels = Vec::new();
    let mut report = ParseReport::default();
    let mut pending: Option<ExtInf> = None;
    let mut groups = BTreeSet::new();

    for raw_line in input.lines() {
        if raw_line.len() > MAX_LINE {
            report.skipped_blank += 1;
            pending = None;
            continue;
        }
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }
        // BOM on first line
        let line = line.trim_start_matches('\u{feff}');

        if line.starts_with('#') {
            let upper = line.to_ascii_uppercase();
            if upper.starts_with("#EXTVLCOPT")
                || upper.starts_with("#EXTINFOPT")
                || upper.starts_with("#KODIPROP")
            {
                report.stripped_extvlcopt += 1;
                continue;
            }
            if upper.starts_with("#EXTM3U") || upper.starts_with("#PLAYLIST") {
                if report.epg_url.is_none() {
                    report.epg_url = header_attr(line, "url-tvg")
                        .or_else(|| header_attr(line, "x-tvg-url"))
                        .or_else(|| header_attr(line, "tvg-url"));
                }
                continue;
            }
            if upper.starts_with("#EXTINF:") {
                pending = Some(parse_extinf(line));
                continue;
            }
            continue;
        }

        // URL / path line
        let url = line.to_string();
        let dangerous = is_dangerous_media_url(&url);
        if dangerous && !opts.allow_local_media {
            report.skipped_dangerous += 1;
            pending = None;
            continue;
        }
        if dangerous && opts.allow_local_media && is_dangerous_media_url(&url) {
            // Local playlists may use relative paths or absolute files, but not unix/data.
            let lower = url.to_ascii_lowercase();
            if lower.starts_with("unix:")
                || lower.starts_with("data:")
                || lower.starts_with("javascript:")
            {
                report.skipped_dangerous += 1;
                pending = None;
                continue;
            }
        }

        let meta = pending.take().unwrap_or_default();
        let name = if meta.name.is_empty() {
            fallback_name(&url)
        } else {
            meta.name
        };
        if name.is_empty() && url.is_empty() {
            report.skipped_blank += 1;
            continue;
        }
        if let Some(g) = &meta.group {
            groups.insert(g.clone());
        }
        channels.push(ParsedChannel {
            name,
            url,
            group: meta.group,
            tvg_id: meta.tvg_id,
            tvg_name: meta.tvg_name,
            tvg_logo: meta.tvg_logo,
            duration: meta.duration,
            stream_type: StreamType::Live,
        });
        if channels.len() >= MAX_CHANNELS {
            break;
        }
    }

    report.channel_count = channels.len();
    report.group_count = groups.len();
    let _ = opts.source_kind;
    Ok((channels, report))
}

fn fallback_name(url: &str) -> String {
    url.rsplit(['/', '\\'])
        .next()
        .unwrap_or(url)
        .split('?')
        .next()
        .unwrap_or(url)
        .to_string()
}

fn parse_extinf(line: &str) -> ExtInf {
    // #EXTINF:duration [attrs],display name
    let rest = line
        .trim_start_matches("#EXTINF:")
        .trim_start_matches("#extinf:");
    let (head, name) = match rest.rfind(',') {
        Some(idx) => (&rest[..idx], rest[idx + 1..].trim()),
        None => (rest, ""),
    };

    let mut info = ExtInf {
        name: name.to_string(),
        ..ExtInf::default()
    };

    // duration is the first token before space or end
    let duration_token = head.split_whitespace().next().unwrap_or("");
    if let Ok(d) = duration_token.parse::<i64>() {
        if d >= 0 {
            info.duration = Some(d);
        }
    }

    info.group = attr(head, "group-title");
    info.tvg_id = attr(head, "tvg-id");
    info.tvg_name = attr(head, "tvg-name");
    info.tvg_logo = attr(head, "tvg-logo").and_then(|u| sanitize_logo_url(&u));
    info
}

fn attr(src: &str, key: &str) -> Option<String> {
    let pattern = format!("{key}=");
    let lower = src.to_ascii_lowercase();
    let key_l = pattern.to_ascii_lowercase();
    let pos = lower.find(&key_l)?;
    let rest = &src[pos + pattern.len()..];
    if let Some(inner) = rest.strip_prefix('"') {
        let end = inner.find('"')?;
        let val = inner[..end].trim();
        if val.is_empty() {
            None
        } else {
            Some(val.to_string())
        }
    } else {
        let end = rest
            .find(|c: char| c.is_whitespace() || c == ',')
            .unwrap_or(rest.len());
        let val = rest[..end].trim();
        if val.is_empty() {
            None
        } else {
            Some(val.to_string())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_guide_url_from_the_header() {
        let text = "#EXTM3U url-tvg=\"https://guide.example/epg.xml.gz\" x-tvg-url=\"https://other/epg.xml\"\n#EXTINF:-1,One\nhttps://cdn.example/1.m3u8\n";
        let (_, report) = parse_m3u(text, ParseOptions::default()).unwrap();
        assert_eq!(
            report.epg_url.as_deref(),
            Some("https://guide.example/epg.xml.gz")
        );

        let plain = "#EXTM3U\n#EXTINF:-1,One\nhttps://cdn.example/1.m3u8\n";
        let (_, report) = parse_m3u(plain, ParseOptions::default()).unwrap();
        assert!(report.epg_url.is_none());
    }

    const SAMPLE: &str = r#"#EXTM3U
#EXTINF:-1 tvg-id="bbc1.uk" tvg-name="BBC One" tvg-logo="https://img.example/bbc.png" group-title="UK",BBC One
https://cdn.example/bbc1.m3u8
#EXTVLCOPT:http-user-agent=Evil
#EXTINF:-1 group-title="News",CNN
https://cdn.example/cnn.ts
#KODIPROP:inputstream=inputstream.adaptive
#EXTINF:-1,Secret local
file:///etc/passwd
#EXTINF:-1 group-title="UK",BBC Two
https://cdn.example/bbc2.m3u8
"#;

    #[test]
    fn parses_channels_and_strips_injection() {
        let (chs, report) = parse_m3u(SAMPLE, ParseOptions::default()).unwrap();
        assert_eq!(chs.len(), 3);
        assert_eq!(chs[0].name, "BBC One");
        assert_eq!(chs[0].group.as_deref(), Some("UK"));
        assert_eq!(chs[0].tvg_id.as_deref(), Some("bbc1.uk"));
        assert_eq!(
            chs[0].tvg_logo.as_deref(),
            Some("https://img.example/bbc.png")
        );
        assert_eq!(chs[1].name, "CNN");
        assert_eq!(chs[2].name, "BBC Two");
        assert!(report.stripped_extvlcopt >= 1);
        assert_eq!(report.skipped_dangerous, 1);
        assert_eq!(report.group_count, 2);
    }

    #[test]
    fn local_playlist_allows_relative_paths() {
        let text = "#EXTM3U\n#EXTINF:-1,Clip\n/home/user/Videos/a.mkv\n";
        let (chs, report) = parse_m3u(text, ParseOptions::for_kind(SourceKind::File)).unwrap();
        assert_eq!(chs.len(), 1);
        assert_eq!(report.skipped_dangerous, 0);
        assert_eq!(chs[0].url, "/home/user/Videos/a.mkv");
    }

    #[test]
    fn crlf_and_bom() {
        let text = "\u{feff}#EXTM3U\r\n#EXTINF:-1,One\r\nhttps://e/x\r\n";
        let (chs, _) = parse_m3u(text, ParseOptions::default()).unwrap();
        assert_eq!(chs.len(), 1);
        assert_eq!(chs[0].name, "One");
    }

    #[test]
    fn scales_to_100k() {
        let mut buf = String::from("#EXTM3U\n");
        for i in 0..100_000 {
            buf.push_str(&format!(
                "#EXTINF:-1 group-title=\"G{}\",Channel {i}\nhttps://e.example/{i}.ts\n",
                i % 50
            ));
        }
        let start = std::time::Instant::now();
        let (chs, report) = parse_m3u(&buf, ParseOptions::default()).unwrap();
        let elapsed = start.elapsed();
        assert_eq!(chs.len(), 100_000);
        assert_eq!(report.group_count, 50);
        assert!(
            elapsed.as_secs_f64() < 10.0,
            "100k parse took {elapsed:?}, budget is 10s"
        );
    }
}

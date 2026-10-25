//! Online subtitle search (OpenSubtitles simplexml) and SRT → WebVTT.

use g9_core::USER_AGENT;
use serde::Serialize;
use url::Url;

const MAX_ZIP: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
pub struct SubHit {
    pub movie: String,
    pub release: String,
    pub language: String,
    pub download: String,
    pub rating: f32,
}

#[derive(Debug, Serialize)]
pub struct SubResult {
    pub vtt: String,
    pub language: String,
    pub movie: String,
    pub release: String,
    pub query: String,
}

pub fn clean_query(raw: &str) -> String {
    let name = raw.rsplit(['/', '\\']).next().unwrap_or(raw);
    let no_ext = name.rsplit_once('.').map(|(a, _)| a).unwrap_or(name);
    let s = no_ext.replace(['.', '_', '+'], " ");
    let junk = [
        "1080p", "720p", "480p", "2160p", "4k", "bluray", "webrip", "web-dl", "webdl", "hdtv",
        "x264", "x265", "h264", "h265", "hevc", "aac", "dts", "hdr", "dv", "remux", "proper",
        "repack", "extended", "unrated", "yify", "rarbg", "sparks", "vodo",
    ];
    let tokens: Vec<&str> = s
        .split_whitespace()
        .filter(|t| {
            let l = t.to_ascii_lowercase();
            if junk.iter().any(|j| *j == l) {
                return false;
            }
            if t.chars().all(|c| c.is_ascii_digit()) {
                return t.len() == 4;
            }
            true
        })
        .collect();
    let out = tokens.join(" ");
    if out.is_empty() {
        no_ext.to_string()
    } else {
        out
    }
}

fn lang_id(lang: &str) -> &'static str {
    match lang.to_ascii_lowercase().get(..2).unwrap_or("en") {
        "en" => "eng",
        "es" => "spa",
        "fr" => "fre",
        "de" => "ger",
        "it" => "ita",
        "pt" => "por",
        "ru" => "rus",
        "hi" => "hin",
        "ar" => "ara",
        "ja" => "jpn",
        "ko" => "kor",
        "zh" => "chi",
        "nl" => "dut",
        "pl" => "pol",
        "tr" => "tur",
        "sv" => "swe",
        "ta" => "tam",
        "te" => "tel",
        _ => "eng",
    }
}

fn http_get(url: &str) -> Result<Vec<u8>, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("unsupported scheme".into());
    }
    let host = parsed.host_str().unwrap_or("");
    let allowed = host.ends_with("opensubtitles.org") || host.ends_with("opensubtitles.com");
    if !allowed {
        return Err("subtitle host not allowed".into());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(25))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(parsed).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut buf = Vec::new();
    resp.copy_to(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() > MAX_ZIP {
        return Err("subtitle payload too large".into());
    }
    Ok(buf)
}

fn tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let a = xml.find(&open)? + open.len();
    let b = xml[a..].find(&close)? + a;
    let mut v = xml[a..b].trim().to_string();
    v = v.replace("<![CDATA[", "").replace("]]>", "");
    Some(v.trim().to_string())
}

pub fn search(query: &str, language: &str) -> Result<Vec<SubHit>, String> {
    let q = clean_query(query);
    if q.len() < 2 {
        return Err("query too short".into());
    }
    let lid = lang_id(language);
    let encoded = urlencoding_simple(&q);
    let url = format!(
        "https://www.opensubtitles.org/en/search/sublanguageid-{lid}/moviename-{encoded}/simplexml"
    );
    let body = String::from_utf8_lossy(&http_get(&url)?).into_owned();
    let mut hits = Vec::new();
    let mut rest = body.as_str();
    while let Some(start) = rest.find("<subtitle>") {
        let chunk = &rest[start..];
        let end = chunk.find("</subtitle>").unwrap_or(chunk.len());
        let block = &chunk[..end];
        if let Some(dl) = tag(block, "download") {
            let rating = tag(block, "subrating")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            hits.push(SubHit {
                movie: tag(block, "movie").unwrap_or_default(),
                release: tag(block, "releasename").unwrap_or_default(),
                language: tag(block, "iso639").unwrap_or_else(|| language.to_string()),
                download: dl,
                rating,
            });
        }
        rest = &chunk[end.min(chunk.len()).saturating_add(1)..];
        if hits.len() >= 25 {
            break;
        }
    }
    hits.sort_by(|a, b| {
        b.rating
            .partial_cmp(&a.rating)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    if hits.is_empty() {
        return Err(format!("no subtitles for “{q}”"));
    }
    Ok(hits)
}

pub fn fetch_best(query: &str, language: &str) -> Result<SubResult, String> {
    let q = clean_query(query);
    let mut hits = search(&q, language)?;
    if hits.is_empty() && lang_id(language) != "eng" {
        hits = search(&q, "en")?;
    }
    let hit = hits.into_iter().next().ok_or("no subtitles")?;
    let zip_bytes = http_get(&hit.download)?;
    let srt = extract_subtitle(&zip_bytes)?;
    let vtt = srt_to_vtt(&srt);
    Ok(SubResult {
        vtt,
        language: hit.language,
        movie: hit.movie,
        release: hit.release,
        query: q,
    })
}

fn extract_subtitle(zip_bytes: &[u8]) -> Result<String, String> {
    if looks_like_srt(zip_bytes) || looks_like_vtt(zip_bytes) {
        return Ok(String::from_utf8_lossy(zip_bytes).into_owned());
    }
    let reader = std::io::Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = file.name().to_ascii_lowercase();
        if name.ends_with(".srt") || name.ends_with(".vtt") || name.ends_with(".txt") {
            let mut buf = Vec::new();
            use std::io::Read;
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
    }
    Err("no subtitle file in archive".into())
}

fn looks_like_srt(b: &[u8]) -> bool {
    let s = String::from_utf8_lossy(&b[..b.len().min(200)]);
    s.contains("-->") && s.contains(',')
}
fn looks_like_vtt(b: &[u8]) -> bool {
    String::from_utf8_lossy(&b[..b.len().min(16)])
        .to_ascii_uppercase()
        .contains("WEBVTT")
}

pub fn srt_to_vtt(srt: &str) -> String {
    let text = srt.strip_prefix('\u{feff}').unwrap_or(srt);
    if text.trim_start().starts_with("WEBVTT") {
        return text.to_string();
    }
    let mut out = String::from("WEBVTT\n\n");
    for line in text.lines() {
        if line.contains("-->") {
            out.push_str(&line.replace(',', "."));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn urlencoding_simple(s: &str) -> String {
    let mut o = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                o.push(b as char)
            }
            b' ' => o.push('+'),
            _ => o.push_str(&format!("%{b:02X}")),
        }
    }
    o
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_release_name() {
        let q = clean_query("Sintel.2010.1080p.BluRay.x264-VODO.mkv");
        assert!(q.to_ascii_lowercase().contains("sintel"));
        assert!(!q.to_ascii_lowercase().contains("bluray"));
    }

    #[test]
    fn srt_times_become_vtt() {
        let v = srt_to_vtt("1\n00:00:01,000 --> 00:00:02,000\nHi\n");
        assert!(v.starts_with("WEBVTT"));
        assert!(v.contains("00:00:01.000 --> 00:00:02.000"));
    }
}

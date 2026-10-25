//! Subtitle providers: sidecar files, TheSubDB, OpenSubtitles, Podnapisi.

use g9_core::{APP_NAME, APP_VERSION, USER_AGENT};
use md5::{Digest, Md5};
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use url::Url;

const MAX_BODY: usize = 4 * 1024 * 1024;
const HASH_CHUNK: u64 = 64 * 1024;
const REPO: &str = "https://github.com/rreon633-design/G9";

#[derive(Debug, Clone, Serialize)]
pub struct SubHit {
    pub movie: String,
    pub release: String,
    pub language: String,
    pub download: String,
    pub rating: f32,
    pub provider: String,
}

#[derive(Debug, Serialize)]
pub struct SubResult {
    pub vtt: String,
    pub language: String,
    pub movie: String,
    pub release: String,
    pub query: String,
    pub provider: String,
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
    let l = lang.to_ascii_lowercase();
    match l.get(..2).unwrap_or("en") {
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

fn lang2(lang: &str) -> String {
    let l = lang.to_ascii_lowercase();
    if l.len() >= 2 {
        l[..2].to_string()
    } else {
        "en".into()
    }
}

fn host_ok(host: &str) -> bool {
    host.ends_with("opensubtitles.org")
        || host.ends_with("opensubtitles.com")
        || host.ends_with("thesubdb.com")
        || host.ends_with("podnapisi.net")
}

fn http_get(url: &str, ua: &str) -> Result<Vec<u8>, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("unsupported scheme".into());
    }
    let host = parsed.host_str().unwrap_or("");
    if !host_ok(host) {
        return Err("subtitle host not allowed".into());
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(ua)
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(std::time::Duration::from_secs(12))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;
    let mut resp = client.get(parsed).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let mut buf = Vec::new();
    resp.copy_to(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() > MAX_BODY {
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

fn local_file(path: Option<&str>) -> Option<&str> {
    let p = path?;
    if p.is_empty() {
        return None;
    }
    if p.starts_with("http://") || p.starts_with("https://") || p.starts_with("asset:") {
        return None;
    }
    Some(p)
}

fn sidecar(path: &str, language: &str) -> Result<SubResult, String> {
    let stem = std::path::Path::new(path)
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or("no filename")?;
    let dir = std::path::Path::new(path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::path::PathBuf::from("."));
    let l2 = lang2(language);
    let lid = lang_id(language);
    let names = [
        format!("{stem}.{l2}.srt"),
        format!("{stem}.{lid}.srt"),
        format!("{stem}.srt"),
        format!("{stem}.{l2}.vtt"),
        format!("{stem}.vtt"),
    ];
    for name in names {
        let cand = dir.join(&name);
        if cand.is_file() {
            let bytes = std::fs::read(&cand).map_err(|e| e.to_string())?;
            if bytes.len() > MAX_BODY {
                continue;
            }
            let text = String::from_utf8_lossy(&bytes).into_owned();
            return Ok(SubResult {
                vtt: srt_to_vtt(&text),
                language: l2.clone(),
                movie: stem.to_string(),
                release: name,
                query: stem.to_string(),
                provider: "Local file".into(),
            });
        }
    }
    Err("no sidecar subtitle".into())
}

fn subdb_ua() -> String {
    format!("SubDB/1.0 ({APP_NAME}/{APP_VERSION}; {REPO})")
}

fn subdb_hash(path: &str) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    if len < HASH_CHUNK * 2 {
        return Err("file too small for TheSubDB hash".into());
    }
    let mut first = vec![0u8; HASH_CHUNK as usize];
    let mut last = vec![0u8; HASH_CHUNK as usize];
    f.read_exact(&mut first).map_err(|e| e.to_string())?;
    f.seek(SeekFrom::End(-(HASH_CHUNK as i64)))
        .map_err(|e| e.to_string())?;
    f.read_exact(&mut last).map_err(|e| e.to_string())?;
    let mut hasher = Md5::new();
    hasher.update(&first);
    hasher.update(&last);
    Ok(format!("{:x}", hasher.finalize()))
}

fn fetch_thesubdb(path: &str, language: &str) -> Result<SubResult, String> {
    let hash = subdb_hash(path)?;
    let l2 = lang2(language);
    let url = format!("http://api.thesubdb.com/?action=download&hash={hash}&language={l2}");
    let bytes = http_get(&url, &subdb_ua())?;
    let text = String::from_utf8_lossy(&bytes).into_owned();
    if !looks_like_srt(text.as_bytes()) && !looks_like_vtt(text.as_bytes()) {
        return Err("TheSubDB returned no subtitle".into());
    }
    Ok(SubResult {
        vtt: srt_to_vtt(&text),
        language: l2,
        movie: clean_query(path),
        release: hash,
        query: clean_query(path),
        provider: "TheSubDB".into(),
    })
}

fn os_moviehash(path: &str) -> Result<String, String> {
    let mut f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let len = f.metadata().map_err(|e| e.to_string())?.len();
    let mut hash = len;
    let mut word = [0u8; 8];
    let n = (HASH_CHUNK / 8) as usize;
    for _ in 0..n {
        if f.read_exact(&mut word).is_err() {
            break;
        }
        hash = hash.wrapping_add(u64::from_le_bytes(word));
    }
    if len > HASH_CHUNK {
        f.seek(SeekFrom::End(-(HASH_CHUNK as i64)))
            .map_err(|e| e.to_string())?;
        for _ in 0..n {
            f.read_exact(&mut word).map_err(|e| e.to_string())?;
            hash = hash.wrapping_add(u64::from_le_bytes(word));
        }
    }
    Ok(format!("{hash:016x}"))
}

fn search_opensubtitles_url(url: &str, language: &str, query: &str) -> Result<Vec<SubHit>, String> {
    let body = String::from_utf8_lossy(&http_get(url, USER_AGENT)?).into_owned();
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
                movie: tag(block, "movie").unwrap_or_else(|| query.to_string()),
                release: tag(block, "releasename").unwrap_or_default(),
                language: tag(block, "iso639").unwrap_or_else(|| language.to_string()),
                download: dl,
                rating,
                provider: "OpenSubtitles".into(),
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
    Ok(hits)
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
    let hits = search_opensubtitles_url(&url, language, &q)?;
    if hits.is_empty() {
        return Err(format!("no subtitles for “{q}”"));
    }
    Ok(hits)
}

fn search_opensubtitles_hash(path: &str, language: &str) -> Result<Vec<SubHit>, String> {
    let hash = os_moviehash(path)?;
    let lid = lang_id(language);
    let url = format!(
        "https://www.opensubtitles.org/en/search/sublanguageid-{lid}/moviehash-{hash}/simplexml"
    );
    let hits = search_opensubtitles_url(&url, language, &hash)?;
    if hits.is_empty() {
        Err("no OpenSubtitles hash match".into())
    } else {
        Ok(hits)
    }
}

fn search_podnapisi(query: &str, language: &str) -> Result<Vec<SubHit>, String> {
    let l2 = lang2(language);
    let encoded = urlencoding_simple(query);
    let url =
        format!("https://www.podnapisi.net/subtitles/search/old?sXML=1&sL={l2}&sK={encoded}");
    let body = String::from_utf8_lossy(&http_get(&url, USER_AGENT)?).into_owned();
    let mut hits = Vec::new();
    let mut rest = body.as_str();
    while let Some(start) = rest.find("<subtitle>") {
        let chunk = &rest[start..];
        let end = chunk.find("</subtitle>").unwrap_or(chunk.len());
        let block = &chunk[..end];
        let dl = tag(block, "download")
            .or_else(|| {
                tag(block, "url").map(|u| {
                    if u.ends_with("/download") {
                        u
                    } else {
                        format!("{}/download", u.trim_end_matches('/'))
                    }
                })
            })
            .or_else(|| {
                tag(block, "pid")
                    .or_else(|| tag(block, "id"))
                    .map(|id| format!("https://www.podnapisi.net/subtitles/{id}/download"))
            });
        if let Some(dl) = dl {
            let rating = tag(block, "rating")
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0);
            hits.push(SubHit {
                movie: tag(block, "title").unwrap_or_else(|| query.to_string()),
                release: tag(block, "release")
                    .or_else(|| tag(block, "releases"))
                    .unwrap_or_default(),
                language: tag(block, "language").unwrap_or_else(|| l2.clone()),
                download: dl,
                rating,
                provider: "Podnapisi".into(),
            });
        }
        rest = &chunk[end.min(chunk.len()).saturating_add(1)..];
        if hits.len() >= 25 {
            break;
        }
    }
    if hits.is_empty() {
        Err("no Podnapisi match".into())
    } else {
        Ok(hits)
    }
}

fn download_hit(hit: &SubHit, query: &str) -> Result<SubResult, String> {
    let bytes = http_get(&hit.download, USER_AGENT)?;
    let srt = extract_subtitle(&bytes)?;
    Ok(SubResult {
        vtt: srt_to_vtt(&srt),
        language: hit.language.clone(),
        movie: hit.movie.clone(),
        release: hit.release.clone(),
        query: query.to_string(),
        provider: hit.provider.clone(),
    })
}

pub fn fetch_best(query: &str, language: &str, path: Option<&str>) -> Result<SubResult, String> {
    let q = clean_query(query);
    let mut errors: Vec<String> = Vec::new();

    if let Some(file) = local_file(path) {
        match sidecar(file, language) {
            Ok(r) => return Ok(r),
            Err(e) => errors.push(format!("Local: {e}")),
        }
        match fetch_thesubdb(file, language) {
            Ok(r) => return Ok(r),
            Err(e) => errors.push(format!("TheSubDB: {e}")),
        }
        match search_opensubtitles_hash(file, language) {
            Ok(hits) => {
                if let Some(hit) = hits.into_iter().next() {
                    match download_hit(&hit, &q) {
                        Ok(r) => return Ok(r),
                        Err(e) => errors.push(format!("OpenSubtitles hash: {e}")),
                    }
                }
            }
            Err(e) => errors.push(format!("OpenSubtitles hash: {e}")),
        }
    }

    match search(&q, language).or_else(|_| {
        if lang_id(language) == "eng" {
            Err("no subtitles".into())
        } else {
            search(&q, "en")
        }
    }) {
        Ok(hits) => {
            for hit in hits.into_iter().take(3) {
                match download_hit(&hit, &q) {
                    Ok(r) => return Ok(r),
                    Err(e) => errors.push(format!("{}: {e}", hit.provider)),
                }
            }
        }
        Err(e) => errors.push(e),
    }

    if q.len() >= 2 {
        match search_podnapisi(&q, language) {
            Ok(hits) => {
                if let Some(hit) = hits.into_iter().next() {
                    match download_hit(&hit, &q) {
                        Ok(r) => return Ok(r),
                        Err(e) => errors.push(format!("Podnapisi: {e}")),
                    }
                }
            }
            Err(e) => errors.push(format!("Podnapisi: {e}")),
        }
    }

    Err(if errors.is_empty() {
        format!("no subtitles for “{q}”")
    } else {
        format!("no subtitles for “{q}” ({})", errors.join(" · "))
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
            file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
    }
    Err("no subtitle file in archive".into())
}

fn looks_like_srt(b: &[u8]) -> bool {
    let s = String::from_utf8_lossy(&b[..b.len().min(200)]);
    s.contains("-->") && (s.contains(',') || s.contains('.'))
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

    #[test]
    fn sidecar_reads_srt_next_to_video() {
        let dir = std::env::temp_dir().join("g9-sub-sidecar");
        let _ = std::fs::create_dir_all(&dir);
        let video = dir.join("Sintel.mp4");
        let srt = dir.join("Sintel.en.srt");
        std::fs::write(&video, b"fake").unwrap();
        std::fs::write(&srt, b"1\n00:00:01,000 --> 00:00:02,000\nHi\n").unwrap();
        let r = sidecar(video.to_str().unwrap(), "en").unwrap();
        assert_eq!(r.provider, "Local file");
        assert!(r.vtt.contains("WEBVTT"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn subdb_hash_is_md5_of_head_and_tail() {
        let dir = std::env::temp_dir().join("g9-sub-hash");
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("clip.bin");
        let mut data = vec![0u8; (HASH_CHUNK * 2 + 8) as usize];
        let last = data.len() - 1;
        data[0] = 1;
        data[last] = 2;
        std::fs::write(&path, &data).unwrap();
        let h = subdb_hash(path.to_str().unwrap()).unwrap();
        assert_eq!(h.len(), 32);
        let _ = std::fs::remove_dir_all(&dir);
    }
}

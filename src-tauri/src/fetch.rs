use g9_core::USER_AGENT;
use url::Url;

const MAX_BYTES: usize = 64 * 1024 * 1024;
const MAX_REDIRECTS: usize = 5;

/// Fetch a playlist over HTTP(S). Blocks SSRF to file/unix and caps size.
pub fn fetch_playlist(url: &str) -> Result<String, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported playlist scheme: {other}")),
    }
    if parsed.username() != "" {
        return Err(
            "credentials in playlist URLs are not allowed; use Xtream settings instead".into(),
        );
    }

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .timeout(std::time::Duration::from_secs(30))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;

    let mut resp = client.get(parsed).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("playlist HTTP {}", resp.status()));
    }
    let len = resp.content_length().unwrap_or(0);
    if len > MAX_BYTES as u64 {
        return Err("playlist too large".into());
    }
    let mut buf = Vec::new();
    resp.copy_to(&mut buf).map_err(|e| e.to_string())?;
    if buf.len() > MAX_BYTES {
        return Err("playlist too large".into());
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Fetch an XMLTV guide. Many guides are served as a raw `.xml.gz` without a
/// Content-Encoding header, so sniff the gzip magic and inflate here.
pub fn fetch_guide(url: &str) -> Result<String, String> {
    use std::io::Read;

    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        other => return Err(format!("unsupported guide scheme: {other}")),
    }
    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .redirect(reqwest::redirect::Policy::limited(MAX_REDIRECTS))
        .timeout(std::time::Duration::from_secs(60))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client.get(parsed).send().map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("guide HTTP {}", resp.status()));
    }
    let mut buf = Vec::new();
    resp.take(MAX_BYTES as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| e.to_string())?;
    if buf.len() > MAX_BYTES {
        return Err("that guide is too large".into());
    }
    if buf.len() > 2 && buf[0] == 0x1f && buf[1] == 0x8b {
        let mut out = String::new();
        let dec = flate2::read::GzDecoder::new(&buf[..]);
        dec.take(MAX_BYTES as u64)
            .read_to_string(&mut out)
            .map_err(|e| format!("unreadable guide: {e}"))?;
        return Ok(out);
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

//! SSDP / UPnP MediaServer browse (DLNA).

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs, UdpSocket};
use std::time::Duration;
use url::Url;

#[derive(Debug, Clone, Serialize)]
pub struct DlnaServer {
    pub name: String,
    pub location: String,
    pub control_url: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct DlnaItem {
    pub id: String,
    pub title: String,
    pub is_container: bool,
    pub url: Option<String>,
}

fn http_get_raw(url: &str) -> Result<String, String> {
    let parsed = Url::parse(url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("unsupported".into());
    }
    if parsed.scheme() == "https" {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(|e| e.to_string())?;
        let t = client
            .get(url)
            .send()
            .map_err(|e| e.to_string())?
            .text()
            .map_err(|e| e.to_string())?;
        return Ok(t);
    }
    let host = parsed.host_str().ok_or("host")?;
    let port = parsed.port_or_known_default().unwrap_or(80);
    let path = if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    };
    let q = parsed.query().map(|q| format!("?{q}")).unwrap_or_default();
    let addr = format!("{host}:{port}");
    let mut stream = TcpStream::connect_timeout(
        &addr
            .to_socket_addrs()
            .map_err(|e| e.to_string())?
            .next()
            .ok_or("resolve")?,
        Duration::from_secs(4),
    )
    .map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(6))).ok();
    let req = format!(
        "GET {path}{q} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\nUser-Agent: {}\r\n\r\n",
        g9_core::USER_AGENT
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).ok();
    let text = String::from_utf8_lossy(&buf);
    if let Some(i) = text.find("\r\n\r\n") {
        Ok(text[i + 4..].to_string())
    } else {
        Ok(text.into_owned())
    }
}

fn xml_tag(xml: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let a = xml.find(&open)?;
    let rest = &xml[a..];
    let gt = rest.find('>')?;
    if rest.as_bytes().get(gt.saturating_sub(1)) == Some(&b'/') {
        return None;
    }
    let start = gt + 1;
    let close = format!("</{name}>");
    let b = rest[start..].find(&close)? + start;
    Some(rest[start..b].trim().to_string())
}

pub fn discover() -> Result<Vec<DlnaServer>, String> {
    let sock = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    sock.set_read_timeout(Some(Duration::from_millis(900)))
        .map_err(|e| e.to_string())?;
    sock.set_broadcast(true).ok();
    let payload = concat!(
        "M-SEARCH * HTTP/1.1\r\n",
        "HOST: 239.255.255.250:1900\r\n",
        "MAN: \"ssdp:discover\"\r\n",
        "MX: 2\r\n",
        "ST: urn:schemas-upnp-org:device:MediaServer:1\r\n",
        "\r\n"
    );
    sock.send_to(payload.as_bytes(), "239.255.255.250:1900")
        .map_err(|e| e.to_string())?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    let mut buf = [0u8; 2048];
    let deadline = std::time::Instant::now() + Duration::from_millis(2200);
    while std::time::Instant::now() < deadline {
        match sock.recv_from(&mut buf) {
            Ok((n, _)) => {
                let text = String::from_utf8_lossy(&buf[..n]);
                let loc = text.lines().find_map(|l| {
                    let l = l.trim();
                    if l.to_ascii_lowercase().starts_with("location:") {
                        Some(l.splitn(2, ':').nth(1)?.trim().to_string())
                    } else {
                        None
                    }
                });
                let Some(location) = loc else { continue };
                if !seen.insert(location.clone()) {
                    continue;
                }
                if let Ok(desc) = http_get_raw(&location) {
                    let name = xml_tag(&desc, "friendlyName").unwrap_or_else(|| "DLNA".into());
                    let control = content_control(&desc, &location);
                    out.push(DlnaServer {
                        name,
                        location,
                        control_url: control.unwrap_or_default(),
                    });
                }
            }
            Err(_) => break,
        }
    }
    Ok(out)
}

fn content_control(desc: &str, location: &str) -> Option<String> {
    let needle = "urn:schemas-upnp-org:service:ContentDirectory";
    let i = desc.find(needle)?;
    let slice = &desc[i..];
    let url = xml_tag(slice, "controlURL")?;
    if url.starts_with("http") {
        Some(url)
    } else {
        let base = Url::parse(location).ok()?;
        Some(base.join(&url).ok()?.to_string())
    }
}

pub fn browse(control_url: &str, object_id: &str) -> Result<Vec<DlnaItem>, String> {
    if control_url.is_empty() {
        return Err("no control URL".into());
    }
    let parsed = Url::parse(control_url).map_err(|e| e.to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("unsupported".into());
    }
    let id = if object_id.is_empty() { "0" } else { object_id };
    let body = format!(
        r#"<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
<s:Body>
<u:Browse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">
<ObjectID>{id}</ObjectID>
<BrowseFlag>BrowseDirectChildren</BrowseFlag>
<Filter>*</Filter>
<StartingIndex>0</StartingIndex>
<RequestedCount>80</RequestedCount>
<SortCriteria></SortCriteria>
</u:Browse>
</s:Body>
</s:Envelope>"#
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let xml = client
        .post(control_url)
        .header("Content-Type", "text/xml; charset=\"utf-8\"")
        .header(
            "SOAPACTION",
            "\"urn:schemas-upnp-org:service:ContentDirectory:1#Browse\"",
        )
        .body(body)
        .send()
        .map_err(|e| e.to_string())?
        .text()
        .map_err(|e| e.to_string())?;
    let decoded = xml
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&");
    parse_didl(&decoded)
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let p = format!("{name}=\"");
    let i = tag.find(&p)? + p.len();
    let j = tag[i..].find('"')? + i;
    Some(tag[i..j].to_string())
}

fn parse_didl(xml: &str) -> Result<Vec<DlnaItem>, String> {
    let mut items = Vec::new();
    for (open, close, container) in [
        ("<container", "</container>", true),
        ("<item", "</item>", false),
    ] {
        let mut rest = xml;
        while let Some(s) = rest.find(open) {
            let chunk = &rest[s..];
            let end = chunk.find(close).unwrap_or(chunk.len());
            let block = &chunk[..end];
            let id = attr(block, "id").unwrap_or_default();
            let title = xml_tag(block, "dc:title")
                .or_else(|| xml_tag(block, "title"))
                .unwrap_or_else(|| id.clone());
            let url = if container { None } else { res_url(block) };
            if !id.is_empty() {
                items.push(DlnaItem {
                    id,
                    title,
                    is_container: container,
                    url,
                });
            }
            rest = &chunk[end.min(chunk.len()).saturating_add(1)..];
            if items.len() >= 80 {
                break;
            }
        }
    }
    Ok(items)
}

fn res_url(block: &str) -> Option<String> {
    let mut rest = block;
    while let Some(s) = rest.find("<res") {
        let chunk = &rest[s..];
        let gt = chunk.find('>')?;
        let after = &chunk[gt + 1..];
        let end = after.find("</res>")?;
        let url = after[..end].trim();
        if url.starts_with("http") {
            return Some(url.to_string());
        }
        rest = &after[end..];
    }
    None
}

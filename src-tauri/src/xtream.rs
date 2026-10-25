//! Xtream Codes compatible portals: log in, list live channels, hand back an M3U.
//!
//! G9 still stores channels in SQLite through the normal import path, so a
//! portal import is just "an M3U that we generated for you".

use std::time::Duration;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct XtreamResult {
    pub name: String,
    pub m3u: String,
    pub channels: usize,
    pub groups: usize,
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent(g9_core::USER_AGENT)
        .build()
        .map_err(|e| e.to_string())
}

/// `https://host:port` with no trailing slash, or an error.
pub fn normalise_server(raw: &str) -> Result<String, String> {
    let mut s = raw.trim().to_string();
    if s.is_empty() {
        return Err("Server address is required".into());
    }
    if !s.to_ascii_lowercase().starts_with("http://")
        && !s.to_ascii_lowercase().starts_with("https://")
    {
        s = format!("http://{s}");
    }
    while s.ends_with('/') {
        s.pop();
    }
    let parsed = url::Url::parse(&s).map_err(|_| "That server address is not a URL".to_string())?;
    if parsed.host_str().unwrap_or("").is_empty() {
        return Err("That server address has no host".into());
    }
    Ok(s)
}

fn get_json(client: &reqwest::blocking::Client, url: &str) -> Result<serde_json::Value, String> {
    let resp = client
        .get(url)
        .send()
        .map_err(|_| "Could not reach the portal".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Portal answered {}", resp.status().as_u16()));
    }
    resp.json::<serde_json::Value>()
        .map_err(|_| "The portal did not return JSON".to_string())
}

fn escape_attr(s: &str) -> String {
    s.replace('"', "'").replace(['\r', '\n'], " ")
}

/// Build an M3U from already-fetched portal JSON (kept separate for tests).
pub fn build_m3u(
    streams: &serde_json::Value,
    categories: Option<&serde_json::Value>,
    server: &str,
    user: &str,
    pass: &str,
) -> (String, usize, usize) {
    let mut names: Vec<(String, String)> = Vec::new();
    if let Some(list) = categories.and_then(|c| c.as_array()) {
        for c in list {
            let id = c
                .get("category_id")
                .map(|v| v.to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let name = c
                .get("category_name")
                .and_then(|v| v.as_str())
                .unwrap_or("Live")
                .to_string();
            names.push((id, name));
        }
    }
    let lookup = |id: &str| -> String {
        names
            .iter()
            .find(|(cid, _)| cid == id)
            .map(|(_, n)| n.clone())
            .unwrap_or_else(|| "Live".to_string())
    };

    let mut out = String::from("#EXTM3U\n");
    let mut groups = std::collections::BTreeSet::new();
    let mut count = 0usize;
    if let Some(list) = streams.as_array() {
        for ch in list {
            let name = ch.get("name").and_then(|v| v.as_str()).unwrap_or("Channel");
            let id = ch
                .get("stream_id")
                .map(|v| v.to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            if id.is_empty() {
                continue;
            }
            let cat = ch
                .get("category_id")
                .map(|v| v.to_string().trim_matches('"').to_string())
                .unwrap_or_default();
            let group = lookup(&cat);
            let logo = ch.get("stream_icon").and_then(|v| v.as_str()).unwrap_or("");
            let tvg = ch
                .get("epg_channel_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let url = format!("{server}/live/{user}/{pass}/{id}.m3u8");
            out.push_str(&format!(
                "#EXTINF:-1 tvg-id=\"{}\" tvg-logo=\"{}\" group-title=\"{}\",{}\n{}\n",
                escape_attr(tvg),
                escape_attr(logo),
                escape_attr(&group),
                name.replace(['\r', '\n'], " "),
                url
            ));
            groups.insert(group);
            count += 1;
        }
    }
    (out, count, groups.len())
}

pub fn import(
    server: &str,
    user: &str,
    pass: &str,
    name: Option<String>,
) -> Result<XtreamResult, String> {
    if user.trim().is_empty() || pass.is_empty() {
        return Err("Username and password are required".into());
    }
    let server = normalise_server(server)?;
    let client = client()?;

    // A player_api login tells us whether the credentials work at all.
    let login_url = format!("{server}/player_api.php?username={user}&password={pass}");
    let login = get_json(&client, &login_url)?;
    let auth = login
        .get("user_info")
        .and_then(|u| u.get("auth"))
        .and_then(|a| a.as_i64())
        .unwrap_or(0);
    if auth != 1 {
        return Err("The portal rejected those credentials".into());
    }

    let cats = get_json(
        &client,
        &format!(
            "{server}/player_api.php?username={user}&password={pass}&action=get_live_categories"
        ),
    )
    .ok();
    let streams = get_json(
        &client,
        &format!("{server}/player_api.php?username={user}&password={pass}&action=get_live_streams"),
    )?;

    let (m3u, channels, groups) = build_m3u(&streams, cats.as_ref(), &server, user, pass);
    if channels == 0 {
        return Err("That portal returned no live channels".into());
    }
    let label = name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| format!("{} · {}", "Xtream", host_of(&server)));
    Ok(XtreamResult {
        name: label,
        m3u,
        channels,
        groups,
    })
}

fn host_of(server: &str) -> String {
    server
        .split("://")
        .nth(1)
        .unwrap_or(server)
        .split('/')
        .next()
        .unwrap_or(server)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn server_is_normalised() {
        assert_eq!(
            normalise_server(" example.com:8080/ ").unwrap(),
            "http://example.com:8080"
        );
        assert_eq!(normalise_server("https://x.tv/").unwrap(), "https://x.tv");
        assert!(normalise_server("").is_err());
        assert!(normalise_server("http://").is_err());
    }

    #[test]
    fn m3u_generation_uses_groups_and_logos() {
        let streams = serde_json::json!([
            {"stream_id": 12, "name": "News HD", "category_id": "3", "stream_icon": "https://img/1.png", "epg_channel_id": "news.uk"},
            {"stream_id": 13, "name": "Sports", "category_id": "4", "stream_icon": ""}
        ]);
        let cats = serde_json::json!([
            {"category_id": "3", "category_name": "News"},
            {"category_id": "4", "category_name": "Sport"}
        ]);
        let (m3u, channels, groups) = build_m3u(&streams, Some(&cats), "http://p.tv", "u", "p");
        assert_eq!(channels, 2);
        assert_eq!(groups, 2);
        assert!(m3u.starts_with("#EXTM3U"));
        assert!(m3u.contains("group-title=\"News\""));
        assert!(m3u.contains("tvg-id=\"news.uk\""));
        assert!(m3u.contains("http://p.tv/live/u/p/12.m3u8"));

        // The generated text must survive G9's own parser.
        let (parsed, report) = g9_iptv::parse_m3u(&m3u, g9_iptv::ParseOptions::default()).unwrap();
        assert_eq!(parsed.len(), 2);
        assert_eq!(report.group_count, 2);
        assert_eq!(parsed[0].tvg_logo.as_deref(), Some("https://img/1.png"));
    }
}

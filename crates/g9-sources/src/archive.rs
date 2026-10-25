//! Internet Archive as a source that needs no account, key or setup.
//!
//! The archive hosts millions of public-domain and Creative-Commons films, and
//! its search/metadata endpoints are plain JSON. G9 ships **no catalogue** of its
//! own: this module only knows the shapes of two public APIs, exactly like the
//! Stremio and RSS clients next to it.
//!
//! * `advancedsearch.php` — search and browse (`mediatype:movies` plus a collection).
//! * `metadata/{id}` — one item: files, sizes, runtime, description.
//!
//! Everything here is a pure function over text, so it is tested offline.

use serde_json::Value;

use crate::html;
use crate::model::{Details, Episode, Item, Kind, Quality, Stream};

pub const API: &str = "https://archive.org";

/// Collections that are genuinely free to watch. Nothing here is a pirate site:
/// these are the archive's own public-domain and CC film collections.
pub const COLLECTIONS: &[(&str, &str)] = &[
    ("feature_films", "Public-domain films"),
    ("classic_tv", "Classic TV"),
    ("film_noir", "Film noir"),
    ("scifi_horror", "Sci-fi & horror"),
    ("animationandcartoons", "Animation"),
];

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Search/browse URL. `query` empty means "browse this collection".
pub fn search_url(query: &str, collection: &str, rows: u32, page: u32) -> String {
    let mut q = String::from("mediatype:movies");
    if !collection.is_empty() {
        q.push_str(&format!(" AND collection:{collection}"));
    }
    if !query.trim().is_empty() {
        q.push_str(&format!(" AND ({})", query.trim()));
    }
    format!(
        "{API}/advancedsearch.php?q={}&fl[]=identifier&fl[]=title&fl[]=year&fl[]=description\
         &fl[]=downloads&fl[]=avg_rating&sort[]=downloads+desc&rows={rows}&page={page}&output=json",
        enc(&q)
    )
}

/// One item's metadata (files, runtime, description).
pub fn metadata_url(id: &str) -> String {
    format!("{API}/metadata/{}", enc(id.strip_prefix('-').unwrap_or(id)))
}

fn year_of(v: &Value) -> Option<i32> {
    v.as_i64()
        .map(|n| n as i32)
        .or_else(|| v.as_str().and_then(|s| s.get(0..4)?.parse().ok()))
}

/// `{"response":{"docs":[…]}}` → items.
pub fn parse_search(body: &str, source_id: i64) -> Result<Vec<Item>, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|_| "unreadable search results".to_string())?;
    let docs = v
        .get("response")
        .and_then(|r| r.get("docs"))
        .and_then(Value::as_array)
        .ok_or_else(|| "that search returned nothing".to_string())?;
    let mut out = Vec::new();
    for d in docs {
        let Some(id) = d.get("identifier").and_then(Value::as_str) else {
            continue;
        };
        let title = d
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .trim()
            .to_string();
        if title.is_empty() {
            continue;
        }
        let mut item = Item::new(format!("{source_id}:{id}"), title, Kind::Movie);
        item.poster = Some(format!("{API}/services/img/{}", enc(id)));
        item.year = d.get("year").and_then(year_of);
        item.score = d
            .get("avg_rating")
            .and_then(Value::as_f64)
            .map(|f| f as f32);
        item.synopsis = d
            .get("description")
            .and_then(Value::as_str)
            .map(|s| html::text_of(s).chars().take(320).collect::<String>());
        out.push(item);
    }
    Ok(out)
}

fn quality_of(name: &str) -> Quality {
    let n = name.to_ascii_lowercase();
    if n.contains("1080") || n.contains("720") {
        Quality::Hd
    } else if n.contains("480") {
        Quality::Sd
    } else {
        Quality::Unknown
    }
}

fn human_size(bytes: u64) -> String {
    let gb = bytes as f64 / 1_073_741_824.0;
    if gb >= 1.0 {
        format!("{gb:.1} GB")
    } else {
        format!("{:.0} MB", bytes as f64 / 1_048_576.0)
    }
}

/// Is this file something a `<video>` element can play?
fn playable(name: &str, format: &str) -> bool {
    let n = name.to_ascii_lowercase();
    let f = format.to_ascii_lowercase();
    if n.ends_with(".mp4") || n.ends_with(".m4v") {
        return true;
    }
    // The archive's derivatives are the web-friendly ones; originals are often
    // MPEG-2 or MKV that WebView cannot decode.
    (n.ends_with(".ogv") || n.ends_with(".webm")) && !f.contains("original")
}

fn seconds_of(v: &Value) -> Option<i32> {
    v.as_f64().map(|f| f as i32).or_else(|| {
        v.as_str()
            .and_then(|s| s.parse::<f64>().ok())
            .map(|f| f as i32)
    })
}

/// One item → details plus every playable file as a stream.
pub fn parse_item(
    body: &str,
    source_id: i64,
    provider: &str,
) -> Result<(Details, Vec<Stream>), String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "unreadable item".to_string())?;
    let meta = v.get("metadata").cloned().unwrap_or(Value::Null);
    let id = meta
        .get("identifier")
        .and_then(Value::as_str)
        .or_else(|| v.get("dir").and_then(Value::as_str))
        .ok_or_else(|| "that item has no identifier".to_string())?;

    let title = meta
        .get("title")
        .and_then(Value::as_str)
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| id.to_string());

    let mut item = Item::new(format!("{source_id}:{id}"), title, Kind::Movie);
    item.poster = Some(format!("{API}/services/img/{}", enc(id)));
    item.year = meta.get("year").and_then(year_of).or_else(|| {
        meta.get("date")
            .and_then(Value::as_str)
            .and_then(|s| s.get(0..4)?.parse().ok())
    });
    item.synopsis = meta
        .get("description")
        .and_then(Value::as_str)
        .map(|s| html::text_of(s).chars().take(420).collect::<String>());
    if let Some(g) = meta.get("genre") {
        item.genres = match g {
            Value::Array(a) => a
                .iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .take(4)
                .collect(),
            Value::String(s) => s
                .split([';', ','])
                .map(|x| x.trim().to_string())
                .filter(|x| !x.is_empty())
                .take(4)
                .collect(),
            _ => Vec::new(),
        };
    }
    if let Some(r) = meta.get("runtime").and_then(seconds_of) {
        item.subtitle = Some(format!("{} min", (r / 60).max(1)));
    }

    let mut streams: Vec<Stream> = Vec::new();
    if let Some(files) = v.get("files").and_then(Value::as_array) {
        for f in files {
            let Some(name) = f.get("name").and_then(Value::as_str) else {
                continue;
            };
            let format = f.get("format").and_then(Value::as_str).unwrap_or_default();
            if !playable(name, format) {
                continue;
            }
            let size = f
                .get("size")
                .and_then(|s| s.as_str().and_then(|x| x.parse::<u64>().ok()));
            let mut s = Stream::http(
                format!("{API}/download/{id}/{}", enc(name)),
                match size {
                    Some(b) => format!("{format} · {}", human_size(b)),
                    None => format.to_string(),
                },
                provider,
            );
            s.quality = quality_of(name);
            s.size = size;
            streams.push(s);
        }
    }
    if streams.is_empty() {
        return Err("That item has no web-playable file".to_string());
    }
    // Biggest file first: usually the higher-quality derivative.
    streams.sort_by_key(|a| std::cmp::Reverse(a.size.unwrap_or(0)));
    item.quality = streams[0].quality;

    let details = Details {
        item,
        episodes: Vec::<Episode>::new(),
        season: None,
        seasons: Vec::new(),
    };
    Ok((details, streams))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH: &str = r#"{"response":{"numFound":2,"docs":[
        {"identifier":"night_of_the_living_dead","title":"Night of the Living Dead","year":"1968",
         "description":"<p>A <b>classic</b>.</p>","downloads":123456,"avg_rating":4.6},
        {"identifier":"-bad-","title":"  ","year":1954}
    ]}}"#;

    const ITEM: &str = r#"{"metadata":{"identifier":"night_of_the_living_dead",
        "title":"Night of the Living Dead","year":"1968","runtime":"5760",
        "description":"<p>Romero.</p>","genre":["Horror","Classic"]},
        "files":[
          {"name":"night.mp4","format":"h.264","size":"734003200"},
          {"name":"night_512kb.mp4","format":"h.264","size":"367001600"},
          {"name":"night.ogv","format":"Ogg Video","size":"500000000"},
          {"name":"night.mpg","format":"MPEG2","size":"900000000"},
          {"name":"night_meta.xml","format":"Metadata"}
        ]}"#;

    #[test]
    fn search_builds_items() {
        let items = parse_search(SEARCH, 7).unwrap();
        assert_eq!(items.len(), 1, "blank titles are dropped");
        assert_eq!(items[0].id, "7:night_of_the_living_dead");
        assert_eq!(items[0].title, "Night of the Living Dead");
        assert_eq!(items[0].year, Some(1968));
        assert_eq!(items[0].score, Some(4.6));
        assert!(items[0].synopsis.as_deref().unwrap().contains("classic"));
        assert!(!items[0].synopsis.as_deref().unwrap().contains('<'));
        assert!(items[0]
            .poster
            .as_deref()
            .unwrap()
            .starts_with("https://archive.org/services/img/"));
    }

    #[test]
    fn search_rejects_junk() {
        assert!(parse_search("not json", 1).is_err());
        assert!(parse_search("{}", 1).is_err());
        assert!(parse_search(r#"{"response":{"docs":[]}}"#, 1)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn item_picks_playable_files_only() {
        let (details, streams) = parse_item(ITEM, 3, "Internet Archive").unwrap();
        assert_eq!(details.item.id, "3:night_of_the_living_dead");
        assert_eq!(details.item.year, Some(1968));
        assert_eq!(details.item.subtitle.as_deref(), Some("96 min"));
        assert_eq!(details.item.genres, vec!["Horror", "Classic"]);
        // mp4 + ogv play; .mpg (MPEG-2) and the xml do not.
        assert_eq!(streams.len(), 3);
        assert!(
            streams[0]
                .url
                .ends_with("/download/night_of_the_living_dead/night.ogv")
                || streams[0].url.ends_with("night.mp4")
        );
        assert_eq!(streams[0].size, Some(734003200), "largest first");
        assert_eq!(streams[0].provider, "Internet Archive");
        assert!(!streams.iter().any(|s| s.magnet));
        assert!(details.episodes.is_empty());
    }

    #[test]
    fn item_without_video_is_an_error() {
        let body = r#"{"metadata":{"identifier":"x","title":"X"},"files":[{"name":"x.txt","format":"Text"}]}"#;
        assert!(parse_item(body, 1, "IA").is_err());
    }

    #[test]
    fn urls_are_encoded() {
        let u = search_url("la nuit & co", "feature_films", 24, 1);
        assert!(u.contains("mediatype%3Amovies"));
        assert!(u.contains("feature_films"));
        assert!(!u.contains(' '), "no raw spaces in a URL");
        assert!(u.contains("rows=24"));
        assert!(metadata_url("abc").ends_with("/metadata/abc"));
    }
}

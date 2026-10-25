//! Stremio addon protocol — the one open, stable way to point G9 at a catalog the
//! user installed. Reference: `stremio-addon-sdk/docs/protocol.md`.
//!
//! Routes used:
//! ```text
//! GET {base}/manifest.json
//! GET {base}/catalog/{type}/{id}.json                 (or /{extra}.json)
//! GET {base}/meta/{type}/{id}.json
//! GET {base}/stream/{type}/{videoId}.json
//! GET {base}/subtitles/{type}/{videoId}.json
//! ```

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::model::{Details, Episode, Item, Kind, Quality, Stream, Subtitle};

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Catalog {
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    /// Extra properties (`search`, `genre`, `skip`) this catalog accepts.
    #[serde(default)]
    pub extra: Vec<Extra>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Extra {
    #[serde(default)]
    pub name: String,
    #[serde(rename = "isRequired", default)]
    pub required: bool,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub types: Vec<String>,
    #[serde(default)]
    pub catalogs: Vec<Catalog>,
    #[serde(default)]
    pub resources: Vec<Value>,
    #[serde(rename = "idPrefixes", default)]
    pub id_prefixes: Vec<String>,
}

impl Manifest {
    /// Does this addon declare a stream resource for `kind`?
    pub fn can_stream(&self, kind: &str) -> bool {
        self.resources.iter().any(|r| match r {
            Value::String(s) => s == "stream",
            Value::Object(o) => {
                let name = o.get("name").and_then(Value::as_str) == Some("stream");
                let types_ok = o
                    .get("types")
                    .and_then(Value::as_array)
                    .map(|t| t.iter().any(|x| x.as_str() == Some(kind)))
                    .unwrap_or(true);
                name && types_ok
            }
            _ => false,
        })
    }

    pub fn can_meta(&self, kind: &str) -> bool {
        self.resources.iter().any(|r| match r {
            Value::String(s) => s == "meta",
            Value::Object(o) => {
                o.get("name").and_then(Value::as_str) == Some("meta")
                    && o.get("types")
                        .and_then(Value::as_array)
                        .map(|t| t.iter().any(|x| x.as_str() == Some(kind)))
                        .unwrap_or(true)
            }
            _ => false,
        })
    }

    /// A short name for the source list (`"Torrentio"` out of a long `name`).
    pub fn short_name(&self) -> String {
        let n = self.name.trim();
        if n.is_empty() {
            "Stremio addon".to_string()
        } else if n.chars().count() > 42 {
            n.chars().take(42).collect::<String>() + "…"
        } else {
            n.to_string()
        }
    }
}

/// `<base>/catalog/<type>/<id>.json`, or `/…/<extra>.json` when `extra` is set.
pub fn catalog_url(base: &str, kind: &str, id: &str, extra: Option<&str>) -> String {
    let base = crate::trim_slash(base);
    match extra.filter(|e| !e.is_empty()) {
        Some(e) => format!("{base}/catalog/{kind}/{id}/{e}.json"),
        None => format!("{base}/catalog/{kind}/{id}.json"),
    }
}

/// `search=` is the one extra every addon understands; `skip=` pages it.
pub fn search_extra(query: &str, skip: u32) -> String {
    let q: String = query
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || " -_.'".contains(c) {
                c
            } else {
                ' '
            }
        })
        .collect();
    let q = q.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut out = format!("search={}", urlencode(&q));
    if skip > 0 {
        out.push_str(&format!("&skip={skip}"));
    }
    out
}

fn urlencode(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
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

pub fn meta_url(base: &str, kind: &str, id: &str) -> String {
    format!(
        "{}/meta/{kind}/{}.json",
        crate::trim_slash(base),
        urlencode(id)
    )
}

pub fn stream_url(base: &str, kind: &str, video_id: &str) -> String {
    format!(
        "{}/stream/{kind}/{}.json",
        crate::trim_slash(base),
        urlencode(video_id)
    )
}

pub fn subtitle_url(base: &str, kind: &str, video_id: &str) -> String {
    format!(
        "{}/subtitles/{kind}/{}.json",
        crate::trim_slash(base),
        urlencode(video_id)
    )
}

/// Parse `manifest.json`. Rejects bodies that are not an addon manifest.
pub fn parse_manifest(body: &str) -> Result<Manifest, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|_| "that URL is not an addon manifest".to_string())?;
    let m: Manifest =
        serde_json::from_value(v).map_err(|_| "that addon manifest is incomplete".to_string())?;
    if m.catalogs.is_empty() && m.resources.is_empty() {
        return Err("that addon lists no catalogs or resources".into());
    }
    Ok(m)
}

/// Read a list of people (`cast`) out of a meta object. Entries may be bare
/// strings or objects with a `name`.
fn names_in(m: &Value, key: &str) -> Vec<String> {
    m.get(key)
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|p| {
                    p.as_str()
                        .map(str::to_string)
                        .or_else(|| p.get("name").and_then(Value::as_str).map(str::to_string))
                })
                .take(12)
                .collect()
        })
        .unwrap_or_default()
}

fn poster_of(meta: &Value) -> Option<String> {
    meta.get("poster")
        .or_else(|| meta.get("background"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

/// `{metas:[{…}]}` from a catalog response.
pub fn parse_catalogs(body: &str, kind_hint: &str, source_id: i64) -> Result<Vec<Item>, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "unreadable catalog".to_string())?;
    let arr = v
        .get("metas")
        .and_then(Value::as_array)
        .ok_or_else(|| "that catalog returned no items".to_string())?;
    let mut out = Vec::new();
    for m in arr {
        let Some(id) = m.get("id").and_then(Value::as_str) else {
            continue;
        };
        let title = m
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string();
        let kind = m
            .get("type")
            .and_then(Value::as_str)
            .and_then(Kind::from_stremio)
            .or_else(|| Kind::from_stremio(kind_hint))
            .unwrap_or(Kind::Movie);
        let mut item = Item::new(format!("{source_id}:{id}"), title, kind);
        item.poster = poster_of(m);
        item.backdrop = m
            .get("background")
            .and_then(Value::as_str)
            .map(str::to_string);
        item.synopsis = m
            .get("description")
            .and_then(Value::as_str)
            .map(crate::html::text_of);
        item.year = m
            .get("year")
            .and_then(|y| {
                y.as_str()
                    .and_then(|s| s.parse::<i32>().ok())
                    .or_else(|| y.as_i64().map(|v| v as i32))
            })
            .or_else(|| {
                m.get("releaseInfo")
                    .and_then(Value::as_str)
                    .and_then(|s| s.get(..4)?.parse().ok())
            });
        item.score = m
            .get("imdbRating")
            .and_then(|s| s.as_str().and_then(|x| x.parse::<f32>().ok()))
            .or_else(|| m.get("score").and_then(Value::as_f64).map(|f| f as f32));
        item.genres = m
            .get("genres")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|g| g.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
        item.cast = names_in(m, "cast");
        if let Some(s) = m.get("runtime").and_then(Value::as_str) {
            item.subtitle = Some(s.to_string());
        }
        if let Some(b) = m.get("released").and_then(Value::as_str) {
            item.badge = Some(b.to_string());
        }
        out.push(item);
    }
    Ok(out)
}

/// `{meta:{…}}` → details with a season's episodes.
pub fn parse_meta(body: &str, source_id: i64, want_season: Option<i32>) -> Result<Details, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "unreadable details".to_string())?;
    let m = v
        .get("meta")
        .ok_or_else(|| "that addon returned no details".to_string())?;
    let id = m.get("id").and_then(Value::as_str).unwrap_or_default();
    let kind = m
        .get("type")
        .and_then(Value::as_str)
        .and_then(Kind::from_stremio)
        .unwrap_or(Kind::Series);
    let mut item = Item::new(
        format!("{source_id}:{id}"),
        m.get("name").and_then(Value::as_str).unwrap_or(id),
        kind,
    );
    item.poster = poster_of(m);
    item.backdrop = m
        .get("background")
        .and_then(Value::as_str)
        .map(str::to_string);
    item.synopsis = m
        .get("description")
        .and_then(Value::as_str)
        .map(crate::html::text_of);
    item.year = m.get("year").and_then(|y| y.as_i64().map(|v| v as i32));
    item.score = m
        .get("imdbRating")
        .and_then(|s| s.as_str().and_then(|x| x.parse().ok()));
    item.genres = m
        .get("genres")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|g| g.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    item.cast = names_in(m, "cast");

    let mut episodes: Vec<Episode> = m
        .get("videos")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let id = v.get("id").and_then(Value::as_str)?;
                    let season = v.get("season").and_then(Value::as_i64).map(|s| s as i32);
                    let number = v
                        .get("episode")
                        .and_then(Value::as_i64)
                        .map(|s| s as i32)
                        .unwrap_or(0);
                    Some(Episode {
                        id: id.to_string(),
                        number,
                        season,
                        title: v
                            .get("name")
                            .and_then(Value::as_str)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .unwrap_or_else(|| format!("Episode {number}")),
                        overview: v
                            .get("overview")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        thumb: v
                            .get("thumbnail")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                        runtime: v
                            .get("runtime")
                            .and_then(Value::as_str)
                            .and_then(parse_minutes),
                        released: v
                            .get("released")
                            .and_then(Value::as_str)
                            .map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    episodes.sort_by_key(|e| (e.season.unwrap_or(0), e.number));

    let mut seasons: Vec<i32> = episodes.iter().filter_map(|e| e.season).collect();
    seasons.sort_unstable();
    seasons.dedup();

    let season = want_season
        .filter(|s| seasons.contains(s))
        .or_else(|| seasons.first().copied());
    if let Some(s) = season {
        episodes.retain(|e| e.season == Some(s));
    }
    Ok(Details {
        item,
        episodes,
        season,
        seasons,
    })
}

fn parse_minutes(raw: &str) -> Option<i32> {
    let digits: String = raw.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse().ok()
}

/// `{streams:[…]}` → playable list, best first.
pub fn parse_streams(body: &str, provider: &str) -> Result<Vec<Stream>, String> {
    let v: Value = serde_json::from_str(body).map_err(|_| "unreadable stream list".to_string())?;
    let arr = v
        .get("streams")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut out = Vec::new();
    for s in &arr {
        let name = s.get("name").and_then(Value::as_str).unwrap_or("");
        let desc = s.get("title").and_then(Value::as_str).unwrap_or("");
        let label = [name, desc]
            .iter()
            .filter(|x| !x.trim().is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(" · ");
        let hints = s.get("behaviorHints");
        let mut subtitles: Vec<Subtitle> = Vec::new();
        if let Some(subs) = s.get("subtitles").and_then(Value::as_array) {
            for sub in subs {
                if let (Some(url), Some(lang)) = (
                    sub.get("url").and_then(Value::as_str),
                    sub.get("lang").and_then(Value::as_str),
                ) {
                    subtitles.push(Subtitle {
                        label: sub
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or(lang)
                            .to_string(),
                        url: url.to_string(),
                        lang: lang.to_string(),
                    });
                }
            }
        }
        if let Some(url) = s
            .get("url")
            .and_then(Value::as_str)
            .filter(|u| !u.is_empty())
        {
            let mut st = Stream::http(
                url,
                if label.is_empty() { "Stream" } else { &label },
                provider,
            );
            st.quality = Quality::from_label(&format!(
                "{label} {}",
                hints
                    .and_then(|h| h.get("filename"))
                    .and_then(Value::as_str)
                    .unwrap_or("")
            ));
            st.subtitles = subtitles;
            out.push(st);
            continue;
        }
        if let Some(hash) = s.get("infoHash").and_then(Value::as_str) {
            let magnet = build_magnet(
                hash,
                hints
                    .and_then(|h| h.get("filename"))
                    .and_then(Value::as_str),
            );
            let mut st = Stream::magnet(
                magnet,
                if label.is_empty() { "Magnet" } else { &label },
                provider,
            );
            st.quality = Quality::from_label(&label);
            st.subtitles = subtitles;
            out.push(st);
        }
    }
    if out.is_empty() {
        return Err("no streams for this one".into());
    }
    crate::model::rank_streams(&mut out);
    Ok(out)
}

/// `urn:btih` magnet for an info hash, with the display name when we have one.
pub fn build_magnet(info_hash: &str, name: Option<&str>) -> String {
    let mut m = format!("magnet:?xt=urn:btih:{info_hash}");
    if let Some(n) = name.filter(|n| !n.is_empty()) {
        m.push_str("&dn=");
        m.push_str(&urlencode(n));
    }
    m
}

/// `{subtitles:[…]}` from a `/subtitles/` route.
pub fn parse_subtitles(body: &str) -> Vec<Subtitle> {
    let Ok(v) = serde_json::from_str::<Value>(body) else {
        return Vec::new();
    };
    v.get("subtitles")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(|s| {
                    Some(Subtitle {
                        label: s
                            .get("id")
                            .and_then(Value::as_str)
                            .unwrap_or("Subtitle")
                            .to_string(),
                        url: s.get("url").and_then(Value::as_str)?.to_string(),
                        lang: s
                            .get("lang")
                            .and_then(Value::as_str)
                            .unwrap_or("en")
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MANIFEST: &str = r#"{
        "id": "com.example.demo", "name": "Demo Addon", "version": "1.0.0",
        "description": "demo",
        "types": ["movie", "series"],
        "catalogs": [
            {"type": "movie", "id": "top", "name": "Popular"},
            {"type": "series", "id": "trending", "name": "Trending", "extra": [{"name": "search", "isRequired": true}]}
        ],
        "resources": ["catalog", {"name": "stream", "types": ["movie", "series"]}, {"name": "meta", "types": ["movie"]}],
        "idPrefixes": ["tt"]
    }"#;

    #[test]
    fn manifest_is_read() {
        let m = parse_manifest(MANIFEST).unwrap();
        assert_eq!(m.catalogs.len(), 2);
        assert!(m.can_stream("movie"));
        assert!(m.can_stream("series"));
        assert!(!m.can_stream("channel"));
        assert!(m.can_meta("movie"));
        assert!(!m.can_meta("series"));
        assert_eq!(m.short_name(), "Demo Addon");
    }

    #[test]
    fn manifest_rejects_html_and_empty() {
        assert!(parse_manifest("<html>nope</html>").is_err());
        assert!(parse_manifest(r#"{"name":"x"}"#).is_err());
    }

    #[test]
    fn urls_are_built_with_extra() {
        assert_eq!(
            catalog_url("https://a.b/", "movie", "top", None),
            "https://a.b/catalog/movie/top.json"
        );
        assert_eq!(
            catalog_url(
                "https://a.b",
                "series",
                "trending",
                Some("search=bat%20man")
            ),
            "https://a.b/catalog/series/trending/search=bat%20man.json"
        );
        assert_eq!(search_extra("bat man", 0), "search=bat%20man");
        assert_eq!(search_extra("bat man", 100), "search=bat%20man&skip=100");
        assert_eq!(
            meta_url("https://a.b/", "movie", "tt1"),
            "https://a.b/meta/movie/tt1.json"
        );
        assert_eq!(
            stream_url("https://a.b", "series", "tt1:1:2"),
            "https://a.b/stream/series/tt1%3A1%3A2.json"
        );
    }

    #[test]
    fn catalogs_become_cards() {
        let body = r#"{"metas":[
            {"id":"tt1","type":"movie","name":"First","poster":"https://p/1.jpg","year":"2024","imdbRating":"8.1","genres":["Sci-Fi"],"cast":["Ada One",{"name":"Bo Two"}]},
            {"id":"tt2","name":"Second","releaseInfo":"2021-2022","description":"<b>Two</b> lines"}
        ]}"#;
        let items = parse_catalogs(body, "series", 7).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "7:tt1");
        assert_eq!(items[0].kind, Kind::Movie);
        assert_eq!(items[0].year, Some(2024));
        assert_eq!(items[0].score, Some(8.1));
        assert_eq!(items[1].kind, Kind::Series); // falls back to the catalog type
        assert_eq!(items[1].year, Some(2021));
        assert_eq!(items[1].synopsis.as_deref(), Some("Two lines"));
        assert_eq!(
            items[0].cast,
            vec!["Ada One".to_string(), "Bo Two".to_string()]
        );
    }

    #[test]
    fn meta_builds_seasons_and_episodes() {
        let body = r#"{"meta":{"id":"tt9","type":"series","name":"Show","year":2023,
            "videos":[
              {"id":"tt9:1:2","season":1,"episode":2,"name":"Two","released":"2023-01-02"},
              {"id":"tt9:2:1","season":2,"episode":1,"name":"Next","runtime":"48 min"},
              {"id":"tt9:1:1","season":1,"episode":1,"name":""}
            ]}}"#;
        let d = parse_meta(body, 3, Some(1)).unwrap();
        assert_eq!(d.seasons, vec![1, 2]);
        assert_eq!(d.season, Some(1));
        assert_eq!(d.episodes.len(), 2);
        assert_eq!(d.episodes[0].id, "tt9:1:1");
        assert_eq!(d.episodes[0].title, "Episode 1");
        assert_eq!(d.item.id, "3:tt9");

        let d2 = parse_meta(body, 3, Some(2)).unwrap();
        assert_eq!(d2.episodes.len(), 1);
        assert_eq!(d2.episodes[0].runtime, Some(48));
    }

    #[test]
    fn streams_keep_urls_magnets_and_headers() {
        let body = r#"{"streams":[
            {"name":"Addon","title":"1080p","url":"https://cdn/x.m3u8"},
            {"name":"Torrent","title":"4K","infoHash":"ABCDEF","behaviorHints":{"filename":"Film.2160p.mkv"}},
            {"name":"Subs","title":"1080p","url":"https://cdn/y.mp4","subtitles":[{"id":"English","url":"https://s/en.vtt","lang":"en"}]}
        ]}"#;
        let s = parse_streams(body, "Addon").unwrap();
        assert_eq!(s.len(), 3);
        assert!(s[0].magnet); // 4K magnet ranks first
        assert!(s[0]
            .url
            .starts_with("magnet:?xt=urn:btih:ABCDEF&dn=Film.2160p.mkv"));
        // Both 1080p HTTP entries keep the addon's own order (stable sort).
        assert_eq!(s[1].url, "https://cdn/x.m3u8");
        assert_eq!(s[2].url, "https://cdn/y.mp4");
        assert_eq!(s[2].subtitles[0].lang, "en");
    }

    #[test]
    fn empty_stream_list_is_an_error() {
        assert!(parse_streams(r#"{"streams":[]}"#, "x").is_err());
        assert!(parse_streams("not json", "x").is_err());
    }

    #[test]
    fn subtitles_route_parses() {
        let subs = parse_subtitles(
            r#"{"subtitles":[{"id":"English","url":"https://s/1.vtt","lang":"en"}]}"#,
        );
        assert_eq!(subs.len(), 1);
        assert_eq!(subs[0].label, "English");
    }
}

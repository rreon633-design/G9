//! MangaDex — the official public API, used for manga, manhwa and manhua.
//!
//! A neutral client, like the RSS reader: G9 stores no catalogue, and the reader
//! asks MangaDex for what the user types. Rate limits are MangaDex's, so the app
//! keeps one request in flight per second and no bulk crawling.

use serde_json::Value;

use crate::model::{Episode, Item, Kind};

pub const API: &str = "https://api.mangadex.org";
pub const UPLOADS: &str = "https://uploads.mangadex.org";

/// Search page size; MangaDex caps this at 100.
pub const PAGE: u32 = 24;

/// Any origin cover URL at a readable size.
pub fn cover_url(manga_id: &str, file_name: &str, size: u32) -> String {
    format!("{UPLOADS}/covers/{manga_id}/{file_name}.{size}.jpg")
}

/// MangaDex tags mangas by origin; that is what picks the shelf word.
pub fn origin_of(tags: &[String]) -> &'static str {
    let has = |needle: &str| tags.iter().any(|t| t.eq_ignore_ascii_case(needle));
    if has("Manhwa") {
        "Manhwa"
    } else if has("Manhua") {
        "Manhua"
    } else {
        "Manga"
    }
}

fn locale_text(map: Option<&Value>) -> Option<String> {
    let m = map?.as_object()?;
    for key in ["en", "ja", "ko", "zh", "zh-hk", "ja-ro"] {
        if let Some(s) = m.get(key).and_then(Value::as_str) {
            if !s.trim().is_empty() {
                return Some(s.to_string());
            }
        }
    }
    m.values().find_map(|v| v.as_str().map(str::to_string))
}

/// `GET /manga?title=…` response → cards.
pub fn parse_search(body: &str, source_id: i64) -> Result<Vec<Item>, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|_| "MangaDex returned no JSON".to_string())?;
    let arr = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "MangaDex returned no results".to_string())?;
    let mut out = Vec::new();
    for m in arr {
        let Some(id) = m.get("id").and_then(Value::as_str) else {
            continue;
        };
        let a = m.get("attributes").unwrap_or(&Value::Null);
        let title = locale_text(a.get("title")).unwrap_or_else(|| "Untitled".into());
        let mut item = Item::new(format!("{source_id}:{id}"), title, Kind::Manga);
        item.synopsis = locale_text(a.get("description"));
        item.year = a.get("year").and_then(Value::as_i64).map(|y| y as i32);
        let tags: Vec<String> = a
            .get("tags")
            .and_then(Value::as_array)
            .map(|t| {
                t.iter()
                    .filter_map(|tag| locale_text(tag.get("attributes")?.get("name")))
                    .collect()
            })
            .unwrap_or_default();
        let origin = origin_of(&tags);
        item.subtitle = Some(origin.to_string());
        item.genres = tags
            .iter()
            .filter(|t| !matches!(t.as_str(), "Manhwa" | "Manhua" | "Manga" | "One-shot"))
            .take(3)
            .cloned()
            .collect();
        if let Some(status) = a.get("status").and_then(Value::as_str) {
            if status == "ongoing" {
                item.badge = Some("ONGOING".into());
            }
        }
        let cover = m
            .get("relationships")
            .and_then(Value::as_array)
            .and_then(|rels| {
                rels.iter()
                    .find(|r| r.get("type").and_then(Value::as_str) == Some("cover_art"))
            })
            .and_then(|r| r.get("attributes"))
            .and_then(|at| at.get("fileName"))
            .and_then(Value::as_str);
        if let Some(file) = cover {
            item.poster = Some(cover_url(id, file, 256));
        }
        out.push(item);
    }
    Ok(out)
}

/// `GET /manga/{id}/feed` response → chapter list.
pub fn parse_chapters(body: &str) -> Result<Vec<Episode>, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|_| "MangaDex returned no JSON".to_string())?;
    let arr = v
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "that title has no chapters".to_string())?;
    let mut out: Vec<(f32, Episode)> = Vec::new();
    for c in arr {
        let Some(id) = c.get("id").and_then(Value::as_str) else {
            continue;
        };
        let a = c.get("attributes").unwrap_or(&Value::Null);
        // Chapter numbers are decimal ("12.5" is a real extra), so keep the raw
        // label for display and the float for ordering.
        let raw_number = a
            .get("chapter")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string();
        let number = raw_number.parse::<f32>().unwrap_or(0.0) as i32;
        let label = if raw_number.trim().is_empty() {
            format!("Episode {number}")
        } else {
            raw_number.trim().to_string()
        };
        let name = a.get("title").and_then(Value::as_str).unwrap_or("");
        let title = if name.trim().is_empty() {
            format!("Chapter {label}")
        } else {
            format!("Ch. {label} — {name}")
        };
        let order = raw_number.parse::<f32>().unwrap_or(number as f32);
        out.push((
            order,
            Episode {
                id: id.to_string(),
                number,
                season: None,
                title,
                overview: None,
                thumb: None,
                runtime: a.get("pages").and_then(Value::as_i64).map(|p| p as i32),
                released: a
                    .get("publishAt")
                    .and_then(Value::as_str)
                    .map(str::to_string),
            },
        ));
    }
    out.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    let mut chapters: Vec<Episode> = Vec::with_capacity(out.len());
    for (_, ep) in out {
        if chapters.iter().all(|c| c.id != ep.id) {
            chapters.push(ep);
        }
    }
    Ok(chapters)
}

/// `GET /at-home/server/{chapter}` response → page image URLs.
pub fn parse_pages(body: &str) -> Result<Vec<String>, String> {
    let v: Value =
        serde_json::from_str(body).map_err(|_| "MangaDex returned no JSON".to_string())?;
    let base = v
        .get("baseUrl")
        .and_then(Value::as_str)
        .ok_or_else(|| "that chapter has no page server".to_string())?;
    let chapter = v
        .get("chapter")
        .ok_or_else(|| "that chapter has no pages".to_string())?;
    let hash = chapter
        .get("hash")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let data = chapter
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let pages: Vec<String> = data
        .iter()
        .filter_map(|f| f.as_str())
        .map(|f| format!("{base}/data/{hash}/{f}"))
        .collect();
    if pages.is_empty() {
        return Err("that chapter has no pages".into());
    }
    Ok(pages)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH: &str = r#"{"data":[
      {"id":"uuid-1","type":"manga","attributes":{
        "title":{"en":"Shadow Sovereign"},
        "description":{"en":"He was the weakest."},
        "year":2024,"status":"ongoing",
        "tags":[{"attributes":{"name":{"en":"Action"}}},{"attributes":{"name":{"en":"Manhwa"}}}]
      },"relationships":[{"type":"cover_art","attributes":{"fileName":"abc.jpg"}}]},
      {"id":"uuid-2","type":"manga","attributes":{
        "title":{"ko":"구름 검객"},"status":"completed",
        "tags":[{"attributes":{"name":{"en":"Manhua"}}}]
      }}
    ]}"#;

    #[test]
    fn search_maps_to_cards() {
        let items = parse_search(SEARCH, 4).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, "4:uuid-1");
        assert_eq!(items[0].title, "Shadow Sovereign");
        assert_eq!(items[0].kind, Kind::Manga);
        assert_eq!(items[0].subtitle.as_deref(), Some("Manhwa"));
        assert_eq!(items[0].genres, vec!["Action"]);
        assert_eq!(items[0].badge.as_deref(), Some("ONGOING"));
        assert_eq!(
            items[0].poster.as_deref(),
            Some("https://uploads.mangadex.org/covers/uuid-1/abc.jpg.256.jpg")
        );
        assert_eq!(items[1].subtitle.as_deref(), Some("Manhua"));
        assert_eq!(items[1].title, "구름 검객");
    }

    #[test]
    fn chapters_are_ordered_and_labelled() {
        let body = r#"{"data":[
          {"id":"c2","attributes":{"chapter":"2","title":"Second","pages":20,"publishAt":"2024-01-02T00:00:00+00:00"}},
          {"id":"c1","attributes":{"chapter":"1","title":"","pages":18}},
          {"id":"c1b","attributes":{"chapter":"1.5","title":"Bonus"}}
        ]}"#;
        let ch = parse_chapters(body).unwrap();
        assert_eq!(ch.len(), 3);
        assert_eq!(ch[0].title, "Chapter 1");
        assert_eq!(ch[1].title, "Ch. 1.5 — Bonus"); // decimal extras survive
        assert_eq!(ch[2].id, "c2");
        assert_eq!(ch[2].title, "Ch. 2 — Second");
        assert_eq!(ch[2].runtime, Some(20));
    }

    #[test]
    fn pages_are_absolute() {
        let body =
            r#"{"baseUrl":"https://cdn.test","chapter":{"hash":"h1","data":["1.png","2.png"]}}"#;
        let p = parse_pages(body).unwrap();
        assert_eq!(
            p,
            vec![
                "https://cdn.test/data/h1/1.png",
                "https://cdn.test/data/h1/2.png"
            ]
        );
    }

    #[test]
    fn empty_chapter_is_an_error() {
        assert!(parse_pages(r#"{"baseUrl":"x","chapter":{"hash":"h","data":[]}}"#).is_err());
        assert!(parse_chapters(r#"{"data":[]}"#).unwrap().is_empty());
    }
}

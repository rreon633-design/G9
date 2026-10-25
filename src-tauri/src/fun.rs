//! Fun Mode commands: the wall, search, details, streams and progress.
//!
//! All the parsing lives in `g9_sources` (offline, unit-tested); this module only
//! does HTTP, takes the user's sources from SQLite, and shapes JSON for `ui/fun.js`.
//! G9 still ships no catalogue: every row on the wall came from a source the user
//! added (a Stremio addon, an RSS feed, MangaDex, or the yt-dlp box).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use g9_sources::model::{Details, Episode, Item, Kind, Shelf, Stream};
use g9_sources::{archive, mangadex, rss, stremio, ytdlp};
use g9_store::{FunLibRow, FunProgressRow, FunSourceRow};
use serde::Serialize;
use tauri::{AppHandle, State};

use crate::state::AppState;

const TTL: Duration = Duration::from_secs(600);
const MAX_BODY: usize = 24 * 1024 * 1024;

// ---------------------------------------------------------------- HTTP + cache

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(g9_core::USER_AGENT)
        .timeout(Duration::from_secs(25))
        .redirect(reqwest::redirect::Policy::limited(5))
        .use_rustls_tls()
        .build()
        .map_err(|e| e.to_string())
}

type Cache = Mutex<HashMap<String, (Instant, String)>>;

fn cache() -> &'static Cache {
    static C: OnceLock<Cache> = OnceLock::new();
    C.get_or_init(|| Mutex::new(HashMap::new()))
}

/// GET a body as text, cached for [`TTL`]. The cache exists so switching tabs
/// does not re-hit every addon; it is memory-only and dies with the app.
fn get_cached(url: &str) -> Result<String, String> {
    if let Ok(map) = cache().lock() {
        if let Some((at, body)) = map.get(url) {
            if at.elapsed() < TTL {
                return Ok(body.clone());
            }
        }
    }
    let body = get(url)?;
    if let Ok(mut map) = cache().lock() {
        if map.len() > 200 {
            map.clear();
        }
        map.insert(url.to_string(), (Instant::now(), body.clone()));
    }
    Ok(body)
}

fn get(url: &str) -> Result<String, String> {
    let parsed = url::Url::parse(url).map_err(|_| "That source URL is not a URL".to_string())?;
    match parsed.scheme() {
        "http" | "https" => {}
        _ => return Err("Only http and https sources are supported".into()),
    }
    let resp = client()?
        .get(parsed)
        .send()
        .map_err(|e| short(e.to_string()))?;
    let status = resp.status();
    if !status.is_success() {
        return Err(if status.as_u16() == 403 {
            "That source refused the request".to_string()
        } else {
            format!("Source answered {}", status.as_u16())
        });
    }
    let mut buf = Vec::new();
    use std::io::Read;
    resp.take(MAX_BODY as u64 + 1)
        .read_to_end(&mut buf)
        .map_err(|e| short(e.to_string()))?;
    if buf.len() > MAX_BODY {
        return Err("That source returned too much data".into());
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

/// Keep an error short and free of URLs — the UI shows it verbatim.
fn store_err(e: g9_store::StoreError) -> String {
    short(e.to_string())
}

fn short(raw: String) -> String {
    let lower = raw.to_ascii_lowercase();
    if lower.contains("timed out") || lower.contains("timeout") {
        return "That source did not answer in time".to_string();
    }
    if lower.contains("dns")
        || lower.contains("connect")
        || lower.contains("error sending request")
        || lower.contains("connection refused")
    {
        return "Could not reach that source".to_string();
    }
    // Never quote a URL back at the user: it names the source.
    let mut out = String::with_capacity(raw.len());
    for word in raw.split_whitespace() {
        let bare = word.trim_matches(|c: char| "()[]{}<>,;'\"".contains(c));
        if bare.contains("://") || bare.starts_with("www.") {
            out.push_str("that source ");
        } else {
            out.push_str(word);
            out.push(' ');
        }
    }
    let mut s = out.trim().to_string();
    if s.len() > 90 {
        let cut = (0..=90).rev().find(|i| s.is_char_boundary(*i)).unwrap_or(0);
        s.truncate(cut);
        s.push('…');
    }
    s
}

/// Run a blocking closure off the UI thread.
async fn work<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| short(e.to_string()))?
}

// ---------------------------------------------------------------- view types

#[derive(Serialize)]
pub struct FunSource {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub url: String,
    pub enabled: bool,
    pub detail: String,
}

#[derive(Serialize)]
pub struct FunHome {
    pub shelves: Vec<Shelf>,
    pub sources: Vec<FunSource>,
    /// True when the wall is showing the built-in preview because no source is
    /// configured yet. The UI labels it instead of pretending it is content.
    pub demo: bool,
    pub errors: Vec<String>,
}

#[derive(Serialize)]
pub struct FunDetails {
    pub details: Details,
    pub streams: Vec<Stream>,
    pub progress: Option<FunProgressRow>,
}

fn store_of<'a>(
    state: &'a State<'_, AppState>,
) -> Result<std::sync::MutexGuard<'a, g9_store::Store>, String> {
    state.store.lock().map_err(|e| e.to_string())
}

/// Read every source row before any `await` — the guard cannot cross one.
fn all_sources(state: &State<AppState>) -> Result<Vec<FunSourceRow>, String> {
    store_of(state)?.fun_sources().map_err(store_err)
}

fn source_row(state: &State<AppState>, id: i64) -> Result<FunSourceRow, String> {
    all_sources(state)?
        .into_iter()
        .find(|s| s.id == id)
        .ok_or_else(|| "That source is gone — add it again".to_string())
}

fn parse_source_id(raw: &str) -> i64 {
    raw.split(':')
        .next()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn strip_source_id(id: &str) -> String {
    match id.split_once(':') {
        Some((_, rest)) => rest.to_string(),
        None => id.to_string(),
    }
}

fn manifest_of(row: &FunSourceRow) -> Result<stremio::Manifest, String> {
    if let Some(raw) = row.manifest.as_deref().filter(|m| !m.is_empty()) {
        if let Ok(m) = stremio::parse_manifest(raw) {
            return Ok(m);
        }
    }
    stremio::parse_manifest(&get_cached(&row.url)?)
}

fn shelf_kind(raw: &str) -> Kind {
    Kind::from_stremio(raw).unwrap_or(Kind::Movie)
}

// ---------------------------------------------------------------- sources

#[tauri::command]
pub fn fun_sources(state: State<AppState>) -> Result<Vec<FunSource>, String> {
    let rows = all_sources(&state)?;
    Ok(rows
        .into_iter()
        .map(|r| {
            let detail = match r.kind.as_str() {
                "stremio" => manifest_of(&r)
                    .map(|m| {
                        let kinds = m.types.join(" · ");
                        if kinds.is_empty() {
                            "addon".to_string()
                        } else {
                            kinds
                        }
                    })
                    .unwrap_or_else(|_| "addon".into()),
                "rss" => "magnet feed".into(),
                "mangadex" => "manga · manhwa · manhua".into(),
                "ytdlp" => "paste any link".into(),
                "archive" => "public-domain films".into(),
                other => other.to_string(),
            };
            FunSource {
                id: r.id,
                kind: r.kind,
                name: r.name,
                url: r.url,
                enabled: r.enabled,
                detail,
            }
        })
        .collect())
}

/// Add a source by URL. Stremio URLs are validated by fetching the manifest, so a
/// typo fails here and not silently on the wall.
#[tauri::command]
pub async fn fun_source_add(
    state: State<'_, AppState>,
    url: String,
    kind: Option<String>,
) -> Result<FunSource, String> {
    let raw = url.trim().to_string();
    if raw.is_empty() {
        return Err("Paste a source URL first".into());
    }
    let kind = kind.unwrap_or_default();
    let store_url = raw.clone();
    let kind_hint = kind.clone();
    let (kind, name, manifest) = work(move || {
        // Work out what the URL is when the caller did not say.
        let looks_rss =
            store_url.contains("rss") || store_url.contains("feed") || store_url.ends_with(".xml");
        let looks_manga = store_url.contains("mangadex");
        if kind_hint == "rss" || (kind_hint.is_empty() && looks_rss) {
            let body = get(&store_url)?;
            let entries = rss::parse_feed(&body, "feed", Kind::Movie);
            if entries.is_empty() {
                return Err("That feed has no magnet links G9 can use".to_string());
            }
            Ok(("rss".to_string(), feed_name(&store_url), None))
        } else if kind_hint == "mangadex" || (kind_hint.is_empty() && looks_manga) {
            Ok(("mangadex".to_string(), "MangaDex".to_string(), None))
        } else {
            let mut manifest_url = store_url.clone();
            if !manifest_url.contains("manifest.json") {
                manifest_url = format!("{}/manifest.json", g9_sources::trim_slash(&manifest_url));
            }
            let body = get(&manifest_url)?;
            let m = stremio::parse_manifest(&body)?;
            let name = m.short_name();
            Ok((("stremio").to_string(), name, Some(body)))
        }
    })
    .await?;

    let id = store_of(&state)?
        .fun_source_add(&kind, &name, &raw, manifest.as_deref())
        .map_err(store_err)?;
    Ok(FunSource {
        id,
        kind,
        name,
        url: raw,
        enabled: true,
        detail: "added".into(),
    })
}

fn feed_name(url: &str) -> String {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_else(|| "RSS feed".to_string());
    format!("{host} feed")
}

#[tauri::command]
pub fn fun_source_remove(state: State<AppState>, id: i64) -> Result<(), String> {
    store_of(&state)?.fun_source_remove(id).map_err(store_err)
}

#[tauri::command]
pub fn fun_source_toggle(state: State<AppState>, id: i64, enabled: bool) -> Result<(), String> {
    store_of(&state)?
        .fun_source_set_enabled(id, enabled)
        .map_err(store_err)
}

// ---------------------------------------------------------------- the wall

#[derive(Serialize)]
struct DemoTitle {
    title: &'static str,
    kind: &'static str,
    note: &'static str,
}

/// Shown only when the user has not added anything yet, so Fun Mode explains
/// itself instead of showing an empty page. These are placeholders, not links.
const DEMO: &[DemoTitle] = &[
    DemoTitle {
        title: "Movies",
        kind: "movie",
        note: "add a Stremio addon or an RSS feed",
    },
    DemoTitle {
        title: "Web series",
        kind: "series",
        note: "episodes come from the addon's meta",
    },
    DemoTitle {
        title: "Anime",
        kind: "anime",
        note: "an anime RSS feed gives magnets + seeders",
    },
    DemoTitle {
        title: "Manga · Manhwa · Manhua",
        kind: "manga",
        note: "MangaDex is built in — enable it below",
    },
];

fn demo_items() -> Vec<Item> {
    let mut out = Vec::new();
    for (i, d) in DEMO.iter().enumerate() {
        let mut item = Item::new(
            format!("demo:{i}"),
            d.title,
            Kind::parse(d.kind).unwrap_or(Kind::Movie),
        );
        item.subtitle = Some(d.note.to_string());
        item.badge = Some("SAMPLE".into());
        item.genres.push("Preview".into());
        out.push(item);
    }
    out
}

/// A fresh install still gets a wall: the Internet Archive is added once, with
/// no account and no key. Removing it in Sources is remembered — it never
/// comes back on its own.
fn ensure_starter_source(state: &State<'_, AppState>) -> Result<(), String> {
    let store = store_of(state)?;
    if store.setting("fun.seeded").map_err(store_err)?.is_some() {
        return Ok(());
    }
    store
        .fun_source_add(
            "archive",
            "Internet Archive",
            archive::API,
            Some("{\"starter\":true}"),
        )
        .map_err(store_err)?;
    store.set_setting("fun.seeded", "1").map_err(store_err)?;
    Ok(())
}

#[tauri::command]
pub async fn fun_home(state: State<'_, AppState>) -> Result<FunHome, String> {
    let _ = ensure_starter_source(&state);
    let sources = all_sources(&state)?;
    let enabled: Vec<FunSourceRow> = sources.into_iter().filter(|s| s.enabled).collect();
    let views = fun_sources(state.clone()).unwrap_or_default();

    if enabled.is_empty() {
        return Ok(FunHome {
            shelves: vec![Shelf {
                id: "demo".into(),
                title: "Start here — add a source".into(),
                source_id: 0,
                kind: Kind::Movie,
                items: demo_items(),
            }],
            sources: views,
            demo: true,
            errors: Vec::new(),
        });
    }

    let built = work(move || {
        let mut shelves: Vec<Shelf> = Vec::new();
        let mut errors: Vec<String> = Vec::new();
        for src in &enabled {
            match src.kind.as_str() {
                "stremio" => match build_stremio_home(src) {
                    Ok(mut rows) => shelves.append(&mut rows),
                    Err(e) => errors.push(format!("{}: {e}", src.name)),
                },
                "rss" => match build_rss_shelf(src) {
                    Ok(row) => shelves.push(row),
                    Err(e) => errors.push(format!("{}: {e}", src.name)),
                },
                "mangadex" => match build_mangadex_shelf(src) {
                    Ok(row) => shelves.push(row),
                    Err(e) => errors.push(format!("{}: {e}", src.name)),
                },
                "archive" => match build_archive_shelves(src) {
                    Ok(mut rows) => shelves.append(&mut rows),
                    Err(e) => errors.push(format!("{}: {e}", src.name)),
                },
                _ => {}
            }
        }
        Ok((shelves, errors))
    })
    .await?;

    let (mut shelves, errors) = built;
    // Continue watching goes on top when there is anything to resume.
    let recent = store_of(&state)
        .ok()
        .and_then(|s| s.fun_progress_list(12).ok())
        .unwrap_or_default();
    {
        let items: Vec<Item> = recent
            .iter()
            .filter(|r| r.kind != "manga" || r.page.unwrap_or(0) > 0)
            .map(|r| {
                let mut item = Item::new(
                    format!("{}:{}", r.source_id, r.item_id),
                    r.title.clone(),
                    Kind::parse(&r.kind).unwrap_or(Kind::Movie),
                );
                item.poster = r.poster.clone();
                item.badge = Some(match (&r.season, &r.episode) {
                    (Some(s), Some(e)) => format!("S{s} E{e}"),
                    _ => "Resume".to_string(),
                });
                item.quality = g9_sources::Quality::Unknown;
                item
            })
            .collect();
        if !items.is_empty() {
            shelves.insert(
                0,
                Shelf {
                    id: "continue".into(),
                    title: "Continue watching".into(),
                    source_id: 0,
                    kind: Kind::Movie,
                    items,
                },
            );
        }
    }

    Ok(FunHome {
        shelves,
        sources: views,
        demo: false,
        errors,
    })
}

fn build_stremio_home(src: &FunSourceRow) -> Result<Vec<Shelf>, String> {
    let m = manifest_of(src)?;
    let base = src.url.trim_end_matches("/manifest.json").to_string();
    let mut rows = Vec::new();
    // Two catalogs per addon keeps the wall fast; the rest are one tap away
    // through search or "see all".
    for cat in m.catalogs.iter().take(2) {
        if cat.id == "search" {
            continue;
        }
        let url = stremio::catalog_url(&base, &cat.kind, &cat.id, None);
        let body = match get_cached(&url) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let mut items = stremio::parse_catalogs(&body, &cat.kind, src.id).unwrap_or_default();
        if items.is_empty() {
            continue;
        }
        items.truncate(40);
        let title = if cat.name.is_empty() {
            format!("{} · {}", src.name, cat.kind)
        } else {
            cat.name.clone()
        };
        rows.push(Shelf {
            id: format!("{}:{}:{}", src.id, cat.kind, cat.id),
            title,
            source_id: src.id,
            kind: shelf_kind(&cat.kind),
            items,
        });
    }
    if rows.is_empty() {
        return Err("no catalogs answered".into());
    }
    Ok(rows)
}

/// Two rows from the archive's free collections. One request each, cached.
fn build_archive_shelves(src: &FunSourceRow) -> Result<Vec<Shelf>, String> {
    let mut rows = Vec::new();
    for (collection, title) in archive::COLLECTIONS.iter().take(2) {
        let url = archive::search_url("", collection, 20, 1);
        let Ok(body) = get_cached(&url) else { continue };
        let items = archive::parse_search(&body, src.id)?;
        if items.is_empty() {
            continue;
        }
        rows.push(Shelf {
            id: format!("{}:{}", src.id, collection),
            title: (*title).to_string(),
            source_id: src.id,
            kind: Kind::Movie,
            items,
        });
    }
    if rows.is_empty() {
        return Err("the archive did not answer".into());
    }
    Ok(rows)
}

fn build_rss_shelf(src: &FunSourceRow) -> Result<Shelf, String> {
    let body = get_cached(&src.url)?;
    let entries = rss::parse_feed(&body, &src.name, Kind::Anime);
    if entries.is_empty() {
        return Err("feed has no magnets".into());
    }
    let items: Vec<Item> = entries.iter().take(60).map(|e| e.item.clone()).collect();
    Ok(Shelf {
        id: format!("{}:feed", src.id),
        title: src.name.clone(),
        source_id: src.id,
        kind: items.first().map(|i| i.kind).unwrap_or(Kind::Anime),
        items,
    })
}

fn build_mangadex_shelf(src: &FunSourceRow) -> Result<Shelf, String> {
    let url = format!(
        "{}/manga?limit=24&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive\
         &order[followedCount]=desc",
        mangadex::API
    );
    let body = get_cached(&url)?;
    let items = mangadex::parse_search(&body, src.id)?;
    Ok(Shelf {
        id: format!("{}:popular", src.id),
        title: "Manga · Manhwa · Manhua".into(),
        source_id: src.id,
        kind: Kind::Manga,
        items,
    })
}

// ---------------------------------------------------------------- search

#[tauri::command]
pub async fn fun_search(state: State<'_, AppState>, q: String) -> Result<Vec<Item>, String> {
    let query = q.trim().to_string();
    if query.len() < 2 {
        return Ok(Vec::new());
    }
    let sources: Vec<FunSourceRow> = all_sources(&state)?
        .into_iter()
        .filter(|s| s.enabled)
        .collect();

    let items = work(move || {
        let mut all: Vec<Item> = Vec::new();
        for src in &sources {
            match src.kind.as_str() {
                "stremio" => {
                    let Ok(m) = manifest_of(src) else { continue };
                    let base = src.url.trim_end_matches("/manifest.json").to_string();
                    for cat in m
                        .catalogs
                        .iter()
                        .filter(|c| c.extra.iter().any(|e| e.name == "search"))
                        .take(2)
                    {
                        let url = stremio::catalog_url(
                            &base,
                            &cat.kind,
                            &cat.id,
                            Some(&stremio::search_extra(&query, 0)),
                        );
                        if let Ok(body) = get_cached(&url) {
                            if let Ok(mut got) = stremio::parse_catalogs(&body, &cat.kind, src.id) {
                                all.append(&mut got);
                            }
                        }
                    }
                }
                "archive" => {
                    let url = archive::search_url(&query, "", 40, 1);
                    if let Ok(body) = get_cached(&url) {
                        if let Ok(mut got) = archive::parse_search(&body, src.id) {
                            all.append(&mut got);
                        }
                    }
                }
                "rss" => {
                    if let Ok(body) = get_cached(&src.url) {
                        let needle = query.to_ascii_lowercase();
                        all.extend(
                            rss::parse_feed(&body, &src.name, Kind::Anime)
                                .into_iter()
                                .filter(|e| e.item.title.to_ascii_lowercase().contains(&needle))
                                .map(|e| e.item)
                                .take(40),
                        );
                    }
                }
                "mangadex" => {
                    let url = format!(
                        "{}/manga?limit=24&includes[]=cover_art&title={}&contentRating[]=safe\
                         &contentRating[]=suggestive",
                        mangadex::API,
                        stremio::search_extra(&query, 0).trim_start_matches("search=")
                    );
                    if let Ok(body) = get_cached(&url) {
                        if let Ok(mut got) = mangadex::parse_search(&body, src.id) {
                            all.append(&mut got);
                        }
                    }
                }
                _ => {}
            }
        }
        // De-duplicate by title so the same show from two addons is one card.
        let mut seen = std::collections::HashSet::new();
        all.retain(|i| seen.insert(i.title.to_ascii_lowercase()));
        Ok(all)
    })
    .await?;
    Ok(items)
}

// ---------------------------------------------------------------- details + streams

#[tauri::command]
pub async fn fun_details(
    state: State<'_, AppState>,
    id: String,
    kind: Option<String>,
    season: Option<i32>,
) -> Result<FunDetails, String> {
    let source_id = parse_source_id(&id);
    let item_id = strip_source_id(&id);
    let src = source_row(&state, source_id)?;
    let kind_hint = kind.unwrap_or_default();

    let progress = store_of(&state)
        .ok()
        .and_then(|s| s.fun_progress_for(source_id, &item_id).ok())
        .flatten();

    let (details, streams) = work(move || match src.kind.as_str() {
        "stremio" => {
            let base = src.url.trim_end_matches("/manifest.json").to_string();
            let kind = if kind_hint.is_empty() {
                "movie"
            } else {
                &kind_hint
            };
            let meta = get_cached(&stremio::meta_url(&base, kind, &item_id))?;
            let d = stremio::parse_meta(&meta, src.id, season)?;
            let video = d
                .episodes
                .first()
                .map(|e| e.id.clone())
                .unwrap_or_else(|| item_id.clone());
            let streams = stremio::parse_streams(
                &get_cached(&stremio::stream_url(&base, kind, &video))
                    .unwrap_or_else(|_| "{}".into()),
                &src.name,
            )
            .unwrap_or_default();
            Ok((d, streams))
        }
        "rss" => {
            let body = get_cached(&src.url)?;
            let entries = rss::parse_feed(&body, &src.name, Kind::Anime);
            let entry = entries
                .iter()
                .find(|e| e.item.id == item_id)
                .ok_or_else(|| "That release is no longer in the feed".to_string())?;
            let details = Details {
                item: entry.item.clone(),
                episodes: Vec::new(),
                season: None,
                seasons: Vec::new(),
            };
            Ok((details, vec![entry.stream.clone()]))
        }
        "mangadex" => {
            let url = format!("{}/manga/{item_id}?includes[]=cover_art", mangadex::API);
            let body = get_cached(&url)?;
            let mut items = mangadex::parse_search(&body, src.id)
                .or_else(|_| mangadex::parse_search(&format!("{{\"data\":[{body}]}}"), src.id))
                .unwrap_or_default();
            let item = items
                .pop()
                .unwrap_or_else(|| Item::new(item_id.clone(), "Manga", Kind::Manga));
            let feed = get_cached(&format!(
                "{}/manga/{item_id}/feed?limit=200&translatedLanguage[]=en&order[chapter]=asc",
                mangadex::API
            ))?;
            let chapters: Vec<Episode> = mangadex::parse_chapters(&feed).unwrap_or_default();
            let details = Details {
                item,
                episodes: chapters,
                season: None,
                seasons: Vec::new(),
            };
            Ok((details, Vec::new()))
        }
        "archive" => {
            let body = get_cached(&archive::metadata_url(&item_id))?;
            let (details, streams) = archive::parse_item(&body, src.id, &src.name)?;
            Ok((details, streams))
        }
        other => Err(format!("{other} sources have no details")),
    })
    .await?;

    Ok(FunDetails {
        details,
        streams,
        progress,
    })
}

/// Streams for one episode (or the title itself when the source is flat).
#[tauri::command]
pub async fn fun_streams(
    state: State<'_, AppState>,
    id: String,
    kind: Option<String>,
    episode: Option<String>,
) -> Result<Vec<Stream>, String> {
    let source_id = parse_source_id(&id);
    let item_id = strip_source_id(&id);
    let src = source_row(&state, source_id)?;
    let kind_hint = kind.unwrap_or_default();
    work(move || match src.kind.as_str() {
        "stremio" => {
            let base = src.url.trim_end_matches("/manifest.json").to_string();
            let kind = if kind_hint.is_empty() {
                "movie"
            } else {
                &kind_hint
            };
            let video = episode.unwrap_or_else(|| item_id.clone());
            let body = get(&stremio::stream_url(&base, kind, &video))?;
            stremio::parse_streams(&body, &src.name)
        }
        "rss" => {
            let body = get_cached(&src.url)?;
            let entries = rss::parse_feed(&body, &src.name, Kind::Anime);
            entries
                .iter()
                .find(|e| e.item.id == item_id)
                .map(|e| vec![e.stream.clone()])
                .ok_or_else(|| "That release left the feed".to_string())
        }
        "archive" => {
            let body = get_cached(&archive::metadata_url(&item_id))?;
            let (_, streams) = archive::parse_item(&body, src.id, &src.name)?;
            Ok(streams)
        }
        other => Err(format!("{other} sources stream through their own screen")),
    })
    .await
}

/// One more page of a catalog, so a shelf can keep going instead of stopping
/// at the first forty. `id` is the shelf id: `source:kind:catalog`.
#[tauri::command]
pub async fn fun_catalog(
    state: State<'_, AppState>,
    id: String,
    skip: Option<u32>,
) -> Result<Vec<Item>, String> {
    let mut parts = id.splitn(3, ':');
    let source_id: i64 = parts
        .next()
        .and_then(|p| p.parse().ok())
        .ok_or_else(|| "That shelf has no source".to_string())?;
    let kind = parts.next().unwrap_or("movie").to_string();
    let catalog = parts.next().unwrap_or_default().to_string();
    if catalog.is_empty() {
        return Err("That shelf cannot page".into());
    }
    let src = source_row(&state, source_id)?;
    let base = src.url.trim_end_matches("/manifest.json").to_string();
    let at = skip.unwrap_or(0);
    work(move || {
        let extra = format!("skip={at}");
        let url = stremio::catalog_url(&base, &kind, &catalog, Some(&extra));
        let body = get(&url)?;
        let mut items = stremio::parse_catalogs(&body, &kind, source_id)?;
        items.truncate(40);
        Ok(items)
    })
    .await
}

/// Subtitle tracks an addon offers for one episode. Stremio addons publish
/// theirs through their own route, so this is the only place they can come from.
#[tauri::command]
pub async fn fun_subtitles(
    state: State<'_, AppState>,
    id: String,
    kind: Option<String>,
    video: Option<String>,
) -> Result<Vec<g9_sources::Subtitle>, String> {
    let source_id = parse_source_id(&id);
    let item_id = strip_source_id(&id);
    let src = source_row(&state, source_id)?;
    if src.kind != "stremio" {
        return Ok(Vec::new());
    }
    let base = src.url.trim_end_matches("/manifest.json").to_string();
    let kind_hint = kind.unwrap_or_else(|| "movie".into());
    let video_id = video.unwrap_or(item_id);
    work(move || {
        let url = stremio::subtitle_url(&base, &kind_hint, &video_id);
        // An addon with no subtitle route answers 404 — that is not an error.
        match get(&url) {
            Ok(body) => Ok(stremio::parse_subtitles(&body)),
            Err(_) => Ok(Vec::new()),
        }
    })
    .await
}

/// The text of one subtitle file, converted to WebVTT by the caller's player.
#[tauri::command]
pub async fn fun_subtitle_text(url: String) -> Result<String, String> {
    if !url.starts_with("http") {
        return Err("Not a subtitle link".into());
    }
    work(move || get(&url)).await
}

/// Resolve an arbitrary page with the managed yt-dlp — the "paste a link" box.
#[tauri::command]
pub async fn fun_resolve(app: AppHandle, url: String) -> Result<Vec<Stream>, String> {
    let target = url.trim().to_string();
    if !target.starts_with("http") {
        return Err("Paste a full http(s) link".into());
    }
    work(move || {
        let bin = crate::dl::binary(&app);
        let out = crate::tools::run_hidden(std::process::Command::new(bin).args([
            "-J",
            "--no-warnings",
            "--no-playlist",
            &target,
        ]))?;
        if !out.status.success() {
            return Err("yt-dlp could not read that page".to_string());
        }
        let json = String::from_utf8_lossy(&out.stdout).into_owned();
        ytdlp::parse_probe(&json, "yt-dlp")
    })
    .await
}

/// Page images for one chapter (the reader).
#[tauri::command]
pub async fn fun_pages(id: String, chapter: String) -> Result<Vec<String>, String> {
    let _ = parse_source_id(&id);
    work(move || {
        let body = get(&format!("{}/at-home/server/{chapter}", mangadex::API))?;
        mangadex::parse_pages(&body)
    })
    .await
}

// ---------------------------------------------------------------- progress

#[tauri::command]
pub fn fun_progress_save(state: State<AppState>, row: FunProgressRow) -> Result<(), String> {
    store_of(&state)?.fun_progress_save(&row).map_err(store_err)
}

// ---------------------------------------------------------------- library

/// Rows of one library flag: `list`, `follow`, `watched` or `hidden`.
#[tauri::command]
pub fn fun_lib_list(state: State<AppState>, kind: String) -> Result<Vec<FunLibRow>, String> {
    store_of(&state)?
        .fun_lib_list(&clean_kind(&kind))
        .map_err(store_err)
}

fn clean_kind(kind: &str) -> String {
    match kind {
        "list" | "follow" | "watched" | "hidden" => kind.to_string(),
        _ => "list".to_string(),
    }
}

#[tauri::command]
pub fn fun_lib_set(state: State<AppState>, row: FunLibRow) -> Result<(), String> {
    let mut row = row;
    row.kind = clean_kind(&row.kind);
    if row.item_id.trim().is_empty() || row.title.trim().is_empty() {
        return Err("Nothing to keep".into());
    }
    store_of(&state)?.fun_lib_set(&row).map_err(store_err)
}

#[tauri::command]
pub fn fun_lib_remove(state: State<AppState>, kind: String, item_id: String) -> Result<(), String> {
    store_of(&state)?
        .fun_lib_remove(&clean_kind(&kind), &item_id)
        .map_err(store_err)
}

/// Everything the viewer flagged on one title, so the sheet can paint its buttons.
#[tauri::command]
pub fn fun_lib_flags(state: State<AppState>, item_id: String) -> Result<Vec<String>, String> {
    store_of(&state)?.fun_lib_flags(&item_id).map_err(store_err)
}

/// Drop the in-memory HTTP cache so the next visit asks every source again.
#[tauri::command]
pub fn fun_cache_clear() -> usize {
    let map = cache();
    let mut guard = match map.lock() {
        Ok(g) => g,
        Err(e) => e.into_inner(),
    };
    let n = guard.len();
    guard.clear();
    n
}

#[tauri::command]
pub fn fun_progress_list(
    state: State<AppState>,
    limit: Option<i64>,
) -> Result<Vec<FunProgressRow>, String> {
    store_of(&state)?
        .fun_progress_list(limit.unwrap_or(20))
        .map_err(store_err)
}

#[tauri::command]
pub fn fun_progress_remove(
    state: State<AppState>,
    source_id: i64,
    item_id: String,
) -> Result<(), String> {
    store_of(&state)?
        .fun_progress_remove(source_id, &item_id)
        .map_err(store_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_split_into_source_and_item() {
        assert_eq!(parse_source_id("12:tt1234"), 12);
        assert_eq!(strip_source_id("12:tt1234"), "tt1234");
        assert_eq!(strip_source_id("plain"), "plain");
    }

    #[test]
    fn shelf_kinds_map_from_stremio_types() {
        assert_eq!(shelf_kind("series"), Kind::Series);
        assert_eq!(shelf_kind("manga"), Kind::Manga);
        assert_eq!(shelf_kind("weird"), Kind::Movie);
    }

    #[test]
    fn errors_stay_short_and_hide_urls() {
        let e =
            short("error sending request for url (https://secret.example/abc?token=zzz)".into());
        assert!(!e.contains("http"), "{e}");
        assert!(e.len() <= 90);
        assert!(short("timed out".into()).contains("did not answer"));
    }
}

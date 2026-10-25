use g9_core::{ParsedChannel, SourceKind, APP_NAME, APP_VERSION, CONTENT_POLICY};
use g9_iptv::{parse_m3u, ParseOptions};
use g9_store::{ChannelRow, GroupRow, HistoryRow, SourceRow, StoreStats};
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::fetch::fetch_playlist;
use crate::state::AppState;

const DEMO_M3U: &str = r#"#EXTM3U
#PLAYLIST:G9 demo clips (not TV channels)
#EXTINF:-1 tvg-logo="https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Big_buck_bunny_poster_big.jpg/320px-Big_buck_bunny_poster_big.jpg" group-title="Demo clips",Big Buck Bunny (MP4)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4
#EXTINF:-1 group-title="Demo clips",Sintel (MP4)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4
#EXTINF:-1 group-title="Demo clips",Tears of Steel (MP4)
https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4
#EXTINF:-1 group-title="Demo clips",Mux HLS test stream
https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8
"#;

#[derive(Serialize)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub content_policy: String,
}

#[derive(Serialize)]
pub struct ImportResult {
    pub source_id: i64,
    pub channel_count: usize,
    pub group_count: usize,
    pub stripped_extvlcopt: usize,
    pub skipped_dangerous: usize,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: APP_NAME.into(),
        version: APP_VERSION.into(),
        content_policy: CONTENT_POLICY.into(),
    }
}

#[tauri::command]
pub fn import_m3u_text(
    state: State<AppState>,
    name: String,
    text: String,
    origin: String,
) -> Result<ImportResult, String> {
    let kind = if origin == "file" {
        SourceKind::File
    } else {
        SourceKind::Url
    };
    import_parsed(&state, kind, &name, "local://paste", &text)
}

#[tauri::command]
pub fn import_m3u_url(
    state: State<AppState>,
    name: String,
    url: String,
) -> Result<ImportResult, String> {
    let text = fetch_playlist(&url)?;
    import_parsed(&state, SourceKind::Url, &name, &url, &text)
}

#[tauri::command]
pub fn import_m3u_file(
    state: State<AppState>,
    name: String,
    path: String,
) -> Result<ImportResult, String> {
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    import_parsed(&state, SourceKind::File, &name, &path, &text)
}

#[tauri::command]
pub fn load_demo_playlist(state: State<AppState>) -> Result<ImportResult, String> {
    import_parsed(
        &state,
        SourceKind::Url,
        "G9 demo clips",
        "g9://demo",
        DEMO_M3U,
    )
}

fn import_parsed(
    state: &AppState,
    kind: SourceKind,
    name: &str,
    url: &str,
    text: &str,
) -> Result<ImportResult, String> {
    let (channels, report): (Vec<ParsedChannel>, _) =
        parse_m3u(text, ParseOptions::for_kind(kind)).map_err(|e| e.to_string())?;
    if channels.is_empty() {
        return Err("no playable entries found in playlist".into());
    }
    let epg_url = report.epg_url.clone();
    let mut store = state.store.lock().map_err(|e| e.to_string())?;
    let (source_id, _) = store
        .add_source(kind, name, url, &channels)
        .map_err(|e| e.to_string())?;
    if let Some(guide) = epg_url {
        let _ = store.set_setting(&format!("epg_url:{source_id}"), &guide);
    }
    Ok(ImportResult {
        source_id,
        channel_count: report.channel_count,
        group_count: report.group_count,
        stripped_extvlcopt: report.stripped_extvlcopt,
        skipped_dangerous: report.skipped_dangerous,
    })
}

#[tauri::command]
pub fn list_sources(state: State<AppState>) -> Result<Vec<SourceRow>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .list_sources()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_source(state: State<AppState>, id: i64) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .delete_source(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_groups(state: State<AppState>) -> Result<Vec<GroupRow>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .list_groups()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_channels(
    state: State<AppState>,
    group: Option<String>,
    query: Option<String>,
    favourites_only: Option<bool>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<ChannelRow>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .list_channels(
            group.as_deref().filter(|g| !g.is_empty() && *g != "All"),
            query.as_deref().filter(|q| !q.is_empty()),
            favourites_only.unwrap_or(false),
            limit.unwrap_or(200),
            offset.unwrap_or(0),
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_channel(state: State<AppState>, id: i64) -> Result<Option<ChannelRow>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .get_channel(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn neighbours(state: State<AppState>, id: i64) -> Result<(Option<i64>, Option<i64>), String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .neighbour_ids(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn toggle_favourite(state: State<AppState>, id: i64) -> Result<bool, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .toggle_favourite(id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_history(
    state: State<AppState>,
    title: String,
    url: String,
    kind: String,
    position: f64,
    duration: f64,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .add_history(&title, &url, &kind, position, duration)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_history(state: State<AppState>) -> Result<Vec<HistoryRow>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .list_history(80)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> Result<Option<String>, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .setting(&key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .set_setting(&key, &value)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stats(state: State<AppState>) -> Result<StoreStats, String> {
    state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .stats()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn find_subtitles(
    query: String,
    language: Option<String>,
) -> Result<Vec<crate::subs::SubHit>, String> {
    let lang = language.unwrap_or_else(|| "en".into());
    tauri::async_runtime::spawn_blocking(move || crate::subs::search(&query, &lang))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn apply_best_subtitles(
    query: String,
    language: Option<String>,
    path: Option<String>,
    generate: Option<bool>,
) -> Result<crate::subs::SubResult, String> {
    let lang = language.unwrap_or_else(|| "en".into());
    let generate = generate.unwrap_or(false);
    tauri::async_runtime::spawn_blocking(move || {
        crate::subs::fetch_best(&query, &lang, path.as_deref(), generate)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dlna_discover() -> Result<Vec<crate::dlna::DlnaServer>, String> {
    tauri::async_runtime::spawn_blocking(crate::dlna::discover)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dlna_browse(
    control_url: String,
    object_id: Option<String>,
) -> Result<Vec<crate::dlna::DlnaItem>, String> {
    let id = object_id.unwrap_or_else(|| "0".into());
    tauri::async_runtime::spawn_blocking(move || crate::dlna::browse(&control_url, &id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ffmpeg_available() -> bool {
    crate::tools::ffmpeg_available()
}

#[tauri::command]
pub async fn extract_audio(path: String, dest: String) -> Result<crate::tools::ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::tools::extract_audio(&path, &dest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn remux_repair(path: String, dest: String) -> Result<crate::tools::ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::tools::remux_repair(&path, &dest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn probe_media(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::tools::probe(&path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rtmp_out(path: String, rtmp: String) -> Result<crate::tools::ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::tools::rtmp_out(&path, &rtmp))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn convert_media(path: String, dest: String) -> Result<crate::tools::ToolResult, String> {
    tauri::async_runtime::spawn_blocking(move || crate::tools::convert(&path, &dest))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn translate_text(
    text: String,
    from: Option<String>,
    to: Option<String>,
) -> Result<String, String> {
    let from = from.unwrap_or_else(|| "en".into());
    let to = to.unwrap_or_else(|| "es".into());
    tauri::async_runtime::spawn_blocking(move || crate::tools::translate(&text, &from, &to))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fetch_url(url: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || crate::fetch::fetch_playlist(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ffmpeg_status() -> crate::ffmpeg::Status {
    crate::ffmpeg::status()
}

#[tauri::command]
pub async fn ffmpeg_install(app: AppHandle) -> Result<crate::ffmpeg::Status, String> {
    tauri::async_runtime::spawn_blocking(move || crate::ffmpeg::install(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ffmpeg_remove() -> Result<crate::ffmpeg::Status, String> {
    crate::ffmpeg::remove()
}

// ------------------------------------------------------------------ web video

#[tauri::command]
pub fn dl_tool(app: AppHandle) -> crate::dl::ToolStatus {
    crate::dl::tool_status(&app)
}

#[tauri::command]
pub async fn dl_install(app: AppHandle) -> Result<crate::dl::ToolStatus, String> {
    tauri::async_runtime::spawn_blocking(move || crate::dl::install(&app))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dl_probe(app: AppHandle, url: String) -> Result<g9_core::download::MediaInfo, String> {
    tauri::async_runtime::spawn_blocking(move || crate::dl::probe(&app, &url))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn dl_start(
    app: AppHandle,
    url: String,
    height: u32,
    title: Option<String>,
) -> Result<crate::dl::Job, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::dl::start(&app, &url, height, title.as_deref())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dl_list() -> Vec<crate::dl::Job> {
    crate::dl::list()
}

#[tauri::command]
pub fn dl_toggle(app: AppHandle, id: String) -> Result<crate::dl::Job, String> {
    crate::dl::toggle(&app, &id)
}

#[tauri::command]
pub fn dl_cancel(app: AppHandle, id: String) -> Result<crate::dl::Job, String> {
    crate::dl::cancel(&app, &id)
}

#[tauri::command]
pub fn dl_remove(app: AppHandle, id: String, delete_file: bool) -> Result<(), String> {
    crate::dl::remove(&app, &id, delete_file)
}

#[tauri::command]
pub fn dl_play(id: String) -> Result<String, String> {
    let path = crate::dl::list()
        .into_iter()
        .find(|j| j.id == id)
        .and_then(|j| j.path)
        .ok_or("That download has not finished yet")?;
    if std::path::Path::new(&path).is_file() {
        Ok(path)
    } else {
        Err("That file is no longer on disk".into())
    }
}

#[tauri::command]
pub fn dl_reveal(app: AppHandle, id: String) -> Result<(), String> {
    let path = crate::dl::list()
        .into_iter()
        .find(|j| j.id == id)
        .and_then(|j| j.path)
        .ok_or("That download has not finished yet")?;
    crate::args::reveal_in_folder(app, path).map(|_| ())
}

// ------------------------------------------------------------------ guide + portals

#[tauri::command]
pub fn epg_status() -> crate::epg::GuideStatus {
    crate::epg::status()
}

#[tauri::command]
pub async fn epg_load(app: AppHandle, url: String) -> Result<crate::epg::GuideStatus, String> {
    let dir = app.path().app_data_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let text = crate::fetch::fetch_guide(&url)?;
        let st = crate::epg::load(&text, &url);
        if !st.loaded {
            return Err("that address did not return a guide".into());
        }
        if let Some(dir) = dir {
            crate::epg::store(&dir, &text);
        }
        Ok(st)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn epg_load_source(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
) -> Result<crate::epg::GuideStatus, String> {
    let dir = app.path().app_data_dir().ok();
    let key = format!("epg_url:{id}");
    let url = state
        .store
        .lock()
        .map_err(|e| e.to_string())?
        .setting(&key)
        .map_err(|e| e.to_string())?
        .ok_or("This playlist did not come with a guide address")?;
    tauri::async_runtime::spawn_blocking(move || {
        let text = crate::fetch::fetch_guide(&url)?;
        let st = crate::epg::load(&text, &url);
        if !st.loaded {
            return Err("that address did not return a guide".into());
        }
        if let Some(dir) = dir {
            crate::epg::store(&dir, &text);
        }
        Ok(st)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn epg_clear() {
    crate::epg::clear()
}

#[tauri::command]
pub fn epg_now(ids: Vec<String>) -> Vec<crate::epg::Guide> {
    crate::epg::now_next(&ids, None)
}

#[tauri::command]
pub async fn xtream_import(
    state: State<'_, AppState>,
    server: String,
    user: String,
    pass: String,
    name: Option<String>,
) -> Result<ImportResult, String> {
    let portal = tauri::async_runtime::spawn_blocking(move || {
        crate::xtream::import(&server, &user, &pass, name)
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut out = import_parsed(
        &state,
        SourceKind::Url,
        &portal.name,
        "xtream://",
        &portal.m3u,
    )?;
    out.group_count = portal.groups;
    Ok(out)
}

mod commands;
mod fetch;
mod state;
mod subs;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = AppState::init(&handle)?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::import_m3u_text,
            commands::import_m3u_url,
            commands::import_m3u_file,
            commands::list_sources,
            commands::delete_source,
            commands::list_groups,
            commands::list_channels,
            commands::get_channel,
            commands::neighbours,
            commands::toggle_favourite,
            commands::add_history,
            commands::list_history,
            commands::get_setting,
            commands::set_setting,
            commands::stats,
            commands::load_demo_playlist,
            commands::find_subtitles,
            commands::apply_best_subtitles,
        ])
        .run(tauri::generate_context!())
        .expect("G9 failed to start");
}

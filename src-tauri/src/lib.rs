mod args;
mod commands;
mod dl;
mod dlna;
mod epg;
mod fetch;
mod ffmpeg;
mod files;
mod fun;
mod ipc;
mod social;
mod state;
mod subs;
mod tools;
mod update;
mod windows;
mod xtream;

use state::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let state = AppState::init(&handle)?;
            app.manage(state);
            // Social keeps its own database and its own key file, so it can be removed
            // or backed up on its own.
            app.manage(crate::social::SocialState::init(&handle)?);
            crate::ffmpeg::init(&handle);
            crate::dl::restore(&handle);
            crate::dl::spawn_reaper(handle.clone());
            if let Ok(dir) = handle.path().app_data_dir() {
                crate::epg::restore(&dir);
            }
            crate::ipc::spawn(handle);
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
            commands::channel_facets,
            commands::channel_total,
            commands::get_channel,
            commands::neighbours,
            commands::toggle_favourite,
            commands::add_history,
            commands::list_history,
            commands::get_setting,
            commands::set_setting,
            commands::stats,
            commands::load_demo_playlist,
            social::social_identity,
            social::social_set_name,
            social::social_handshake,
            social::social_invite,
            social::social_parse_invite,
            social::social_qr,
            social::social_threads,
            social::social_upsert_thread,
            social::social_messages,
            social::social_save_message,
            social::social_set_state,
            social::social_mark_read,
            social::social_contacts,
            social::social_devices,
            social::social_data_dir,
            commands::find_subtitles,
            commands::apply_subtitle,
            commands::update_check,
            commands::open_url,
            files::list_folder,
            files::read_text,
            files::playlist_save,
            files::playlist_load,
            commands::apply_best_subtitles,
            commands::dlna_discover,
            commands::dlna_browse,
            commands::ffmpeg_available,
            commands::extract_audio,
            commands::remux_repair,
            commands::probe_media,
            commands::rtmp_out,
            commands::convert_media,
            commands::translate_text,
            commands::fetch_url,
            commands::ffmpeg_status,
            commands::ffmpeg_install,
            commands::ffmpeg_remove,
            windows::open_player_window,
            windows::snap_window,
            windows::schedule_pc_shutdown,
            windows::cancel_pc_shutdown,
            windows::list_user_shaders,
            windows::shaders_dir,
            files::save_data_url,
            files::write_chunk,
            files::save_frame,
            files::pictures_dir,
            args::startup_file,
            args::reveal_in_folder,
            commands::dl_tool,
            commands::dl_install,
            commands::dl_probe,
            commands::dl_start,
            commands::dl_list,
            commands::dl_toggle,
            commands::dl_cancel,
            commands::dl_retry,
            commands::dl_remove,
            commands::dl_play,
            commands::epg_status,
            commands::epg_load,
            commands::epg_load_source,
            commands::dl_reveal,
            commands::epg_clear,
            commands::epg_now,
            commands::epg_upcoming,
            commands::xtream_import,
            fun::fun_sources,
            fun::fun_source_add,
            fun::fun_source_remove,
            fun::fun_source_toggle,
            fun::fun_home,
            fun::fun_search,
            fun::fun_details,
            fun::fun_streams,
            fun::fun_catalog,
            fun::fun_catalog_filters,
            fun::fun_source_headers,
            fun::fun_source_test,
            fun::fun_subtitles,
            fun::fun_subtitle_text,
            fun::fun_resolve,
            fun::fun_pages,
            fun::fun_progress_save,
            fun::fun_lib_list,
            fun::fun_lib_set,
            fun::fun_lib_remove,
            fun::fun_lib_flags,
            fun::fun_cache_clear,
            fun::fun_progress_list,
            fun::fun_progress_remove,
        ])
        .run(tauri::generate_context!())
        .expect("G9 failed to start");
}

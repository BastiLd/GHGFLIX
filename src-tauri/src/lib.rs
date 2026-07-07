mod commands;
mod db;
mod intro;
mod models;
mod parser;
mod paths;
mod probe;
mod scanner;
mod tmdb;
mod watcher;

use notify::RecommendedWatcher;
use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::Manager;

pub struct AppState {
    pub db_path: PathBuf,
    pub conn: Mutex<Connection>,
    pub http: reqwest::Client,
    pub scanning: AtomicBool,
    pub watcher: Mutex<Option<RecommendedWatcher>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_mpv::init())
        .setup(|app| {
            let dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data dir");
            std::fs::create_dir_all(&dir).ok();
            let db_path = dir.join("ghgflix.db");
            let conn = db::open(&db_path).expect("failed to open database");
            // Auto-fill working mpv.exe / ffmpeg.exe paths (avoids the console
            // mpv.com terminal window and makes intro detection work out of the box).
            paths::ensure_player_paths(&conn);
            // Re-link any watched-state rows that lost their target (e.g. the app
            // was closed mid-rebuild) — cheap, and makes the state visible instantly.
            let _ = db::remap_stale_refs(&conn);
            // ONE-TIME auto-repair: earlier versions mis-grouped shows whose
            // seasons were spread across differently-named folders/drives (the
            // "original Daredevil season folded into Born Again" bug). The grouping
            // + matching are fixed now, but existing DBs are already contaminated
            // at the episode level, which only a fresh index can undo. So on the
            // first launch of this fixed build we clear the SHOW/EPISODE index
            // (keeping settings, progress, favorites, placements, identity) and let
            // the normal scan rebuild it correctly. Watched state survives via the
            // path-based remap. Gated by a flag so it runs exactly once.
            // v096: re-run after fixing a poisoned identity override ("Marvel's
            // Daredevil" folder was remembered as Born Again) + Miraculous S6
            // title-based placements — the index must be rebuilt once more so the
            // corrected mappings take effect everywhere.
            const REPAIR_TAG: &str = "regroup-v096";
            let need_repair = db::get_setting(&conn, "repair_done").ok().flatten().as_deref() != Some(REPAIR_TAG);
            if need_repair {
                for sql in [
                    "DELETE FROM episode_files",
                    "DELETE FROM episodes",
                    "DELETE FROM show_keys",
                    "DELETE FROM shows",
                    "DELETE FROM movies",
                ] {
                    let _ = conn.execute(sql, []);
                }
                let _ = db::set_setting(&conn, "repair_done", REPAIR_TAG);
                // force a scan on this launch even if auto-scan is off, so the
                // library is never left empty after the wipe
                let _ = db::set_setting(&conn, "force_scan_once", "1");
            }
            // Weekly automatic backup of watched data + favorites into app-data.
            let backup_on = db::get_setting(&conn, "pref_autoBackup")
                .ok()
                .flatten()
                .map(|v| v != "off")
                .unwrap_or(true);
            if backup_on {
                let backup = dir.join("ghgflix-backup.json");
                let stale = std::fs::metadata(&backup)
                    .and_then(|m| m.modified())
                    .ok()
                    .and_then(|t| t.elapsed().ok())
                    .map(|d| d.as_secs() > 7 * 86400)
                    .unwrap_or(true);
                if stale {
                    let _ = commands::write_export(&conn, &backup.to_string_lossy());
                }
            }
            // timeouts so a flaky connection can never hang a scan forever
            let http = reqwest::Client::builder()
                .user_agent("GHGFlix/0.7")
                .connect_timeout(std::time::Duration::from_secs(10))
                .timeout(std::time::Duration::from_secs(25))
                .build()
                .expect("failed to build http client");

            app.manage(AppState {
                db_path,
                conn: Mutex::new(conn),
                http,
                scanning: AtomicBool::new(false),
                watcher: Mutex::new(None),
            });

            watcher::rewatch(app.handle());

            // Safety net: the window starts hidden (so the transparent webview never
            // flashes the desktop before React paints). The frontend reveals it as
            // soon as it has rendered; this guarantees it shows even if the frontend
            // fails to load, so the app can never get stuck running invisibly.
            let reveal = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                if let Some(w) = reveal.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_setting,
            commands::set_setting,
            commands::get_libraries,
            commands::add_library,
            commands::detect_libraries,
            commands::remove_library,
            commands::scan_libraries,
            commands::refresh_metadata,
            commands::detect_intros,
            commands::is_scanning,
            commands::reset_library,
            commands::list_movies,
            commands::get_movie,
            commands::movie_versions,
            commands::list_shows,
            commands::get_show_detail,
            commands::get_episode,
            commands::episode_versions,
            commands::list_show_episodes,
            commands::path_exists,
            commands::reveal_in_explorer,
            commands::open_app_data,
            commands::search_tmdb,
            commands::identify_movie,
            commands::identify_show,
            commands::set_episode_numbers,
            commands::set_progress,
            commands::get_progress,
            commands::list_progress,
            commands::continue_watching,
            commands::apply_remote_progress,
            commands::toggle_favorite,
            commands::list_favorites,
            commands::set_watched,
            commands::set_show_watched,
            commands::set_season_watched,
            commands::get_stats,
            commands::tmdb_extras,
            commands::tmdb_images,
            commands::set_artwork,
            commands::get_season_art,
            commands::media_thumbnail,
            commands::probe_qualities,
            commands::check_tools,
            commands::thumb_cache_size,
            commands::clear_thumb_cache,
            commands::set_media_dims,
            commands::set_episode_intro,
            commands::set_show_intro,
            commands::search_episodes,
            commands::db_optimize,
            commands::export_data,
            commands::import_data,
            commands::tmdb_season_list,
            commands::tmdb_season_numbers,
            commands::assign_episodes_sequential,
            commands::reassign_season,
            commands::reassign_episode,
            commands::repair_season_titles,
            commands::file_info,
            commands::recently_watched,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

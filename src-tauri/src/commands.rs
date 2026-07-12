use crate::models::*;
use crate::tmdb::Tmdb;
use rusqlite::params;
use crate::{db, scanner, watcher, AppState};
use serde::Deserialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager, State};

type R<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

fn read_key_lang(state: &AppState) -> (String, String) {
    let conn = state.conn.lock().unwrap();
    let key = db::get_setting(&conn, "tmdb_key").ok().flatten().unwrap_or_default();
    let lang = db::get_setting(&conn, "tmdb_lang").ok().flatten().unwrap_or_else(|| "de-DE".into());
    (key, lang)
}

// ===== settings =====

#[tauri::command]
pub fn get_setting(state: State<AppState>, key: String) -> R<Option<String>> {
    let conn = state.conn.lock().unwrap();
    db::get_setting(&conn, &key).map_err(err)
}

#[tauri::command]
pub fn set_setting(app: AppHandle, state: State<AppState>, key: String, value: String) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        db::set_setting(&conn, &key, &value).map_err(err)?;
    }
    // toggling the folder watcher takes effect immediately
    if key == "watch_fs" {
        watcher::rewatch(&app);
    }
    Ok(())
}

// ===== libraries =====

#[tauri::command]
pub fn get_libraries(state: State<AppState>) -> R<Vec<Library>> {
    let conn = state.conn.lock().unwrap();
    db::list_libraries(&conn).map_err(err)
}

#[tauri::command]
pub fn add_library(app: AppHandle, state: State<AppState>, path: String, kind: String) -> R<i64> {
    let id = {
        let conn = state.conn.lock().unwrap();
        db::add_library(&conn, &path, &kind).map_err(err)?
    };
    watcher::rewatch(&app);
    Ok(id)
}

/// Classify a folder name as a movie or tv library based on common naming.
fn classify_dir(name: &str) -> Option<&'static str> {
    let tokens: Vec<String> = name
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .map(|s| s.to_string())
        .collect();
    let has = |kws: &[&str]| tokens.iter().any(|t| kws.contains(&t.as_str()));
    if has(&["movies", "movie", "filme", "film", "films", "kinofilme", "kino"]) {
        return Some("movie");
    }
    if has(&["tv", "tvshows", "series", "serie", "serien", "shows", "show", "staffeln", "anime"]) {
        return Some("tv");
    }
    None
}

fn detect_recursive(dir: &Path, depth: u32, max: u32, out: &mut Vec<(String, String)>) {
    if depth > max {
        return;
    }
    let rd = match std::fs::read_dir(dir) {
        Ok(r) => r,
        Err(_) => return,
    };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('$') || name.starts_with('.') {
            continue; // skip system/hidden folders ($RECYCLE.BIN, etc.)
        }
        match classify_dir(&name) {
            Some(kind) => out.push((p.to_string_lossy().to_string(), kind.to_string())),
            None => detect_recursive(&p, depth + 1, max, out),
        }
    }
}

/// Scan a parent folder or whole drive for movie/series subfolders and add them
/// as libraries. Returns the updated library list. Also classifies the root itself.
#[tauri::command]
pub fn detect_libraries(app: AppHandle, state: State<AppState>, root: String) -> R<Vec<Library>> {
    let root_path = Path::new(&root);
    if !root_path.exists() {
        return Err("Pfad existiert nicht".into());
    }
    let mut found: Vec<(String, String)> = Vec::new();
    if let Some(file_name) = root_path.file_name() {
        if let Some(kind) = classify_dir(&file_name.to_string_lossy()) {
            found.push((root_path.to_string_lossy().to_string(), kind.to_string()));
        }
    }
    detect_recursive(root_path, 0, 4, &mut found);

    let added = {
        let conn = state.conn.lock().unwrap();
        for (p, k) in &found {
            let _ = db::add_library(&conn, p, k);
        }
        found.len()
    };
    if added > 0 {
        watcher::rewatch(&app);
    }
    let conn = state.conn.lock().unwrap();
    db::list_libraries(&conn).map_err(err)
}

#[tauri::command]
pub fn remove_library(app: AppHandle, state: State<AppState>, id: i64) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        db::remove_library(&conn, id).map_err(err)?;
    }
    watcher::rewatch(&app);
    Ok(())
}

// ===== scanning =====

#[tauri::command]
pub fn scan_libraries(app: AppHandle, state: State<AppState>) -> R<()> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("Scan läuft bereits".into());
    }
    let db_path = state.db_path.clone();
    let http = state.http.clone();
    std::thread::spawn(move || {
        if let Err(e) = scanner::run_scan(db_path, http, app.clone()) {
            let _ = app.emit(
                "scan://progress",
                scanner::ScanProgress {
                    stage: "error".into(),
                    message: format!("Fehler: {e}"),
                    current: 0,
                    total: 0,
                },
            );
        }
        app.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    });
    Ok(())
}

#[tauri::command]
pub fn is_scanning(state: State<AppState>) -> bool {
    state.scanning.load(Ordering::SeqCst)
}

/// Wipe the indexed library (movies/shows/episodes/files/season art) but keep
/// libraries, settings, progress and favorites. Used by "Bibliothek neu aufbauen"
/// to fix grouping/duplicates from before, followed by a fresh scan.
#[tauri::command]
pub fn reset_library(app: AppHandle, state: State<AppState>) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        for sql in [
            "DELETE FROM episode_files",
            "DELETE FROM episodes",
            "DELETE FROM show_keys",
            "DELETE FROM shows",
            "DELETE FROM movies",
            "DELETE FROM season_art",
        ] {
            conn.execute(sql, []).map_err(err)?;
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Detect intros via audio fingerprints. `show_id` = None processes all shows.
#[tauri::command]
pub fn detect_intros(app: AppHandle, state: State<AppState>, show_id: Option<i64>) -> R<()> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("Es läuft bereits ein Vorgang".into());
    }
    let db_path = state.db_path.clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::intro::run_detect(db_path, app.clone(), show_id) {
            let _ = app.emit(
                "scan://progress",
                scanner::ScanProgress { stage: "error".into(), message: format!("Fehler: {e}"), current: 0, total: 0 },
            );
        }
        app.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Re-pull TMDb metadata (posters, overviews, all episodes) for every matched item.
#[tauri::command]
pub fn refresh_metadata(app: AppHandle, state: State<AppState>) -> R<()> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("Es läuft bereits ein Vorgang".into());
    }
    let db_path = state.db_path.clone();
    let http = state.http.clone();
    std::thread::spawn(move || {
        if let Err(e) = scanner::run_refresh(db_path, http, app.clone()) {
            let _ = app.emit(
                "scan://progress",
                scanner::ScanProgress { stage: "error".into(), message: format!("Fehler: {e}"), current: 0, total: 0 },
            );
        }
        app.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    });
    Ok(())
}

// ===== library reads =====

#[tauri::command]
pub fn list_movies(state: State<AppState>) -> R<Vec<Movie>> {
    let conn = state.conn.lock().unwrap();
    db::list_movies(&conn).map_err(err)
}

#[tauri::command]
pub fn get_movie(state: State<AppState>, id: i64) -> R<Option<Movie>> {
    let conn = state.conn.lock().unwrap();
    db::get_movie(&conn, id).map_err(err)
}

/// All files of the same movie (different qualities), best first.
#[tauri::command]
pub fn movie_versions(state: State<AppState>, id: i64) -> R<Vec<Movie>> {
    let conn = state.conn.lock().unwrap();
    db::movie_versions(&conn, id).map_err(err)
}

#[tauri::command]
pub fn list_shows(state: State<AppState>) -> R<Vec<Show>> {
    let conn = state.conn.lock().unwrap();
    db::list_shows(&conn).map_err(err)
}

#[tauri::command]
pub fn get_show_detail(state: State<AppState>, id: i64) -> R<Option<ShowDetail>> {
    let conn = state.conn.lock().unwrap();
    let show = match db::get_show(&conn, id).map_err(err)? {
        Some(s) => s,
        None => return Ok(None),
    };
    let episodes = db::list_episodes(&conn, id).map_err(err)?;
    let mut seasons: Vec<SeasonGroup> = Vec::new();
    for ep in episodes {
        match seasons.last_mut() {
            Some(g) if g.season == ep.season => g.episodes.push(ep),
            _ => seasons.push(SeasonGroup { season: ep.season, episodes: vec![ep] }),
        }
    }
    Ok(Some(ShowDetail { show, seasons }))
}

#[tauri::command]
pub fn get_episode(state: State<AppState>, id: i64) -> R<Option<Episode>> {
    let conn = state.conn.lock().unwrap();
    db::get_episode(&conn, id).map_err(err)
}

/// All files (qualities) of an episode, best first.
#[tauri::command]
pub fn episode_versions(state: State<AppState>, id: i64) -> R<Vec<EpisodeFile>> {
    let conn = state.conn.lock().unwrap();
    db::episode_files(&conn, id).map_err(err)
}

#[tauri::command]
pub fn list_show_episodes(state: State<AppState>, show_id: i64) -> R<Vec<Episode>> {
    let conn = state.conn.lock().unwrap();
    db::list_episodes(&conn, show_id).map_err(err)
}

#[tauri::command]
pub fn path_exists(path: String) -> bool {
    Path::new(&path).exists()
}

/// Open Windows Explorer with the given file selected (or the folder opened).
#[tauri::command]
pub fn reveal_in_explorer(path: String) -> R<()> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("Datei/Ordner existiert nicht (mehr)".into());
    }
    let mut cmd = std::process::Command::new("explorer");
    if p.is_dir() {
        cmd.arg(&path);
    } else {
        cmd.arg(format!("/select,{path}"));
    }
    cmd.spawn().map_err(err)?;
    Ok(())
}

/// Open the app-data folder (database, etc.) in Explorer.
#[tauri::command]
pub fn open_app_data(state: State<AppState>) -> R<()> {
    let dir = state
        .db_path
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or("App-Daten-Ordner nicht gefunden")?;
    std::process::Command::new("explorer").arg(&dir).spawn().map_err(err)?;
    Ok(())
}

// ===== TMDb search + manual identify =====

#[tauri::command]
pub async fn search_tmdb(state: State<'_, AppState>, query: String, kind: String) -> R<Vec<TmdbResult>> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    let q = query.trim();

    // 1) exactly as typed
    let mut results = tmdb.search(q, &kind, None).await.map_err(err)?;

    // 2) cleaned — turns "-"/"."/"_" into spaces and drops scene junk, so e.g.
    //    "Miraculous - Tales of…" or "Spider-Man" actually return hits
    if results.is_empty() {
        let cleaned = crate::parser::clean_search_query(q);
        if !cleaned.is_empty() && !cleaned.eq_ignore_ascii_case(q) {
            results = tmdb.search(&cleaned, &kind, None).await.unwrap_or_default();
        }
    }

    // 3) progressively shorter — drop trailing words to rescue long messy names
    if results.is_empty() {
        let base = crate::parser::clean_search_query(q);
        let words: Vec<&str> = base.split_whitespace().collect();
        let mut n = words.len();
        while results.is_empty() && n > 1 {
            n -= 1;
            results = tmdb.search(&words[..n].join(" "), &kind, None).await.unwrap_or_default();
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn identify_movie(
    app: AppHandle,
    state: State<'_, AppState>,
    movie_id: i64,
    tmdb_id: i64,
    remember: Option<bool>,
) -> R<()> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    let meta = tmdb.movie_details(tmdb_id).await.map_err(err)?;
    {
        let conn = state.conn.lock().unwrap();
        let genres = serde_json::to_string(&meta.genres).ok();
        db::update_movie_match(
            &conn,
            movie_id,
            meta.tmdb_id,
            &meta.title,
            meta.year,
            meta.overview.as_deref(),
            meta.poster_path.as_deref(),
            meta.backdrop_path.as_deref(),
            genres.as_deref(),
            meta.runtime,
            meta.rating,
            true,
            meta.cert.as_deref(),
        )
        .map_err(err)?;
        // remember "this file IS this movie" so every rescan/rebuild re-applies it
        if remember.unwrap_or(true) {
            if let Ok(Some(m)) = db::get_movie(&conn, movie_id) {
                if let Some(name) = Path::new(&m.path).file_name() {
                    let stem = name.to_string_lossy();
                    let stem = stem.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| stem.to_string());
                    let _ = db::set_identity_override(&conn, "movie", &crate::parser::movie_key(&stem), meta.tmdb_id);
                }
            }
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Manually match a show. Returns the id of the surviving show row — merging with
/// an already-matched duplicate can fold this row into another one.
#[tauri::command]
pub async fn identify_show(
    app: AppHandle,
    state: State<'_, AppState>,
    show_id: i64,
    tmdb_id: i64,
    remember: Option<bool>,
) -> R<i64> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    let show_meta = tmdb.tv_details(tmdb_id).await.map_err(err)?;

    let seasons = {
        let conn = state.conn.lock().unwrap();
        db::distinct_seasons(&conn, show_id).map_err(err)?
    };

    let mut all_eps: Vec<(i64, Vec<crate::tmdb::EpisodeMeta>)> = Vec::new();
    for season in seasons {
        if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
            all_eps.push((season, eps));
        }
    }

    {
        let conn = state.conn.lock().unwrap();
        let genres = serde_json::to_string(&show_meta.genres).ok();
        db::update_show_match(
            &conn,
            show_id,
            show_meta.tmdb_id,
            &show_meta.title,
            show_meta.year,
            show_meta.overview.as_deref(),
            show_meta.poster_path.as_deref(),
            show_meta.backdrop_path.as_deref(),
            genres.as_deref(),
            show_meta.rating,
            true,
            show_meta.cert.as_deref(),
            show_meta.status.as_deref(),
            show_meta.last_year,
            show_meta.runtime,
        )
        .map_err(err)?;
        for (season, eps) in all_eps {
            for ep in eps {
                db::update_episode_meta(
                    &conn,
                    show_id,
                    season,
                    ep.episode,
                    ep.title.as_deref(),
                    ep.overview.as_deref(),
                    ep.still_path.as_deref(),
                    ep.air_date.as_deref(),
                    ep.runtime,
                )
                .map_err(err)?;
            }
        }
        // remember "this folder IS this show" so every rescan/rebuild re-applies it
        if remember.unwrap_or(true) {
            for key in db::keys_for_show(&conn, show_id).unwrap_or_default() {
                let _ = db::set_identity_override(&conn, "tv", &key, show_meta.tmdb_id);
            }
        }
        // if another folder of this show was already matched, fold them together
        db::merge_shows_by_tmdb(&conn).map_err(err)?;
    }
    let surviving = {
        let conn = state.conn.lock().unwrap();
        db::find_show_by_tmdb(&conn, show_meta.tmdb_id).map_err(err)?.unwrap_or(show_id)
    };
    let _ = app.emit("library://updated", ());
    Ok(surviving)
}

/// Set an episode's season/episode AND write the chosen TMDb episode's metadata
/// (title, description, image) DIRECTLY onto this file — so the file the user
/// picked always shows that exact episode's name and still, no matter how the
/// rest of the show is numbered. Conflict-safe (displaces any occupant).
#[tauri::command]
pub async fn set_episode_numbers(
    app: AppHandle,
    state: State<'_, AppState>,
    episode_id: i64,
    season: i64,
    episode: i64,
) -> R<()> {
    let show: Option<(i64, Option<i64>)> = {
        let conn = state.conn.lock().unwrap();
        db::set_episode_numbers(&conn, episode_id, season, episode).map_err(err)?;
        conn.query_row(
            "SELECT e.show_id, s.tmdb_id FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=?1",
            [episode_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, Option<i64>>(1)?)),
        )
        .ok()
    };
    if let Some((show_id, Some(tmdb_id))) = show {
        let (key, lang) = read_key_lang(&state);
        if !key.trim().is_empty() {
            let tmdb = Tmdb::new(state.http.clone(), key, lang);
            if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
                let conn = state.conn.lock().unwrap();
                // 1) the picked episode's meta goes straight onto THIS file by id
                if let Some(chosen) = eps.iter().find(|e| e.episode == episode) {
                    let _ = db::update_episode_meta_by_id(
                        &conn, episode_id, chosen.title.as_deref(), chosen.overview.as_deref(),
                        chosen.still_path.as_deref(), chosen.air_date.as_deref(), chosen.runtime,
                    );
                }
                // 2) siblings that already carry the right numbers get theirs too
                for e in eps {
                    let _ = db::update_episode_meta(
                        &conn, show_id, season, e.episode, e.title.as_deref(), e.overview.as_deref(),
                        e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
                    );
                }
            }
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TmdbEpisodeInfo {
    pub episode: i64,
    pub title: Option<String>,
    pub overview: Option<String>,
    pub still_path: Option<String>,
    pub air_date: Option<String>,
}

/// Episode list of a TMDb season — for picking the REAL episode (name + still)
/// when identifying a file manually.
#[tauri::command]
pub async fn tmdb_season_list(state: State<'_, AppState>, tmdb_id: i64, season: i64) -> R<Vec<TmdbEpisodeInfo>> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    let eps = tmdb.season_episodes(tmdb_id, season).await.map_err(err)?;
    Ok(eps
        .into_iter()
        .map(|e| TmdbEpisodeInfo {
            episode: e.episode,
            title: e.title,
            overview: e.overview,
            still_path: e.still_path,
            air_date: e.air_date,
        })
        .collect())
}

/// Season numbers TMDb knows for a show (so the identify dialog offers only the
/// real seasons instead of a blind number field).
#[tauri::command]
pub async fn tmdb_season_numbers(state: State<'_, AppState>, tmdb_id: i64) -> R<Vec<i64>> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    tmdb.season_numbers(tmdb_id).await.map_err(err)
}

/// Move a WHOLE season of one show onto another TMDb show (existing or created).
/// This is the Plex/Jellyfin-style "this season belongs to a different series"
/// fix. It (1) records a per-FILE placement override so the move survives every
/// rescan and "Bibliothek neu aufbauen", (2) moves the episodes now, and (3)
/// pulls the target show's real metadata. Returns the surviving target show id.
#[tauri::command]
pub async fn reassign_season(
    app: AppHandle,
    state: State<'_, AppState>,
    show_id: i64,
    season: i64,
    target_tmdb: i64,
) -> R<i64> {
    // fetch target show metadata (title etc.) up front
    let (key, lang) = read_key_lang(&state);
    let title = {
        if key.trim().is_empty() {
            format!("TMDb {target_tmdb}")
        } else {
            let tmdb = Tmdb::new(state.http.clone(), key.clone(), lang.clone());
            tmdb.tv_details(target_tmdb).await.map(|m| m.title).unwrap_or_else(|_| format!("TMDb {target_tmdb}"))
        }
    };
    let target_show = {
        let conn = state.conn.lock().unwrap();
        // remember every file's placement FIRST (survives rebuilds)
        for (path, ep) in db::season_file_coords(&conn, show_id, season).map_err(err)? {
            db::set_placement(&conn, &path, target_tmdb, season, ep).map_err(err)?;
        }
        let target = db::find_or_create_show_for_tmdb(&conn, target_tmdb, &title).map_err(err)?;
        db::move_season(&conn, show_id, season, target).map_err(err)?;
        target
    };
    // pull real metadata WITHOUT holding the db lock across network calls
    if !key.trim().is_empty() {
        let tmdb = Tmdb::new(state.http.clone(), key, lang);
        write_show_metadata(&state, &tmdb, target_show, target_tmdb).await;
        let conn = state.conn.lock().unwrap();
        let _ = db::merge_shows_by_tmdb(&conn);
    }
    let surviving = {
        let conn = state.conn.lock().unwrap();
        db::find_show_by_tmdb(&conn, target_tmdb).map_err(err)?.unwrap_or(target_show)
    };
    let _ = app.emit("library://updated", ());
    Ok(surviving)
}

/// Fetch a show's TMDb details + all present seasons' episodes and write them,
/// never holding the DB lock across a network await.
async fn write_show_metadata(state: &State<'_, AppState>, tmdb: &Tmdb, show_id: i64, tmdb_id: i64) {
    let meta = match tmdb.tv_details(tmdb_id).await {
        Ok(m) => m,
        Err(_) => return,
    };
    let seasons: Vec<i64> = {
        let conn = state.conn.lock().unwrap();
        db::distinct_seasons(&conn, show_id).unwrap_or_default()
    };
    let mut fetched: Vec<(i64, Vec<crate::tmdb::EpisodeMeta>)> = Vec::new();
    for s in seasons {
        if let Ok(eps) = tmdb.season_episodes(tmdb_id, s).await {
            fetched.push((s, eps));
        }
    }
    let conn = state.conn.lock().unwrap();
    let genres = serde_json::to_string(&meta.genres).ok();
    let _ = db::update_show_match(
        &conn, show_id, meta.tmdb_id, &meta.title, meta.year, meta.overview.as_deref(),
        meta.poster_path.as_deref(), meta.backdrop_path.as_deref(), genres.as_deref(), meta.rating,
        true, meta.cert.as_deref(), meta.status.as_deref(), meta.last_year, meta.runtime,
    );
    for (s, eps) in fetched {
        for e in eps {
            let _ = db::update_episode_meta(
                &conn, show_id, s, e.episode, e.title.as_deref(), e.overview.as_deref(),
                e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
            );
        }
    }
}

/// Move a single episode onto another TMDb show as SxxEyy. Same persistence as
/// reassign_season (per-file placement).
#[tauri::command]
pub async fn reassign_episode(
    app: AppHandle,
    state: State<'_, AppState>,
    episode_id: i64,
    target_tmdb: i64,
    season: i64,
    episode: i64,
) -> R<i64> {
    let (key, lang) = read_key_lang(&state);
    let title = {
        if key.trim().is_empty() {
            format!("TMDb {target_tmdb}")
        } else {
            let tmdb = Tmdb::new(state.http.clone(), key.clone(), lang.clone());
            tmdb.tv_details(target_tmdb).await.map(|m| m.title).unwrap_or_else(|_| format!("TMDb {target_tmdb}"))
        }
    };
    let target_show = {
        let conn = state.conn.lock().unwrap();
        for path in db::file_paths_of_episode(&conn, episode_id).map_err(err)? {
            db::set_placement(&conn, &path, target_tmdb, season, episode).map_err(err)?;
        }
        let target = db::find_or_create_show_for_tmdb(&conn, target_tmdb, &title).map_err(err)?;
        db::move_episode(&conn, episode_id, target, season, episode).map_err(err)?;
        target
    };
    if !key.trim().is_empty() {
        let tmdb = Tmdb::new(state.http.clone(), key, lang);
        write_show_metadata(&state, &tmdb, target_show, target_tmdb).await;
    }
    let surviving = {
        let conn = state.conn.lock().unwrap();
        db::find_show_by_tmdb(&conn, target_tmdb).map_err(err)?.unwrap_or(target_show)
    };
    let _ = app.emit("library://updated", ());
    Ok(surviving)
}

/// "Diese Datei ist S{season}E{episode} — und alles danach fortlaufend":
/// re-numbers the anchor file and every following file (natural path order)
/// sequentially, rolling into the next season based on TMDb episode counts,
/// then refreshes metadata so every episode gets its real title + image.
/// Returns how many episodes were assigned.
#[tauri::command]
pub async fn assign_episodes_sequential(
    app: AppHandle,
    state: State<'_, AppState>,
    episode_id: i64,
    season: i64,
    episode: i64,
) -> R<i64> {
    // collect the affected rows (anchor + all later files, sorted by path)
    let (show_id, tmdb_id, affected): (i64, Option<i64>, Vec<i64>) = {
        let conn = state.conn.lock().unwrap();
        let (show_id, tmdb_id): (i64, Option<i64>) = conn
            .query_row(
                "SELECT e.show_id, s.tmdb_id FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=?1",
                [episode_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(err)?;
        let mut rows: Vec<(i64, String)> = {
            let mut stmt = conn
                .prepare("SELECT id, path FROM episodes WHERE show_id=?1")
                .map_err(err)?;
            let r = stmt
                .query_map([show_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))
                .map_err(err)?
                .collect::<rusqlite::Result<Vec<_>>>()
                .map_err(err)?;
            r
        };
        rows.sort_by(|a, b| a.1.to_lowercase().cmp(&b.1.to_lowercase()));
        let anchor = rows.iter().position(|(id, _)| *id == episode_id).ok_or("Folge nicht gefunden")?;
        (show_id, tmdb_id, rows[anchor..].iter().map(|(id, _)| *id).collect())
    };

    // season lengths from TMDb (for rolling over into the next season)
    let (key, lang) = read_key_lang(&state);
    let tmdb = if key.trim().is_empty() { None } else { Some(Tmdb::new(state.http.clone(), key, lang)) };
    let mut season_len: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    if let (Some(t), Some(tid)) = (&tmdb, tmdb_id) {
        let mut s = season;
        // fetch up to 20 seasons ahead — plenty, and keeps API usage bounded
        for _ in 0..20 {
            match t.season_episodes(tid, s).await {
                Ok(eps) if !eps.is_empty() => {
                    season_len.insert(s, eps.len() as i64);
                    s += 1;
                }
                _ => break,
            }
        }
    }

    // compute the target numbering
    let mut targets: Vec<(i64, i64, i64)> = Vec::with_capacity(affected.len()); // (id, season, episode)
    let (mut cs, mut ce) = (season, episode);
    for id in &affected {
        targets.push((*id, cs, ce));
        ce += 1;
        if let Some(len) = season_len.get(&cs) {
            if ce > *len && season_len.contains_key(&(cs + 1)) {
                cs += 1;
                ce = 1;
            }
        }
    }

    // apply in two phases to dodge the UNIQUE(show,season,episode) constraint
    let seasons_touched: Vec<i64> = {
        let conn = state.conn.lock().unwrap();
        // phase 1: park affected rows on unique temp numbers
        for (id, _, _) in &targets {
            conn.execute("UPDATE episodes SET episode = -id WHERE id=?1", [id]).map_err(err)?;
        }
        // phase 2: final numbers; a non-affected row already holding a target
        // number gets parked too (it was mis-numbered — visible for review)
        for (id, s, e) in &targets {
            let _ = conn.execute(
                "UPDATE episodes SET episode = -id WHERE show_id=?1 AND season=?2 AND episode=?3 AND id<>?4",
                params![show_id, s, e, id],
            );
            conn.execute("UPDATE episodes SET season=?2, episode=?3 WHERE id=?1", params![id, s, e])
                .map_err(err)?;
        }
        let mut set: Vec<i64> = targets.iter().map(|(_, s, _)| *s).collect();
        set.dedup();
        set
    };

    // pull real titles/images for every touched season
    if let (Some(t), Some(tid)) = (&tmdb, tmdb_id) {
        for s in seasons_touched {
            if let Ok(eps) = t.season_episodes(tid, s).await {
                let conn = state.conn.lock().unwrap();
                for e in eps {
                    let _ = db::update_episode_meta(
                        &conn, show_id, s, e.episode, e.title.as_deref(), e.overview.as_deref(),
                        e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
                    );
                }
            }
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(targets.len() as i64)
}

/// Fix a season whose files carry WRONG SxxEyy numbers but the REAL episode
/// title in the filename (e.g. "… S06E01 - Climatiqueen.mp4" where Climatiqueen
/// is actually episode 6). Matches each file's trailing title text against the
/// TMDb episode names, renumbers confident unique matches, records per-file
/// placements (survive rescans + rebuilds) and reloads metadata.
/// Returns (matched, total) counts.
#[tauri::command]
pub async fn repair_season_titles(
    app: AppHandle,
    state: State<'_, AppState>,
    show_id: i64,
    season: i64,
) -> R<(i64, i64)> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb_id: i64 = {
        let conn = state.conn.lock().unwrap();
        conn.query_row("SELECT tmdb_id FROM shows WHERE id=?1", [show_id], |r| r.get::<_, Option<i64>>(0))
            .map_err(err)?
            .ok_or("Serie ist nicht mit TMDb verknüpft – zuerst identifizieren")?
    };
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    let names: Vec<(i64, String)> = tmdb
        .season_episodes(tmdb_id, season)
        .await
        .map_err(err)?
        .into_iter()
        .filter_map(|e| e.title.map(|t| (e.episode, t)))
        .collect();
    if names.is_empty() {
        return Err("TMDb kennt keine Folgen für diese Staffel".into());
    }

    fn norm(s: &str) -> String {
        crate::parser::letters_only(s).to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ")
    }
    /// trailing title text of a filename stem: everything after the SxxEyy tag
    fn candidate_of(stem: &str) -> Option<String> {
        let re = regex::Regex::new(r"(?i)s\d{1,2}\s*[-. _]*e\d{1,3}[-. _]*").ok()?;
        let m = re.find(stem)?;
        let rest = &stem[m.end()..];
        let c = norm(rest);
        if c.len() < 3 { None } else { Some(c) }
    }

    // collect this season's episodes (id, primary path)
    let eps: Vec<(i64, String, i64)> = {
        let conn = state.conn.lock().unwrap();
        let mut stmt = conn
            .prepare("SELECT id, path, episode FROM episodes WHERE show_id=?1 AND season=?2")
            .map_err(err)?;
        let rows = stmt
            .query_map(params![show_id, season], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
            .map_err(err)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(err)?;
        rows
    };
    let total = eps.len() as i64;

    // match candidates against real titles: exact, candidate-prefix-of-title
    // (≥4 chars), or title-prefix-of-candidate (release junk after the title)
    let normed: Vec<(i64, String)> = names.iter().map(|(n, t)| (*n, norm(t))).collect();
    let mut assign: Vec<(i64, i64)> = Vec::new(); // (episode_row_id, real_number)
    let mut claimed: std::collections::HashSet<i64> = std::collections::HashSet::new();
    for (eid, path, _) in &eps {
        let stem = std::path::Path::new(path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let Some(cand) = candidate_of(&stem) else { continue };
        let mut hits: Vec<i64> = Vec::new();
        for (num, t) in &normed {
            let hit = cand == *t
                || (cand.len() >= 4 && t.starts_with(&cand))
                || (t.len() >= 4 && cand.starts_with(t.as_str()));
            if hit {
                hits.push(*num);
            }
        }
        hits.dedup();
        if hits.len() == 1 && !claimed.contains(&hits[0]) {
            claimed.insert(hits[0]);
            assign.push((*eid, hits[0]));
        }
    }
    let matched = assign.len() as i64;

    if matched > 0 {
        let conn = state.conn.lock().unwrap();
        // two-phase renumber to dodge UNIQUE(show,season,episode)
        for (eid, _) in &eps.iter().map(|(e, _, _)| (*e, ())).collect::<Vec<_>>() {
            conn.execute("UPDATE episodes SET episode = -id WHERE id=?1", [eid]).map_err(err)?;
        }
        for (eid, real) in &assign {
            conn.execute("UPDATE episodes SET episode=?2 WHERE id=?1", params![eid, real]).map_err(err)?;
            // remember it per file so every rescan/rebuild re-applies the fix
            for p in db::file_paths_of_episode(&conn, *eid).map_err(err)? {
                let _ = db::set_placement(&conn, &p, tmdb_id, season, *real);
            }
        }
        // unmatched files: keep their old number when free, else next free slot.
        // Pin them with a placement too — otherwise the NEXT scan/rebuild re-derives
        // the raw SxxEyy tag from the filename and silently re-collides them with
        // whatever matched file already claimed that slot (the bug that let already
        // "fixed" seasons quietly break again on every rescan).
        for (eid, _, old_num) in &eps {
            if assign.iter().any(|(a, _)| a == eid) {
                continue;
            }
            let mut n = (*old_num).max(1);
            loop {
                let taken: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM episodes WHERE show_id=?1 AND season=?2 AND episode=?3 AND id<>?4",
                        params![show_id, season, n, eid],
                        |r| r.get(0),
                    )
                    .map_err(err)?;
                if taken == 0 {
                    break;
                }
                n += 1;
            }
            conn.execute("UPDATE episodes SET episode=?2 WHERE id=?1", params![eid, n]).map_err(err)?;
            for p in db::file_paths_of_episode(&conn, *eid).map_err(err)? {
                let _ = db::set_placement(&conn, &p, tmdb_id, season, n);
            }
        }
        let _ = db::set_all_episode_primaries(&conn);
    }

    // reload the real titles/images for the season
    if let Ok(fetched) = tmdb.season_episodes(tmdb_id, season).await {
        let conn = state.conn.lock().unwrap();
        for e in fetched {
            let _ = db::update_episode_meta(
                &conn, show_id, season, e.episode, e.title.as_deref(), e.overview.as_deref(),
                e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
            );
        }
    }
    let _ = app.emit("library://updated", ());
    Ok((matched, total))
}

/// Basic file facts for the "Dateiinfo" dialog.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub size_bytes: u64,
    pub modified_secs: Option<i64>,
    pub exists: bool,
}

#[tauri::command]
pub fn file_info(path: String) -> FileInfo {
    match std::fs::metadata(&path) {
        Ok(m) => FileInfo {
            size_bytes: m.len(),
            modified_secs: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64),
            exists: true,
        },
        Err(_) => FileInfo { size_bytes: 0, modified_secs: None, exists: false },
    }
}

/// Fully-watched items, newest first.
#[tauri::command]
pub fn recently_watched(state: State<AppState>, profile_id: String, limit: Option<i64>) -> R<Vec<ContinueItem>> {
    let conn = state.conn.lock().unwrap();
    db::recently_watched(&conn, &profile_id, limit.unwrap_or(20)).map_err(err)
}

// ===== progress =====

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn set_progress(
    state: State<AppState>,
    profile_id: String,
    media_type: String,
    ref_id: i64,
    position_sec: f64,
    duration_sec: f64,
    watched: bool,
) -> R<()> {
    let conn = state.conn.lock().unwrap();
    // enrich with TMDb coordinates so progress can sync across machines
    let (tmdb_id, season, episode) = if media_type == "movie" {
        (db::movie_tmdb(&conn, ref_id).map_err(err)?, None, None)
    } else {
        match db::episode_sync_coords(&conn, ref_id).map_err(err)? {
            Some((s, e, show_tmdb)) => (show_tmdb, Some(s), Some(e)),
            None => (None, None, None),
        }
    };
    let p = Progress {
        profile_id,
        media_type,
        ref_id,
        tmdb_id,
        season,
        episode,
        position_sec,
        duration_sec,
        watched,
        updated_at: db::now(),
    };
    db::upsert_progress(&conn, &p).map_err(err)
}

#[tauri::command]
pub fn get_progress(state: State<AppState>, profile_id: String, media_type: String, ref_id: i64) -> R<Option<Progress>> {
    let conn = state.conn.lock().unwrap();
    db::get_progress(&conn, &profile_id, &media_type, ref_id).map_err(err)
}

#[tauri::command]
pub fn list_progress(state: State<AppState>, profile_id: String) -> R<Vec<Progress>> {
    let conn = state.conn.lock().unwrap();
    db::list_progress(&conn, &profile_id).map_err(err)
}

#[tauri::command]
pub fn continue_watching(state: State<AppState>, profile_id: String) -> R<Vec<ContinueItem>> {
    let conn = state.conn.lock().unwrap();
    db::continue_watching(&conn, &profile_id).map_err(err)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteProgress {
    pub media_type: String,
    pub tmdb_id: i64,
    pub season: Option<i64>,
    pub episode: Option<i64>,
    pub position_sec: f64,
    pub duration_sec: f64,
    pub watched: bool,
    pub updated_at: i64,
}

// ===== favorites =====

#[tauri::command]
pub fn toggle_favorite(state: State<AppState>, profile_id: String, media_type: String, ref_id: i64) -> R<bool> {
    let conn = state.conn.lock().unwrap();
    if db::is_favorite(&conn, &profile_id, &media_type, ref_id).map_err(err)? {
        db::remove_favorite(&conn, &profile_id, &media_type, ref_id).map_err(err)?;
        Ok(false)
    } else {
        db::add_favorite(&conn, &profile_id, &media_type, ref_id).map_err(err)?;
        Ok(true)
    }
}

#[tauri::command]
pub fn list_favorites(state: State<AppState>, profile_id: String) -> R<Vec<Favorite>> {
    let conn = state.conn.lock().unwrap();
    db::list_favorites(&conn, &profile_id).map_err(err)
}

// ===== watched =====

#[tauri::command]
pub fn set_watched(app: AppHandle, state: State<AppState>, profile_id: String, media_type: String, ref_id: i64, watched: bool) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        db::set_watched(&conn, &profile_id, &media_type, ref_id, watched).map_err(err)?;
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

#[tauri::command]
pub fn set_show_watched(app: AppHandle, state: State<AppState>, profile_id: String, show_id: i64, watched: bool) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        for id in db::episode_ids_for_show(&conn, show_id, None).map_err(err)? {
            db::set_watched(&conn, &profile_id, "episode", id, watched).map_err(err)?;
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

#[tauri::command]
pub fn set_season_watched(app: AppHandle, state: State<AppState>, profile_id: String, show_id: i64, season: i64, watched: bool) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        for id in db::episode_ids_for_show(&conn, show_id, Some(season)).map_err(err)? {
            db::set_watched(&conn, &profile_id, "episode", id, watched).map_err(err)?;
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

// ===== stats =====

#[tauri::command]
pub fn get_stats(state: State<AppState>, profile_id: String) -> R<Stats> {
    let conn = state.conn.lock().unwrap();
    db::stats(&conn, &profile_id).map_err(err)
}

// ===== TMDb extras (trailer + cast) =====

#[tauri::command]
pub async fn tmdb_extras(state: State<'_, AppState>, media_type: String, tmdb_id: i64) -> R<Extras> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    tmdb.extras(&media_type, tmdb_id).await.map_err(err)
}

// ===== artwork (Plex-style) + quality =====

/// List available artwork for an item from TMDb.
/// `media_type` = "movie" | "tv" | "season" | "episode".
#[tauri::command]
pub async fn tmdb_images(
    state: State<'_, AppState>,
    media_type: String,
    tmdb_id: i64,
    season: Option<i64>,
    episode: Option<i64>,
) -> R<Vec<TmdbImage>> {
    let (key, lang) = read_key_lang(&state);
    if key.trim().is_empty() {
        return Err("Kein TMDb-Key gesetzt".into());
    }
    let tmdb = Tmdb::new(state.http.clone(), key, lang);
    tmdb.images(&media_type, tmdb_id, season, episode).await.map_err(err)
}

/// Apply a chosen artwork and lock it so refreshes don't overwrite it.
/// `target` = "movie" | "show" | "episode" | "season".
/// `field` = "poster" | "backdrop" (movie/show only). `season` for the season variant.
#[tauri::command]
pub fn set_artwork(
    app: AppHandle,
    state: State<AppState>,
    target: String,
    id: i64,
    season: Option<i64>,
    field: Option<String>,
    path: String,
) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        let field = field.as_deref().unwrap_or("poster");
        match target.as_str() {
            "movie" => db::set_movie_art(&conn, id, field, &path).map_err(err)?,
            "show" => db::set_show_art(&conn, id, field, &path).map_err(err)?,
            "episode" => db::set_episode_art(&conn, id, &path).map_err(err)?,
            "season" => db::set_season_art(&conn, id, season.unwrap_or(1), &path).map_err(err)?,
            _ => return Err("Unbekanntes Ziel".into()),
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Custom season posters for a show: array of [season, posterPath].
#[tauri::command]
pub fn get_season_art(state: State<AppState>, show_id: i64) -> R<Vec<(i64, String)>> {
    let conn = state.conn.lock().unwrap();
    db::season_art(&conn, show_id).map_err(err)
}

fn thumbs_dir(state: &AppState) -> Option<std::path::PathBuf> {
    let dir = state.db_path.parent()?.join("thumbs");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn thumb_cache_file(state: &AppState, path: &str, time_sec: f64) -> Option<std::path::PathBuf> {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut h);
    let sec = time_sec.max(0.0).round() as u64;
    Some(thumbs_dir(state)?.join(format!("{:016x}_{sec}.jpg", h.finish())))
}

/// Extract a single preview frame at `time_sec` as a base64 JPEG data URL.
/// Frames are cached on disk, so re-hovering a spot is instant — and the ffmpeg
/// path is validated (and self-healed) on every call, so previews can't silently
/// die when a package manager moves ffmpeg.
#[tauri::command]
pub async fn media_thumbnail(state: State<'_, AppState>, path: String, time_sec: f64) -> R<String> {
    use base64::Engine;
    let cache = thumb_cache_file(&state, &path, time_sec);
    if let Some(ref c) = cache {
        if let Ok(bytes) = std::fs::read(c) {
            if !bytes.is_empty() {
                let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                return Ok(format!("data:image/jpeg;base64,{b64}"));
            }
        }
    }
    let ffmpeg = {
        let conn = state.conn.lock().unwrap();
        crate::paths::working_ffmpeg(&conn)
            .ok_or("ffmpeg nicht gefunden – bitte installieren oder Pfad in Einstellungen → Werkzeuge setzen")?
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || crate::probe::thumbnail(&ffmpeg, &path, time_sec))
        .await
        .map_err(err)?
        .map_err(err)?;
    if let Some(c) = cache {
        let _ = std::fs::write(c, &bytes);
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// Current size of the on-disk preview cache in bytes.
#[tauri::command]
pub fn thumb_cache_size(state: State<AppState>) -> u64 {
    let Some(dir) = thumbs_dir(&state) else { return 0 };
    std::fs::read_dir(dir)
        .map(|rd| rd.flatten().filter_map(|e| e.metadata().ok()).map(|m| m.len()).sum())
        .unwrap_or(0)
}

/// Delete all cached preview frames. Returns the freed bytes.
#[tauri::command]
pub fn clear_thumb_cache(state: State<AppState>) -> R<u64> {
    let size = thumb_cache_size(state.clone());
    if let Some(dir) = thumbs_dir(&state) {
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::create_dir_all(&dir);
    }
    Ok(size)
}

/// Live status (found? version?) of mpv / ffmpeg / ffprobe, self-healing first.
#[tauri::command]
pub fn check_tools(state: State<AppState>) -> crate::paths::ToolsReport {
    let conn = state.conn.lock().unwrap();
    crate::paths::tools_report(&conn)
}

/// Persist the REAL resolution reported by mpv during playback. This lets the
/// quality badge self-heal even when ffprobe is unavailable.
#[tauri::command]
pub fn set_media_dims(
    app: AppHandle,
    state: State<AppState>,
    media_type: String,
    id: i64,
    path: String,
    width: i64,
    height: i64,
) -> R<()> {
    if width <= 0 || height <= 0 {
        return Ok(());
    }
    {
        let conn = state.conn.lock().unwrap();
        if media_type == "movie" {
            conn.execute(
                "UPDATE movies SET width=?2, height=?3 WHERE id=?1 AND (width IS NULL OR width<=0)",
                rusqlite::params![id, width, height],
            )
            .map_err(err)?;
        } else {
            conn.execute(
                "UPDATE episode_files SET width=?2, height=?3 WHERE path=?1 AND (width IS NULL OR width<=0)",
                rusqlite::params![path, width, height],
            )
            .map_err(err)?;
            let _ = db::set_all_episode_primaries(&conn);
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Manually set (or clear) an episode's intro window from the player.
#[tauri::command]
pub fn set_episode_intro(app: AppHandle, state: State<AppState>, episode_id: i64, start: f64, end: f64) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        db::update_episode_intro(&conn, episode_id, start, end).map_err(err)?;
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Manually set (or clear with None) the default intro window of a whole show.
#[tauri::command]
pub fn set_show_intro(app: AppHandle, state: State<AppState>, show_id: i64, start: Option<f64>, end: Option<f64>) -> R<()> {
    {
        let conn = state.conn.lock().unwrap();
        db::set_show_intro(&conn, show_id, start, end).map_err(err)?;
    }
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Search episode titles for the library search page.
#[tauri::command]
pub fn search_episodes(state: State<AppState>, query: String) -> R<Vec<Episode>> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let conn = state.conn.lock().unwrap();
    db::search_episodes(&conn, q, 40).map_err(err)
}

/// Compact + optimize the SQLite database.
#[tauri::command]
pub fn db_optimize(state: State<AppState>) -> R<()> {
    let conn = state.conn.lock().unwrap();
    conn.execute_batch("PRAGMA optimize; VACUUM;").map_err(err)?;
    Ok(())
}

#[derive(serde::Serialize, serde::Deserialize)]
struct ExportBundle {
    progress: Vec<Progress>,
    favorites: Vec<ExportFavorite>,
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportFavorite {
    profile_id: String,
    media_type: String,
    tmdb_id: Option<i64>,
    added_at: i64,
}

/// Shared export logic (manual export + weekly auto-backup).
pub fn write_export(conn: &rusqlite::Connection, path: &str) -> Result<i64, String> {
    let mut progress: Vec<Progress> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT profile_id, media_type, ref_id, tmdb_id, season, episode, position_sec, duration_sec, watched, updated_at FROM progress")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(Progress {
                    profile_id: r.get(0)?,
                    media_type: r.get(1)?,
                    ref_id: r.get(2)?,
                    tmdb_id: r.get(3)?,
                    season: r.get(4)?,
                    episode: r.get(5)?,
                    position_sec: r.get(6)?,
                    duration_sec: r.get(7)?,
                    watched: r.get::<_, i64>(8)? != 0,
                    updated_at: r.get(9)?,
                })
            })
            .map_err(err)?;
        for row in rows {
            progress.push(row.map_err(err)?);
        }
    }
    let mut favorites: Vec<ExportFavorite> = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT profile_id, media_type, tmdb_id, added_at FROM favorites")
            .map_err(err)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(ExportFavorite {
                    profile_id: r.get(0)?,
                    media_type: r.get(1)?,
                    tmdb_id: r.get(2)?,
                    added_at: r.get(3)?,
                })
            })
            .map_err(err)?;
        for row in rows {
            favorites.push(row.map_err(err)?);
        }
    }
    let n = (progress.len() + favorites.len()) as i64;
    let json = serde_json::to_string_pretty(&ExportBundle { progress, favorites }).map_err(err)?;
    std::fs::write(path, json).map_err(err)?;
    Ok(n)
}

/// Export watch progress + favorites (TMDb-keyed, portable) as JSON.
#[tauri::command]
pub fn export_data(state: State<AppState>, path: String) -> R<i64> {
    let conn = state.conn.lock().unwrap();
    write_export(&conn, &path)
}

/// Import a JSON export: progress merges last-write-wins via TMDb coordinates,
/// favorites are added when the item exists locally. Returns applied row count.
#[tauri::command]
pub fn import_data(app: AppHandle, state: State<AppState>, path: String) -> R<i64> {
    let text = std::fs::read_to_string(&path).map_err(err)?;
    let bundle: ExportBundle = serde_json::from_str(&text).map_err(err)?;
    let conn = state.conn.lock().unwrap();
    let mut applied = 0i64;
    for p in bundle.progress {
        let ref_id = if p.media_type == "movie" {
            p.tmdb_id.and_then(|t| db::find_movie_by_tmdb(&conn, t).ok().flatten())
        } else {
            match (p.tmdb_id, p.season, p.episode) {
                (Some(t), Some(s), Some(e)) => db::find_episode_by_show_tmdb(&conn, t, s, e).ok().flatten(),
                _ => None,
            }
        };
        let Some(ref_id) = ref_id else { continue };
        let existing = db::get_progress(&conn, &p.profile_id, &p.media_type, ref_id).ok().flatten();
        if existing.map(|ex| p.updated_at > ex.updated_at).unwrap_or(true) {
            let mut np = p;
            np.ref_id = ref_id;
            if db::upsert_progress(&conn, &np).is_ok() {
                applied += 1;
            }
        }
    }
    for f in bundle.favorites {
        let ref_id = match (f.media_type.as_str(), f.tmdb_id) {
            ("movie", Some(t)) => db::find_movie_by_tmdb(&conn, t).ok().flatten(),
            ("show", Some(t)) => db::find_show_by_tmdb(&conn, t).ok().flatten(),
            _ => None,
        };
        if let Some(id) = ref_id {
            if db::add_favorite(&conn, &f.profile_id, &f.media_type, id).is_ok() {
                applied += 1;
            }
        }
    }
    let _ = app.emit("library://updated", ());
    Ok(applied)
}

/// Re-read the real resolution of every file (Settings → "Qualität neu erkennen").
#[tauri::command]
pub fn probe_qualities(app: AppHandle, state: State<AppState>, force: bool) -> R<()> {
    if state.scanning.swap(true, Ordering::SeqCst) {
        return Err("Es läuft bereits ein Vorgang".into());
    }
    if force {
        let conn = state.conn.lock().unwrap();
        let _ = conn.execute("UPDATE movies SET width=NULL, height=NULL", []);
        let _ = conn.execute("UPDATE episodes SET width=NULL, height=NULL", []);
        // each physical episode file carries its own resolution — reset those too,
        // otherwise "Qualität neu erkennen" silently skipped every episode
        let _ = conn.execute("UPDATE episode_files SET width=NULL, height=NULL", []);
    }
    let db_path = state.db_path.clone();
    std::thread::spawn(move || {
        if let Err(e) = crate::probe::run_probe_all(db_path, app.clone()) {
            let _ = app.emit(
                "scan://progress",
                scanner::ScanProgress { stage: "error".into(), message: format!("Fehler: {e}"), current: 0, total: 0 },
            );
        }
        app.state::<AppState>().scanning.store(false, Ordering::SeqCst);
    });
    Ok(())
}

/// Apply progress pulled from Supabase, mapping TMDb coordinates back to local items.
/// Last-write-wins by `updated_at`.
#[tauri::command]
pub fn apply_remote_progress(state: State<AppState>, profile_id: String, rows: Vec<RemoteProgress>) -> R<()> {
    let conn = state.conn.lock().unwrap();
    for r in rows {
        let ref_id = if r.media_type == "movie" {
            db::find_movie_by_tmdb(&conn, r.tmdb_id).map_err(err)?
        } else {
            match (r.season, r.episode) {
                (Some(s), Some(e)) => db::find_episode_by_show_tmdb(&conn, r.tmdb_id, s, e).map_err(err)?,
                _ => None,
            }
        };
        let ref_id = match ref_id {
            Some(id) => id,
            None => continue, // item not present on this machine
        };
        let existing = db::get_progress(&conn, &profile_id, &r.media_type, ref_id).map_err(err)?;
        let newer = existing.map(|ex| r.updated_at > ex.updated_at).unwrap_or(true);
        if newer {
            let p = Progress {
                profile_id: profile_id.clone(),
                media_type: r.media_type,
                ref_id,
                tmdb_id: Some(r.tmdb_id),
                season: r.season,
                episode: r.episode,
                position_sec: r.position_sec,
                duration_sec: r.duration_sec,
                watched: r.watched,
                updated_at: r.updated_at,
            };
            db::upsert_progress(&conn, &p).map_err(err)?;
        }
    }
    Ok(())
}

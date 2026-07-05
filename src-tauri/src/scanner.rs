use crate::{db, parser, probe, tmdb::Tmdb};
use anyhow::Result;
use regex::Regex;
use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Emitter};
use walkdir::WalkDir;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub stage: String,
    pub message: String,
    pub current: i64,
    pub total: i64,
}

fn emit(app: &AppHandle, stage: &str, message: String, current: i64, total: i64) {
    let _ = app.emit(
        "scan://progress",
        ScanProgress { stage: stage.into(), message, current, total },
    );
}

fn file_stem(name: &str) -> String {
    match name.rsplit_once('.') {
        Some((s, _)) => s.to_string(),
        None => name.to_string(),
    }
}

/// Scene releases ship tiny "sample"/"trailer" clips next to the real file —
/// indexing them creates phantom duplicate entries, so we skip them.
fn is_junk_clip(stem: &str) -> bool {
    stem.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|t| t == "sample" || t == "trailer")
}

/// Full scan: index files, prune deleted, then match metadata. Runs on a worker thread.
pub fn run_scan(db_path: PathBuf, http: reqwest::Client, app: AppHandle) -> Result<()> {
    let conn = db::open(&db_path)?;
    emit(&app, "start", "Scan gestartet …".into(), 0, 0);

    let libs = db::list_libraries(&conn)?;
    // Make sure shows indexed before stable keys existed get one before we scan,
    // so identified/renamed shows are re-found by key, not duplicated.
    backfill_show_keys(&conn, &libs)?;
    for lib in &libs {
        let p = Path::new(&lib.path);
        if !p.exists() {
            continue;
        }
        emit(&app, "index", format!("Durchsuche {}", lib.path), 0, 0);
        if lib.kind == "movie" {
            scan_movies(&conn, p)?;
        } else {
            scan_tv(&conn, p)?;
        }
    }

    prune_missing(&conn)?;
    emit(&app, "index", "Dateien indexiert".into(), 0, 0);
    let _ = app.emit("library://updated", ());

    let key = db::get_setting(&conn, "tmdb_key")?.unwrap_or_default();
    if key.trim().is_empty() {
        emit(&app, "warn", "Kein TMDb-Key – Metadaten übersprungen".into(), 0, 0);
    } else {
        let lang = db::get_setting(&conn, "tmdb_lang")?.unwrap_or_else(|| "de-DE".into());
        let tmdb = Tmdb::new(http, key, lang);
        // When auto-match is off the user only wants manual identification — we
        // still refresh already-matched items, just don't auto-search new ones.
        let auto_match = db::get_setting(&conn, "auto_match")?.map(|v| v != "off").unwrap_or(true);
        tauri::async_runtime::block_on(match_all(&conn, &tmdb, &app, auto_match))?;
    }

    // Read the real resolution of any newly-added files for accurate quality labels.
    let _ = probe::run_probe_pass(&conn, &app, false);

    // Re-link watched-progress + favorites to the fresh rows (via TMDb ids) so the
    // "Gesehen"-Stand survives even a full "Bibliothek neu aufbauen".
    let _ = db::remap_stale_refs(&conn);

    emit(&app, "done", "Fertig".into(), 0, 0);
    let _ = app.emit("library://updated", ());
    Ok(())
}

fn scan_movies(conn: &Connection, root: &Path) -> Result<()> {
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !parser::is_video(&name) {
            continue;
        }
        let stem = file_stem(&name);
        if is_junk_clip(&stem) {
            continue;
        }
        let (title, year) = parser::parse_title_year(&stem);
        let path = entry.path().to_string_lossy().to_string();
        db::insert_movie_if_absent(conn, &path, &title, year)?;
    }
    Ok(())
}

/// True if a folder name is PURELY a season marker ("Season 2", "Staffel 02",
/// "S03", "Specials") — i.e. it names a season, not a show. Kept strict so real
/// show folders like "Stranger Things S01-S04" or "Marvel's …" don't match.
fn is_pure_season_dir(name: &str) -> bool {
    let t = name.trim().to_lowercase();
    if t == "specials" || t == "special" || t == "extras" {
        return true;
    }
    static RE: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r"(?i)^(?:season|staffel|saison|s)\s*0*\d{1,3}$").unwrap()
    });
    RE.is_match(&t)
}

/// The folder name a show is grouped by. Normally the first path component under
/// the library root (`root/Show/Season N/file` → "Show"). BUT if that first
/// component is itself just a season folder — which happens when the user adds
/// the SHOW folder directly as a library (`root/Season N/file`) — the show name
/// is the library root's own folder name instead. Without this, every season of
/// such a show became a separate "Season N" group and got mis-matched on TMDb.
fn show_source_name(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    let comps: Vec<_> = rel.components().collect();
    if comps.len() >= 2 {
        let first = comps[0].as_os_str().to_string_lossy().to_string();
        if is_pure_season_dir(&first) {
            // root itself is the show folder → use its name
            if let Some(rn) = root.file_name().map(|s| s.to_string_lossy().to_string()) {
                if !rn.is_empty() {
                    return rn;
                }
            }
        }
        first
    } else {
        // a file sitting directly in the root: if the root looks like a show
        // folder (has a real name), prefer it over the bare file stem
        let name = path.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        file_stem(&name)
    }
}

/// Give every already-indexed show a stable grouping key (idempotent). Run once
/// before a scan so shows created before keys existed — including ones the user
/// already identified — are re-found by key instead of being duplicated.
fn backfill_show_keys(conn: &Connection, libs: &[crate::models::Library]) -> Result<()> {
    let tv_roots: Vec<PathBuf> = libs
        .iter()
        .filter(|l| l.kind != "movie")
        .map(|l| PathBuf::from(&l.path))
        .collect();
    if tv_roots.is_empty() {
        return Ok(());
    }
    for (show_id, path) in db::all_show_file_paths(conn)? {
        let p = Path::new(&path);
        if let Some(root) = tv_roots.iter().find(|r| p.starts_with(r)) {
            let key = parser::show_key(&show_source_name(root, p));
            if !key.is_empty() {
                db::set_show_key_if_absent(conn, &key, show_id)?;
            }
        }
    }
    Ok(())
}

fn scan_tv(conn: &Connection, root: &Path) -> Result<()> {
    for entry in WalkDir::new(root).into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if !parser::is_video(&name) {
            continue;
        }
        let path_buf = entry.path();
        let path = path_buf.to_string_lossy().to_string();

        // Group ALL seasons of a show under one entry by cleaning the season/junk
        // off the folder (or file) name. "Marvel's Daredevil Season 2" and
        // "Marvel's Daredevil Season 3" both collapse to "Marvel's Daredevil".
        let source_name = show_source_name(root, path_buf);
        let key = parser::show_key(&source_name);

        // A per-file placement override ("this file belongs to show TMDb X as
        // SxxEyy", set by the user moving a season/episode) ALWAYS wins and is
        // re-applied on every scan — even for already-indexed files.
        if let Some((show_tmdb, ov_season, ov_episode)) = db::placement_for(conn, &path)? {
            let target_show = db::find_or_create_show_for_tmdb(conn, show_tmdb, &parser::clean_show_title(&source_name))?;
            match db::show_id_of_episode_file(conn, &path)? {
                Some(cur_ep_show) => {
                    // already indexed → move it if it's not already correct
                    if let Some(eid) = db::episode_id_of_file(conn, &path)? {
                        let _ = db::move_episode(conn, eid, target_show, ov_season, ov_episode);
                    }
                    let _ = cur_ep_show;
                }
                None => {
                    let ep_id = db::find_or_create_episode(conn, target_show, ov_season, ov_episode, &path)?;
                    db::add_episode_file(conn, ep_id, &path)?;
                }
            }
            continue;
        }

        // Already indexed? Leave its show/season/episode exactly as they are so
        // manual matches (Identifizieren) and episode renumbering survive the
        // rescan. We only (re)affirm the grouping key of its current show.
        if let Some(sid) = db::show_id_of_episode_file(conn, &path)? {
            if !key.is_empty() {
                db::set_show_key_if_absent(conn, &key, sid)?;
            }
            continue;
        }

        // New file → detect its position and place it.
        let stem = file_stem(&name);
        if is_junk_clip(&stem) {
            continue;
        }
        let parent_dir = path_buf
            .parent()
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let (season, episode) = match parser::parse_episode(&stem, &parent_dir) {
            Some(se) => se,
            None => continue, // undetectable episodes are skipped in v1
        };

        let show_title = parser::clean_show_title(&source_name);
        let (_, show_year) = parser::parse_title_year(&source_name);
        let show_id = if key.is_empty() {
            db::find_or_create_show(conn, None, &show_title, show_year)?
        } else {
            db::find_or_create_show_by_key(conn, &key, &show_title, show_year)?
        };
        let ep_id = db::find_or_create_episode(conn, show_id, season, episode, &path)?;
        db::add_episode_file(conn, ep_id, &path)?;
    }
    Ok(())
}

fn prune_missing(conn: &Connection) -> Result<()> {
    // NEVER prune files that live on a currently unreachable library root (e.g. an
    // unplugged external drive) — otherwise one offline scan would wipe the index.
    let offline_roots: Vec<PathBuf> = db::list_libraries(conn)?
        .into_iter()
        .map(|l| PathBuf::from(l.path))
        .filter(|p| !p.exists())
        .collect();
    let on_offline_root = |p: &str| offline_roots.iter().any(|r| Path::new(p).starts_with(r));

    for p in db::all_movie_paths(conn)? {
        if !Path::new(&p).exists() && !on_offline_root(&p) {
            db::delete_movie_by_path(conn, &p)?;
        }
    }
    // drop files that no longer exist, then episodes/shows that lost all their files
    for p in db::all_episode_file_paths(conn)? {
        if !Path::new(&p).exists() && !on_offline_root(&p) {
            db::delete_episode_file_by_path(conn, &p)?;
        }
    }
    conn.execute(
        "DELETE FROM episodes WHERE id NOT IN (SELECT DISTINCT episode_id FROM episode_files)",
        [],
    )?;
    db::set_all_episode_primaries(conn)?;
    conn.execute(
        "DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)",
        [],
    )?;
    Ok(())
}

/// Search term for TMDb auto-detection: LETTERS ONLY (no digits, no punctuation,
/// no scene junk) — that's what rescues messy release names most reliably. Falls
/// back to the forgiving digit-keeping cleaner (for titles like "9-1-1"), then
/// the raw title, so there's always something to search for.
fn search_query(title: &str) -> String {
    let q = parser::letters_only(title);
    if !q.trim().is_empty() {
        return q;
    }
    let q = parser::clean_search_query(title);
    if q.trim().is_empty() {
        title.to_string()
    } else {
        q
    }
}

/// Search, retrying with the year dropped and with progressively shorter titles —
/// rescues messy names ("Miraculouse - Tales of …" → "Miraculouse Tales …" → "Miraculouse").
async fn search_with_fallback(
    tmdb: &Tmdb,
    query: &str,
    kind: &str,
    year: Option<i64>,
) -> Vec<crate::models::TmdbResult> {
    let words: Vec<&str> = query.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let mut n = words.len();
    while n >= 1 {
        let q = words[..n].join(" ");
        if let Ok(res) = tmdb.search(&q, kind, year).await {
            if !res.is_empty() {
                return res;
            }
        }
        if n == words.len() && year.is_some() {
            if let Ok(res) = tmdb.search(&q, kind, None).await {
                if !res.is_empty() {
                    return res;
                }
            }
        }
        if n == 1 {
            break;
        }
        n -= 1;
    }
    Vec::new()
}

/// A title reduced to lowercase letter-tokens for fuzzy comparison.
fn title_tokens(s: &str) -> Vec<String> {
    parser::letters_only(s)
        .to_lowercase()
        .split_whitespace()
        .map(|t| t.to_string())
        .collect()
}

/// Fraction of the query's tokens that appear in the candidate (0.0–1.0).
fn token_overlap(want: &[String], cand: &[String]) -> f64 {
    if want.is_empty() {
        return 0.0;
    }
    let hit = want.iter().filter(|w| cand.contains(w)).count();
    hit as f64 / want.len() as f64
}

/// Pick the TV result that best matches what we actually have locally.
///
/// TITLE + YEAR come first; the TMDb total-episode count is only a tiebreaker
/// between otherwise near-equal candidates (e.g. the 2005 vs 2024 "Avatar").
///
/// The old version scored purely by |tmdb_total_eps − local_eps|, which broke
/// badly for a folder holding just ONE season of a multi-season show: a 13-file
/// "Daredevil" season would match "Daredevil: Born Again" (≈13 total) instead of
/// the 39-episode original. Episode count is now a weak signal, and a local count
/// that merely FITS inside a bigger show is not penalised.
async fn best_tv_match(tmdb: &Tmdb, query: &str, year: Option<i64>, local_eps: i64) -> Option<i64> {
    let results = search_with_fallback(tmdb, query, "tv", year).await;
    if results.is_empty() {
        return None;
    }

    let want = title_tokens(query);
    // 1) score each candidate on title + year alone (no extra network calls)
    let mut scored: Vec<(f64, usize, i64)> = results
        .iter()
        .take(8)
        .enumerate()
        .map(|(i, r)| {
            let cand = title_tokens(&r.title);
            let mut s = 0.0f64;
            if cand == want && !want.is_empty() {
                s += 100.0;
            }
            let joined_want = want.join(" ");
            let joined_cand = cand.join(" ");
            if joined_cand.starts_with(&joined_want) || joined_want.starts_with(&joined_cand) {
                s += 55.0;
            } else if joined_cand.contains(&joined_want) || joined_want.contains(&joined_cand) {
                s += 30.0;
            }
            s += token_overlap(&want, &cand) * 25.0;
            if let (Some(y), Some(cy)) = (year, r.year) {
                let d = (y - cy).abs();
                s += if d == 0 {
                    28.0
                } else if d <= 1 {
                    14.0
                } else if d <= 3 {
                    4.0
                } else {
                    -(d.min(25) as f64)
                };
            }
            s -= i as f64 * 0.5; // gentle nudge toward TMDb's own ranking
            (s, i, r.tmdb_id)
        })
        .collect();
    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));

    // 2) collect the near-top contenders; a clear title winner ends it here
    let top = scored[0].0;
    let contenders: Vec<(f64, usize, i64)> =
        scored.iter().filter(|(s, _, _)| top - s < 15.0).copied().collect();
    if contenders.len() == 1 || local_eps < 3 {
        return Some(contenders[0].2);
    }

    // 3) disambiguate the tie by TMDb episode count — but only lightly, and never
    //    punish a show for merely being LARGER than the local folder (single season)
    let mut best: Option<(i64, f64)> = None;
    for (_, _, id) in &contenders {
        if let Ok(meta) = tmdb.tv_details(*id).await {
            let total = meta.episode_count.unwrap_or(0);
            let penalty = if local_eps > total + 2 {
                (local_eps - total) as f64 * 2.0 // local has MORE than the show → wrong show
            } else {
                (total - local_eps).abs() as f64 * 0.2 // fits inside → weak signal
            };
            let better = best.map(|(_, bp)| penalty < bp).unwrap_or(true);
            if better {
                best = Some((*id, penalty));
            }
        }
    }
    best.map(|b| b.0).or(Some(contenders[0].2))
}

/// The user's remembered identification for a movie file, if any.
fn movie_override(conn: &Connection, path: &str) -> Option<i64> {
    let name = Path::new(path).file_name()?.to_string_lossy().to_string();
    let key = parser::movie_key(&file_stem(&name));
    db::identity_override(conn, "movie", &key).ok().flatten()
}

/// The user's remembered identification for a show (via any of its grouping keys).
fn show_override(conn: &Connection, show_id: i64) -> Option<i64> {
    for key in db::keys_for_show(conn, show_id).ok()? {
        if let Ok(Some(t)) = db::identity_override(conn, "tv", &key) {
            return Some(t);
        }
    }
    None
}

async fn match_all(conn: &Connection, tmdb: &Tmdb, app: &AppHandle, auto_match: bool) -> Result<()> {
    // Remembered identifications ("Merken" beim Identifizieren) apply FIRST and
    // always — even with auto-match off, and again after a full library rebuild.
    let movies = db::movies_to_match(conn)?;
    let total = movies.len() as i64;
    for (i, m) in movies.iter().enumerate() {
        emit(app, "match", format!("Film: {}", m.title), i as i64 + 1, total);
        if let Some(tmdb_id) = movie_override(conn, &m.path) {
            let _ = apply_movie_match(conn, tmdb, m.id, tmdb_id, true).await;
        } else if auto_match {
            let results = search_with_fallback(tmdb, &search_query(&m.title), "movie", m.year).await;
            if let Some(first) = results.first() {
                let _ = apply_movie_match(conn, tmdb, m.id, first.tmdb_id, false).await;
            }
        }
    }

    let shows = db::shows_to_match(conn)?;
    let total = shows.len() as i64;
    for (i, s) in shows.iter().enumerate() {
        emit(app, "match", format!("Serie: {}", s.title), i as i64 + 1, total);
        if let Some(tmdb_id) = show_override(conn, s.id) {
            let _ = apply_show_match(conn, tmdb, s.id, tmdb_id, true).await;
        } else if auto_match {
            let local = db::count_episodes(conn, s.id).unwrap_or(0);
            if let Some(tmdb_id) = best_tv_match(tmdb, &search_query(&s.title), s.year, local).await {
                let _ = apply_show_match(conn, tmdb, s.id, tmdb_id, false).await;
            }
        }
    }

    // Shows matched but still without a poster (e.g. a bare row created by a
    // placement override during rebuild) → pull their full metadata now.
    for s in db::matched_shows(conn)? {
        if s.poster_path.is_some() {
            continue;
        }
        if let Some(t) = s.tmdb_id {
            emit(app, "match", format!("Aktualisiere: {}", s.title), 0, 0);
            let _ = apply_show_match(conn, tmdb, s.id, t, s.identified).await;
        }
    }

    // Incremental refresh: already-matched shows that gained new seasons/episodes.
    for s in db::matched_shows(conn)? {
        let tmdb_id = match s.tmdb_id {
            Some(t) => t,
            None => continue,
        };
        let missing = db::seasons_missing_meta(conn, s.id)?;
        if missing.is_empty() {
            continue;
        }
        emit(app, "match", format!("Neue Folgen: {}", s.title), 0, 0);
        for season in missing {
            if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
                for e in eps {
                    db::update_episode_meta(
                        conn, s.id, season, e.episode, e.title.as_deref(), e.overview.as_deref(),
                        e.still_path.as_deref(), e.air_date.as_deref(), e.runtime,
                    )?;
                }
            }
        }
    }

    // Refresh movies that are matched but still have no poster (e.g. earlier offline scan).
    for m in db::movies_missing_poster(conn)? {
        if let Some(t) = m.tmdb_id {
            emit(app, "match", format!("Aktualisiere: {}", m.title), 0, 0);
            let _ = apply_movie_match(conn, tmdb, m.id, t, m.identified).await;
        }
    }

    // Fold separate folders of the same show (e.g. different qualities/seasons) into one.
    db::merge_shows_by_tmdb(conn)?;
    Ok(())
}

/// Full metadata refresh: re-pull TMDb details + episode data for every matched item.
/// Keeps the existing match (and the `identified` flag) but reloads posters, overviews, etc.
pub fn run_refresh(db_path: PathBuf, http: reqwest::Client, app: AppHandle) -> Result<()> {
    let conn = db::open(&db_path)?;
    let key = db::get_setting(&conn, "tmdb_key")?.unwrap_or_default();
    if key.trim().is_empty() {
        emit(&app, "error", "Kein TMDb-Key gesetzt".into(), 0, 0);
        return Ok(());
    }
    let lang = db::get_setting(&conn, "tmdb_lang")?.unwrap_or_else(|| "de-DE".into());
    let tmdb = Tmdb::new(http, key, lang);
    emit(&app, "start", "Metadaten werden neu geladen …".into(), 0, 0);

    tauri::async_runtime::block_on(async {
        let movies = db::matched_movies(&conn).unwrap_or_default();
        let total = movies.len() as i64;
        for (i, m) in movies.iter().enumerate() {
            if let Some(t) = m.tmdb_id {
                emit(&app, "match", format!("Film: {}", m.title), i as i64 + 1, total);
                let _ = apply_movie_match(&conn, &tmdb, m.id, t, m.identified).await;
            }
        }
        let shows = db::matched_shows(&conn).unwrap_or_default();
        let total = shows.len() as i64;
        for (i, s) in shows.iter().enumerate() {
            if let Some(t) = s.tmdb_id {
                emit(&app, "match", format!("Serie: {}", s.title), i as i64 + 1, total);
                let _ = apply_show_match(&conn, &tmdb, s.id, t, s.identified).await;
            }
        }
        let _ = db::merge_shows_by_tmdb(&conn);
    });

    emit(&app, "done", "Metadaten aktualisiert".into(), 0, 0);
    let _ = app.emit("library://updated", ());
    Ok(())
}

/// Fetch full movie metadata for a chosen TMDb id and write it to the movie row.
pub async fn apply_movie_match(
    conn: &Connection,
    tmdb: &Tmdb,
    movie_id: i64,
    tmdb_id: i64,
    identified: bool,
) -> Result<()> {
    let meta = tmdb.movie_details(tmdb_id).await?;
    let genres = serde_json::to_string(&meta.genres).ok();
    db::update_movie_match(
        conn,
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
        identified,
        meta.cert.as_deref(),
    )?;
    Ok(())
}

/// Fetch full show metadata + all season/episode metadata for a chosen TMDb id.
pub async fn apply_show_match(
    conn: &Connection,
    tmdb: &Tmdb,
    show_id: i64,
    tmdb_id: i64,
    identified: bool,
) -> Result<()> {
    let meta = tmdb.tv_details(tmdb_id).await?;
    let genres = serde_json::to_string(&meta.genres).ok();
    db::update_show_match(
        conn,
        show_id,
        meta.tmdb_id,
        &meta.title,
        meta.year,
        meta.overview.as_deref(),
        meta.poster_path.as_deref(),
        meta.backdrop_path.as_deref(),
        genres.as_deref(),
        meta.rating,
        identified,
        meta.cert.as_deref(),
        meta.status.as_deref(),
        meta.last_year,
        meta.runtime,
    )?;
    fetch_show_episodes(conn, tmdb, show_id, meta.tmdb_id).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;

    fn touch(path: &Path) {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).unwrap();
        }
        let mut f = fs::File::create(path).unwrap();
        f.write_all(b"x").unwrap();
    }

    #[test]
    fn pure_season_dir_detection() {
        assert!(is_pure_season_dir("Season 1"));
        assert!(is_pure_season_dir("Staffel 02"));
        assert!(is_pure_season_dir("S03"));
        assert!(is_pure_season_dir("Specials"));
        // real show folders must NOT be treated as season folders
        assert!(!is_pure_season_dir("Marvel's Daredevil"));
        assert!(!is_pure_season_dir("Stranger Things S01-S04"));
        assert!(!is_pure_season_dir("Daredevil Born Again"));
    }

    #[test]
    fn show_source_name_handles_show_folder_as_library() {
        let root = Path::new("/lib/Marvel's Daredevil");
        // root IS the show folder, seasons directly inside → show name = root name
        let p = Path::new("/lib/Marvel's Daredevil/Season 1/ep.mkv");
        assert_eq!(show_source_name(root, p), "Marvel's Daredevil");
        let p2 = Path::new("/lib/Marvel's Daredevil/Season 3/ep.mkv");
        assert_eq!(show_source_name(root, p2), "Marvel's Daredevil");
        // normal case: parent folder contains show folders
        let root2 = Path::new("/lib");
        let p3 = Path::new("/lib/Breaking Bad/Season 1/ep.mkv");
        assert_eq!(show_source_name(root2, p3), "Breaking Bad");
    }

    #[test]
    fn title_token_overlap_scoring() {
        let want = title_tokens("Marvel's Daredevil");
        let cand = title_tokens("Marvel's Daredevil");
        assert!((token_overlap(&want, &cand) - 1.0).abs() < 1e-9);
        let partial = title_tokens("Daredevil Born Again");
        assert!(token_overlap(&want, &partial) < 1.0 && token_overlap(&want, &partial) > 0.0);
    }

    #[test]
    fn scans_movies_and_groups_episodes() {
        let base = std::env::temp_dir().join(format!("ghgflix_test_{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let movies = base.join("Movies");
        let tv = base.join("TV");

        touch(&movies.join("The Matrix (1999) 1080p BluRay.mkv"));
        touch(&movies.join("Inception.2010.x264.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E01.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E01 2160p.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 01").join("Breaking Bad S01E02.mkv"));
        touch(&tv.join("Breaking Bad (2008)").join("Season 02").join("Breaking Bad S02E01.mkv"));

        let conn = db::open(&base.join("test.db")).unwrap();
        scan_movies(&conn, &movies).unwrap();
        scan_tv(&conn, &tv).unwrap();

        let movies_list = db::list_movies(&conn).unwrap();
        assert_eq!(movies_list.len(), 2, "should find 2 movies");
        assert!(movies_list.iter().any(|m| m.title == "The Matrix" && m.year == Some(1999)));
        assert!(movies_list.iter().any(|m| m.title == "Inception" && m.year == Some(2010)));

        let shows = db::list_shows(&conn).unwrap();
        assert_eq!(shows.len(), 1, "should find 1 show");
        assert_eq!(shows[0].title, "Breaking Bad");
        assert_eq!(shows[0].episode_count, 3, "two qualities of S01E01 must stay ONE episode");
        assert_eq!(shows[0].season_count, 2, "should group 2 seasons");
        // 3 episodes but 4 physical files (S01E01 exists in two qualities)
        assert_eq!(db::all_episode_file_paths(&conn).unwrap().len(), 4, "should track 4 files");

        drop(conn);
        let _ = fs::remove_dir_all(&base);
    }
}

/// Pull episode metadata for every season we have files for.
pub async fn fetch_show_episodes(
    conn: &Connection,
    tmdb: &Tmdb,
    show_id: i64,
    tmdb_id: i64,
) -> Result<()> {
    for season in db::distinct_seasons(conn, show_id)? {
        if let Ok(eps) = tmdb.season_episodes(tmdb_id, season).await {
            for e in eps {
                db::update_episode_meta(
                    conn,
                    show_id,
                    season,
                    e.episode,
                    e.title.as_deref(),
                    e.overview.as_deref(),
                    e.still_path.as_deref(),
                    e.air_date.as_deref(),
                    e.runtime,
                )?;
            }
        }
    }
    Ok(())
}

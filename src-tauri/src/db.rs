use crate::models::*;
use anyhow::Result;
use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "busy_timeout", 5000)?;
    init_schema(&conn)?;
    Ok(conn)
}

pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS libraries (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL UNIQUE,
            kind TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS movies (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            path          TEXT NOT NULL UNIQUE,
            title         TEXT NOT NULL,
            year          INTEGER,
            tmdb_id       INTEGER,
            overview      TEXT,
            poster_path   TEXT,
            backdrop_path TEXT,
            genres        TEXT,
            runtime       INTEGER,
            rating        REAL,
            added_at      INTEGER NOT NULL,
            identified    INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS shows (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            folder        TEXT,
            title         TEXT NOT NULL,
            year          INTEGER,
            tmdb_id       INTEGER,
            overview      TEXT,
            poster_path   TEXT,
            backdrop_path TEXT,
            genres        TEXT,
            rating        REAL,
            added_at      INTEGER NOT NULL,
            identified    INTEGER NOT NULL DEFAULT 0
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_shows_folder ON shows(folder) WHERE folder IS NOT NULL;

        CREATE TABLE IF NOT EXISTS episodes (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            show_id    INTEGER NOT NULL,
            season     INTEGER NOT NULL,
            episode    INTEGER NOT NULL,
            path       TEXT NOT NULL UNIQUE,
            title      TEXT,
            overview   TEXT,
            still_path TEXT,
            air_date   TEXT,
            runtime    INTEGER,
            added_at   INTEGER NOT NULL,
            UNIQUE(show_id, season, episode),
            FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS progress (
            profile_id   TEXT NOT NULL,
            media_type   TEXT NOT NULL,
            ref_id       INTEGER NOT NULL,
            tmdb_id      INTEGER,
            season       INTEGER,
            episode      INTEGER,
            position_sec REAL NOT NULL DEFAULT 0,
            duration_sec REAL NOT NULL DEFAULT 0,
            watched      INTEGER NOT NULL DEFAULT 0,
            updated_at   INTEGER NOT NULL,
            PRIMARY KEY(profile_id, media_type, ref_id)
        );

        CREATE TABLE IF NOT EXISTS favorites (
            profile_id TEXT NOT NULL,
            media_type TEXT NOT NULL,
            ref_id     INTEGER NOT NULL,
            added_at   INTEGER NOT NULL,
            PRIMARY KEY(profile_id, media_type, ref_id)
        );
        "#,
    )?;
    // migrations (ignore errors if columns already exist)
    let _ = conn.execute("ALTER TABLE episodes ADD COLUMN intro_start REAL", []);
    let _ = conn.execute("ALTER TABLE episodes ADD COLUMN intro_end REAL", []);
    // real video resolution (read with ffprobe) → accurate quality labels
    let _ = conn.execute("ALTER TABLE movies ADD COLUMN width INTEGER", []);
    let _ = conn.execute("ALTER TABLE movies ADD COLUMN height INTEGER", []);
    let _ = conn.execute("ALTER TABLE episodes ADD COLUMN width INTEGER", []);
    let _ = conn.execute("ALTER TABLE episodes ADD COLUMN height INTEGER", []);
    // user-chosen artwork that must survive metadata refreshes (Plex-style)
    let _ = conn.execute("ALTER TABLE movies ADD COLUMN poster_locked INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE movies ADD COLUMN backdrop_locked INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN poster_locked INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN backdrop_locked INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE episodes ADD COLUMN still_locked INTEGER NOT NULL DEFAULT 0", []);
    // age certification (FSK/PG…), show status + typical runtime, manual per-show intro window
    let _ = conn.execute("ALTER TABLE movies ADD COLUMN cert TEXT", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN cert TEXT", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN status TEXT", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN last_year INTEGER", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN runtime INTEGER", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN intro_start REAL", []);
    let _ = conn.execute("ALTER TABLE shows ADD COLUMN intro_end REAL", []);
    // per-season custom poster
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS season_art (
            show_id     INTEGER NOT NULL,
            season      INTEGER NOT NULL,
            poster_path TEXT,
            PRIMARY KEY(show_id, season),
            FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
        );

        -- one episode can exist as several files (different qualities)
        CREATE TABLE IF NOT EXISTS episode_files (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            episode_id INTEGER NOT NULL,
            path       TEXT NOT NULL UNIQUE,
            width      INTEGER,
            height     INTEGER,
            added_at   INTEGER NOT NULL,
            FOREIGN KEY(episode_id) REFERENCES episodes(id) ON DELETE CASCADE
        );

        -- Stable grouping keys for shows. A show is grouped/looked up on rescan by
        -- these keys (derived from the folder name) — NOT by its title, which the
        -- user can change via "Identifizieren". This is what makes manual matches
        -- survive a rescan: identify changes title/tmdb_id, the key stays put.
        CREATE TABLE IF NOT EXISTS show_keys (
            key     TEXT PRIMARY KEY,
            show_id INTEGER NOT NULL,
            FOREIGN KEY(show_id) REFERENCES shows(id) ON DELETE CASCADE
        );

        -- Permanent user identifications: "this folder/file IS TMDb id X".
        -- Keyed by the stable name-derived key, NOT by row ids, so it survives
        -- rescans AND a full "Bibliothek neu aufbauen". Never wiped by reset.
        CREATE TABLE IF NOT EXISTS identity_map (
            kind    TEXT NOT NULL,             -- 'movie' | 'tv'
            key     TEXT NOT NULL,
            tmdb_id INTEGER NOT NULL,
            PRIMARY KEY(kind, key)
        );

        CREATE INDEX IF NOT EXISTS idx_episodes_show    ON episodes(show_id);
        CREATE INDEX IF NOT EXISTS idx_epfiles_episode  ON episode_files(episode_id);
        CREATE INDEX IF NOT EXISTS idx_movies_tmdb      ON movies(tmdb_id);
        CREATE INDEX IF NOT EXISTS idx_shows_tmdb       ON shows(tmdb_id);
        "#,
    )?;
    // favorites carry TMDb coordinates so they can be re-linked after a library rebuild
    let _ = conn.execute("ALTER TABLE favorites ADD COLUMN tmdb_id INTEGER", []);
    let _ = conn.execute(
        "UPDATE favorites SET tmdb_id = (SELECT m.tmdb_id FROM movies m WHERE m.id = favorites.ref_id)
         WHERE media_type='movie' AND tmdb_id IS NULL",
        [],
    );
    let _ = conn.execute(
        "UPDATE favorites SET tmdb_id = (SELECT s.tmdb_id FROM shows s WHERE s.id = favorites.ref_id)
         WHERE media_type='show' AND tmdb_id IS NULL",
        [],
    );
    // backfill the file list from existing episode rows (idempotent: path is UNIQUE)
    let _ = conn.execute(
        "INSERT OR IGNORE INTO episode_files(episode_id, path, width, height, added_at)
         SELECT id, path, width, height, added_at FROM episodes",
        [],
    );
    Ok(())
}

// ===== favorites =====

pub fn is_favorite(conn: &Connection, profile_id: &str, media_type: &str, ref_id: i64) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(*) FROM favorites WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
        params![profile_id, media_type, ref_id],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

pub fn add_favorite(conn: &Connection, profile_id: &str, media_type: &str, ref_id: i64) -> Result<()> {
    // store TMDb coordinates too so the favorite survives a library rebuild
    let tmdb: Option<i64> = if media_type == "movie" {
        movie_tmdb(conn, ref_id)?
    } else {
        conn.query_row("SELECT tmdb_id FROM shows WHERE id=?1", [ref_id], |r| r.get(0))
            .optional()?
            .flatten()
    };
    conn.execute(
        "INSERT OR IGNORE INTO favorites(profile_id, media_type, ref_id, added_at, tmdb_id) VALUES(?1,?2,?3,?4,?5)",
        params![profile_id, media_type, ref_id, now(), tmdb],
    )?;
    Ok(())
}

pub fn remove_favorite(conn: &Connection, profile_id: &str, media_type: &str, ref_id: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM favorites WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
        params![profile_id, media_type, ref_id],
    )?;
    Ok(())
}

pub fn list_favorites(conn: &Connection, profile_id: &str) -> Result<Vec<Favorite>> {
    let mut stmt = conn.prepare(
        "SELECT media_type, ref_id, added_at FROM favorites WHERE profile_id=?1 ORDER BY added_at DESC",
    )?;
    let rows = stmt
        .query_map([profile_id], |r| {
            Ok(Favorite { media_type: r.get(0)?, ref_id: r.get(1)?, added_at: r.get(2)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ===== watched =====

pub fn set_watched(conn: &Connection, profile_id: &str, media_type: &str, ref_id: i64, watched: bool) -> Result<()> {
    let existing = get_progress(conn, profile_id, media_type, ref_id)?;
    let dur = existing.as_ref().map(|p| p.duration_sec).unwrap_or(0.0);
    let (tmdb_id, season, episode) = if media_type == "movie" {
        (movie_tmdb(conn, ref_id)?, None, None)
    } else {
        match episode_sync_coords(conn, ref_id)? {
            Some((s, e, t)) => (t, Some(s), Some(e)),
            None => (None, None, None),
        }
    };
    let pos = if watched { dur } else { 0.0 };
    let p = Progress {
        profile_id: profile_id.to_string(),
        media_type: media_type.to_string(),
        ref_id,
        tmdb_id,
        season,
        episode,
        position_sec: pos,
        duration_sec: dur,
        watched,
        updated_at: now(),
    };
    upsert_progress(conn, &p)
}

pub fn episode_ids_for_show(conn: &Connection, show_id: i64, season: Option<i64>) -> Result<Vec<i64>> {
    let (sql, with_season) = match season {
        Some(_) => ("SELECT id FROM episodes WHERE show_id=?1 AND season=?2", true),
        None => ("SELECT id FROM episodes WHERE show_id=?1", false),
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = if with_season {
        stmt.query_map(params![show_id, season.unwrap()], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map([show_id], |r| r.get::<_, i64>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(rows)
}

// ===== stats =====

pub fn stats(conn: &Connection, profile_id: &str) -> Result<Stats> {
    conn.query_row(
        "SELECT
            COALESCE(SUM(CASE WHEN watched=1 THEN duration_sec ELSE position_sec END),0),
            COALESCE(SUM(CASE WHEN media_type='movie' AND watched=1 THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN media_type='episode' AND watched=1 THEN 1 ELSE 0 END),0),
            COALESCE(SUM(CASE WHEN watched=0 AND position_sec>30 THEN 1 ELSE 0 END),0)
         FROM progress WHERE profile_id=?1",
        [profile_id],
        |r| {
            Ok(Stats {
                watched_seconds: r.get(0)?,
                movies_watched: r.get(1)?,
                episodes_watched: r.get(2)?,
                in_progress: r.get(3)?,
            })
        },
    )
    .map_err(Into::into)
}

// ===== settings =====

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let v = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get::<_, Option<String>>(0)
        })
        .optional()?
        .flatten();
    Ok(v)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

// ===== libraries =====

pub fn list_libraries(conn: &Connection) -> Result<Vec<Library>> {
    let mut stmt = conn.prepare("SELECT id, path, kind FROM libraries ORDER BY id")?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Library {
                id: r.get(0)?,
                path: r.get(1)?,
                kind: r.get(2)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn add_library(conn: &Connection, path: &str, kind: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO libraries(path, kind) VALUES(?1, ?2)
         ON CONFLICT(path) DO UPDATE SET kind = excluded.kind",
        params![path, kind],
    )?;
    let id = conn.query_row("SELECT id FROM libraries WHERE path = ?1", [path], |r| {
        r.get(0)
    })?;
    Ok(id)
}

pub fn remove_library(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM libraries WHERE id = ?1", [id])?;
    Ok(())
}

// ===== movies =====

const MOVIE_COLS: &str =
    "id, path, title, year, tmdb_id, overview, poster_path, backdrop_path, genres, runtime, rating, added_at, identified, width, height, cert";

fn map_movie(r: &rusqlite::Row) -> rusqlite::Result<Movie> {
    Ok(Movie {
        id: r.get(0)?,
        path: r.get(1)?,
        title: r.get(2)?,
        year: r.get(3)?,
        tmdb_id: r.get(4)?,
        overview: r.get(5)?,
        poster_path: r.get(6)?,
        backdrop_path: r.get(7)?,
        genres: r.get(8)?,
        runtime: r.get(9)?,
        rating: r.get(10)?,
        added_at: r.get(11)?,
        identified: r.get::<_, i64>(12)? != 0,
        width: r.get(13)?,
        height: r.get(14)?,
        cert: r.get(15)?,
    })
}

pub fn insert_movie_if_absent(conn: &Connection, path: &str, title: &str, year: Option<i64>) -> Result<i64> {
    conn.execute(
        "INSERT INTO movies(path, title, year, added_at) VALUES(?1, ?2, ?3, ?4)
         ON CONFLICT(path) DO NOTHING",
        params![path, title, year, now()],
    )?;
    let id = conn.query_row("SELECT id FROM movies WHERE path = ?1", [path], |r| r.get(0))?;
    Ok(id)
}

pub fn list_movies(conn: &Connection) -> Result<Vec<Movie>> {
    let sql = format!("SELECT {MOVIE_COLS} FROM movies ORDER BY title COLLATE NOCASE");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], map_movie)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_movie(conn: &Connection, id: i64) -> Result<Option<Movie>> {
    let sql = format!("SELECT {MOVIE_COLS} FROM movies WHERE id = ?1");
    let m = conn.query_row(&sql, [id], map_movie).optional()?;
    Ok(m)
}

/// All files that are the same movie (same matched tmdb_id) — best quality first.
/// Used to merge duplicate-quality rips into one entry + switch versions in the player.
pub fn movie_versions(conn: &Connection, movie_id: i64) -> Result<Vec<Movie>> {
    let tmdb: Option<i64> = movie_tmdb(conn, movie_id)?;
    let sql = match tmdb {
        Some(_) => format!(
            "SELECT {MOVIE_COLS} FROM movies WHERE tmdb_id = ?1 ORDER BY COALESCE(height,0) DESC, COALESCE(width,0) DESC"
        ),
        None => format!("SELECT {MOVIE_COLS} FROM movies WHERE id = ?1"),
    };
    let mut stmt = conn.prepare(&sql)?;
    let key = tmdb.unwrap_or(movie_id);
    let rows = stmt.query_map([key], map_movie)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn all_movie_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM movies")?;
    let rows = stmt
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete_movie_by_path(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM movies WHERE path = ?1", [path])?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn update_movie_match(
    conn: &Connection,
    id: i64,
    tmdb_id: i64,
    title: &str,
    year: Option<i64>,
    overview: Option<&str>,
    poster_path: Option<&str>,
    backdrop_path: Option<&str>,
    genres: Option<&str>,
    runtime: Option<i64>,
    rating: Option<f64>,
    identified: bool,
    cert: Option<&str>,
) -> Result<()> {
    conn.execute(
        "UPDATE movies SET tmdb_id=?2, title=?3, year=?4, overview=?5,
            poster_path=CASE WHEN poster_locked=1 THEN poster_path ELSE ?6 END,
            backdrop_path=CASE WHEN backdrop_locked=1 THEN backdrop_path ELSE ?7 END,
            genres=?8, runtime=?9, rating=?10, identified=?11, cert=?12 WHERE id=?1",
        params![
            id, tmdb_id, title, year, overview, poster_path, backdrop_path, genres, runtime,
            rating, identified as i64, cert
        ],
    )?;
    Ok(())
}

// ===== shows =====

const SHOW_COLS: &str =
    "id, folder, title, year, tmdb_id, overview, poster_path, backdrop_path, genres, rating, added_at, identified, cert, status, last_year, runtime, intro_start, intro_end";

fn map_show(r: &rusqlite::Row) -> rusqlite::Result<Show> {
    Ok(Show {
        id: r.get(0)?,
        folder: r.get(1)?,
        title: r.get(2)?,
        year: r.get(3)?,
        tmdb_id: r.get(4)?,
        overview: r.get(5)?,
        poster_path: r.get(6)?,
        backdrop_path: r.get(7)?,
        genres: r.get(8)?,
        rating: r.get(9)?,
        added_at: r.get(10)?,
        identified: r.get::<_, i64>(11)? != 0,
        cert: r.get(12)?,
        status: r.get(13)?,
        last_year: r.get(14)?,
        runtime: r.get(15)?,
        intro_start: r.get(16)?,
        intro_end: r.get(17)?,
        episode_count: 0,
        season_count: 0,
        width: None,
        height: None,
    })
}

pub fn find_or_create_show(conn: &Connection, folder: Option<&str>, title: &str, year: Option<i64>) -> Result<i64> {
    if let Some(f) = folder {
        if let Some(id) = conn
            .query_row("SELECT id FROM shows WHERE folder = ?1", [f], |r| r.get::<_, i64>(0))
            .optional()?
        {
            return Ok(id);
        }
    } else if let Some(id) = conn
        .query_row(
            "SELECT id FROM shows WHERE folder IS NULL AND title = ?1",
            [title],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
    {
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO shows(folder, title, year, added_at) VALUES(?1, ?2, ?3, ?4)",
        params![folder, title, year, now()],
    )?;
    Ok(conn.last_insert_rowid())
}

// ===== stable show grouping keys (survive manual identify across rescans) =====

/// Map a grouping key to a show without overwriting an existing mapping.
pub fn set_show_key_if_absent(conn: &Connection, key: &str, show_id: i64) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO show_keys(key, show_id) VALUES(?1, ?2)",
        params![key, show_id],
    )?;
    Ok(())
}

pub fn show_id_for_key(conn: &Connection, key: &str) -> Result<Option<i64>> {
    let id = conn
        .query_row("SELECT show_id FROM show_keys WHERE key = ?1", [key], |r| r.get::<_, i64>(0))
        .optional()?;
    Ok(id)
}

/// Resolve (or create) the show for a freshly-seen folder, keyed by the stable
/// grouping key. Falls back to a legacy title match for shows indexed before keys
/// existed, then backfills the key so the next rescan is O(1).
pub fn find_or_create_show_by_key(
    conn: &Connection,
    key: &str,
    title: &str,
    year: Option<i64>,
) -> Result<i64> {
    if let Some(id) = show_id_for_key(conn, key)? {
        return Ok(id);
    }
    // legacy: a show created before keys existed still carries its cleaned title
    if let Some(id) = conn
        .query_row(
            "SELECT id FROM shows WHERE folder IS NULL AND identified = 0 AND tmdb_id IS NULL AND title = ?1",
            [title],
            |r| r.get::<_, i64>(0),
        )
        .optional()?
    {
        set_show_key_if_absent(conn, key, id)?;
        return Ok(id);
    }
    conn.execute(
        "INSERT INTO shows(folder, title, year, added_at) VALUES(NULL, ?1, ?2, ?3)",
        params![title, year, now()],
    )?;
    let id = conn.last_insert_rowid();
    set_show_key_if_absent(conn, key, id)?;
    Ok(id)
}

/// The show a known file currently belongs to (None = file not indexed yet).
pub fn show_id_of_episode_file(conn: &Connection, path: &str) -> Result<Option<i64>> {
    let id = conn
        .query_row(
            "SELECT e.show_id FROM episode_files f JOIN episodes e ON e.id = f.episode_id WHERE f.path = ?1",
            [path],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

/// (show_id, file_path) for every indexed episode file — used to backfill keys.
pub fn all_show_file_paths(conn: &Connection) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn
        .prepare("SELECT e.show_id, f.path FROM episode_files f JOIN episodes e ON e.id = f.episode_id")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// All stable grouping keys currently pointing at a show.
pub fn keys_for_show(conn: &Connection, show_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT key FROM show_keys WHERE show_id = ?1")?;
    let rows = stmt.query_map([show_id], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ===== permanent identity overrides (survive rescans AND library rebuilds) =====

/// Remember "this key IS this TMDb id". `kind` = "movie" | "tv".
pub fn set_identity_override(conn: &Connection, kind: &str, key: &str, tmdb_id: i64) -> Result<()> {
    if key.trim().is_empty() {
        return Ok(());
    }
    conn.execute(
        "INSERT INTO identity_map(kind, key, tmdb_id) VALUES(?1,?2,?3)
         ON CONFLICT(kind, key) DO UPDATE SET tmdb_id = excluded.tmdb_id",
        params![kind, key, tmdb_id],
    )?;
    Ok(())
}

pub fn identity_override(conn: &Connection, kind: &str, key: &str) -> Result<Option<i64>> {
    let id = conn
        .query_row(
            "SELECT tmdb_id FROM identity_map WHERE kind=?1 AND key=?2",
            params![kind, key],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

pub fn find_show_by_tmdb(conn: &Connection, tmdb_id: i64) -> Result<Option<i64>> {
    let id = conn
        .query_row(
            "SELECT id FROM shows WHERE tmdb_id = ?1 ORDER BY identified DESC, id LIMIT 1",
            [tmdb_id],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

/// Re-link progress + favorites whose ref_id no longer exists (e.g. after
/// "Bibliothek neu aufbauen") back to the freshly indexed rows via their TMDb
/// coordinates. Unmappable rows are kept dormant — the item may come back later.
pub fn remap_stale_refs(conn: &Connection) -> Result<()> {
    // --- progress: movies ---
    let stale: Vec<(String, i64, i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT profile_id, ref_id, tmdb_id, updated_at FROM progress
             WHERE media_type='movie' AND tmdb_id IS NOT NULL
               AND ref_id NOT IN (SELECT id FROM movies)",
        )?;
        let rows = stmt
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (profile, old_ref, tmdb, updated) in stale {
        if let Some(new_ref) = find_movie_by_tmdb(conn, tmdb)? {
            remap_progress_row(conn, &profile, "movie", old_ref, new_ref, updated)?;
        }
    }

    // --- progress: episodes ---
    let stale: Vec<(String, i64, i64, i64, i64, i64)> = {
        let mut stmt = conn.prepare(
            "SELECT profile_id, ref_id, tmdb_id, season, episode, updated_at FROM progress
             WHERE media_type='episode' AND tmdb_id IS NOT NULL AND season IS NOT NULL AND episode IS NOT NULL
               AND ref_id NOT IN (SELECT id FROM episodes)",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for (profile, old_ref, tmdb, season, episode, updated) in stale {
        if let Some(new_ref) = find_episode_by_show_tmdb(conn, tmdb, season, episode)? {
            remap_progress_row(conn, &profile, "episode", old_ref, new_ref, updated)?;
        }
    }

    // --- favorites (movies + shows) ---
    conn.execute(
        "UPDATE OR IGNORE favorites SET ref_id =
            (SELECT m.id FROM movies m WHERE m.tmdb_id = favorites.tmdb_id
             ORDER BY COALESCE(m.height,0) DESC LIMIT 1)
         WHERE media_type='movie' AND tmdb_id IS NOT NULL
           AND ref_id NOT IN (SELECT id FROM movies)
           AND EXISTS (SELECT 1 FROM movies m WHERE m.tmdb_id = favorites.tmdb_id)",
        [],
    )?;
    conn.execute(
        "UPDATE OR IGNORE favorites SET ref_id =
            (SELECT s.id FROM shows s WHERE s.tmdb_id = favorites.tmdb_id
             ORDER BY s.identified DESC, s.id LIMIT 1)
         WHERE media_type='show' AND tmdb_id IS NOT NULL
           AND ref_id NOT IN (SELECT id FROM shows)
           AND EXISTS (SELECT 1 FROM shows s WHERE s.tmdb_id = favorites.tmdb_id)",
        [],
    )?;
    // duplicates that couldn't be updated (target already favorited) are redundant
    conn.execute(
        "DELETE FROM favorites WHERE media_type='movie' AND tmdb_id IS NOT NULL
           AND ref_id NOT IN (SELECT id FROM movies)
           AND EXISTS (SELECT 1 FROM movies m JOIN favorites f2
                        ON f2.ref_id = m.id AND f2.media_type='movie' AND f2.profile_id = favorites.profile_id
                       WHERE m.tmdb_id = favorites.tmdb_id)",
        [],
    )?;
    conn.execute(
        "DELETE FROM favorites WHERE media_type='show' AND tmdb_id IS NOT NULL
           AND ref_id NOT IN (SELECT id FROM shows)
           AND EXISTS (SELECT 1 FROM shows s JOIN favorites f2
                        ON f2.ref_id = s.id AND f2.media_type='show' AND f2.profile_id = favorites.profile_id
                       WHERE s.tmdb_id = favorites.tmdb_id)",
        [],
    )?;
    Ok(())
}

/// Move one progress row to a new ref_id; on collision the newer entry wins.
fn remap_progress_row(
    conn: &Connection,
    profile: &str,
    media_type: &str,
    old_ref: i64,
    new_ref: i64,
    updated: i64,
) -> Result<()> {
    let existing: Option<i64> = conn
        .query_row(
            "SELECT updated_at FROM progress WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
            params![profile, media_type, new_ref],
            |r| r.get(0),
        )
        .optional()?;
    match existing {
        Some(ex) if ex >= updated => {
            // target already has newer data → the stale row is redundant
            conn.execute(
                "DELETE FROM progress WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
                params![profile, media_type, old_ref],
            )?;
        }
        Some(_) => {
            conn.execute(
                "DELETE FROM progress WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
                params![profile, media_type, new_ref],
            )?;
            conn.execute(
                "UPDATE progress SET ref_id=?4 WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
                params![profile, media_type, old_ref, new_ref],
            )?;
        }
        None => {
            conn.execute(
                "UPDATE progress SET ref_id=?4 WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3",
                params![profile, media_type, old_ref, new_ref],
            )?;
        }
    }
    Ok(())
}

pub fn count_episodes(conn: &Connection, show_id: i64) -> Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM episodes WHERE show_id=?1", [show_id], |r| r.get(0))
        .map_err(Into::into)
}

/// Merge every show that resolved to the same TMDb id into one entry, moving (and
/// where needed merging) its episodes. This is what makes e.g. a "Daredevil 480p"
/// folder and a "Daredevil 1080p" folder become one show — and their same-numbered
/// episodes become one episode with two quality files (→ the player version switch).
pub fn merge_shows_by_tmdb(conn: &Connection) -> Result<()> {
    let dup_ids: Vec<i64> = {
        let mut stmt = conn
            .prepare("SELECT tmdb_id FROM shows WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1")?;
        let rows = stmt.query_map([], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
        rows
    };
    for tmdb in dup_ids {
        // the manually identified row (if any) wins as canonical, else the oldest
        let shows: Vec<i64> = {
            let mut stmt =
                conn.prepare("SELECT id FROM shows WHERE tmdb_id=?1 ORDER BY identified DESC, id")?;
            let rows = stmt.query_map([tmdb], |r| r.get::<_, i64>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
            rows
        };
        if shows.len() < 2 {
            continue;
        }
        let canonical = shows[0];
        for &other in &shows[1..] {
            let eps: Vec<(i64, i64, i64)> = {
                let mut stmt = conn.prepare("SELECT id, season, episode FROM episodes WHERE show_id=?1")?;
                let rows = stmt
                    .query_map([other], |r| {
                        Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
                    })?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                rows
            };
            for (eid, season, episode) in eps {
                match find_episode_id(conn, canonical, season, episode)? {
                    Some(t) if t != eid => merge_episodes(conn, eid, t)?,
                    Some(_) => {}
                    None => {
                        conn.execute("UPDATE episodes SET show_id=?2 WHERE id=?1", params![eid, canonical])?;
                    }
                }
            }
            // keep the folded folder's grouping keys pointing at the survivor so a
            // future rescan re-finds the merged show instead of re-creating it
            conn.execute("UPDATE show_keys SET show_id=?2 WHERE show_id=?1", params![other, canonical])?;
            // favorites + custom season posters of the folded row move too
            conn.execute(
                "UPDATE OR IGNORE favorites SET ref_id=?2 WHERE media_type='show' AND ref_id=?1",
                params![other, canonical],
            )?;
            conn.execute("DELETE FROM favorites WHERE media_type='show' AND ref_id=?1", [other])?;
            conn.execute(
                "UPDATE OR IGNORE season_art SET show_id=?2 WHERE show_id=?1",
                params![other, canonical],
            )?;
            conn.execute("DELETE FROM shows WHERE id=?1", [other])?;
        }
    }
    set_all_episode_primaries(conn)?;
    Ok(())
}

pub fn list_shows(conn: &Connection) -> Result<Vec<Show>> {
    let sql = format!(
        "SELECT {SHOW_COLS},
            (SELECT COUNT(*) FROM episodes e WHERE e.show_id = shows.id) AS ep_count,
            (SELECT COUNT(DISTINCT season) FROM episodes e WHERE e.show_id = shows.id) AS se_count,
            (SELECT MAX(width) FROM episodes e WHERE e.show_id = shows.id) AS max_w,
            (SELECT MAX(height) FROM episodes e WHERE e.show_id = shows.id) AS max_h
         FROM shows ORDER BY title COLLATE NOCASE"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([], |r| {
            let mut s = map_show(r)?;
            s.episode_count = r.get(18)?;
            s.season_count = r.get(19)?;
            s.width = r.get(20)?;
            s.height = r.get(21)?;
            Ok(s)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_show(conn: &Connection, id: i64) -> Result<Option<Show>> {
    let sql = format!("SELECT {SHOW_COLS} FROM shows WHERE id = ?1");
    let mut s = match conn.query_row(&sql, [id], map_show).optional()? {
        Some(s) => s,
        None => return Ok(None),
    };
    s.episode_count = conn.query_row("SELECT COUNT(*) FROM episodes WHERE show_id=?1", [id], |r| r.get(0))?;
    s.season_count =
        conn.query_row("SELECT COUNT(DISTINCT season) FROM episodes WHERE show_id=?1", [id], |r| r.get(0))?;
    s.width = conn.query_row("SELECT MAX(width) FROM episodes WHERE show_id=?1", [id], |r| r.get(0))?;
    s.height = conn.query_row("SELECT MAX(height) FROM episodes WHERE show_id=?1", [id], |r| r.get(0))?;
    Ok(Some(s))
}

pub fn shows_to_match(conn: &Connection) -> Result<Vec<Show>> {
    let sql = format!("SELECT {SHOW_COLS} FROM shows WHERE tmdb_id IS NULL AND identified = 0");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_show)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn movies_to_match(conn: &Connection) -> Result<Vec<Movie>> {
    let sql = format!("SELECT {MOVIE_COLS} FROM movies WHERE tmdb_id IS NULL AND identified = 0");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_movie)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn matched_movies(conn: &Connection) -> Result<Vec<Movie>> {
    let sql = format!("SELECT {MOVIE_COLS} FROM movies WHERE tmdb_id IS NOT NULL");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_movie)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn movies_missing_poster(conn: &Connection) -> Result<Vec<Movie>> {
    let sql = format!("SELECT {MOVIE_COLS} FROM movies WHERE tmdb_id IS NOT NULL AND poster_path IS NULL");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_movie)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn matched_shows(conn: &Connection) -> Result<Vec<Show>> {
    let sql = format!("SELECT {SHOW_COLS} FROM shows WHERE tmdb_id IS NOT NULL");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], map_show)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

/// Seasons of a show that contain at least one episode without fetched metadata (newly added).
pub fn seasons_missing_meta(conn: &Connection, show_id: i64) -> Result<Vec<i64>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT season FROM episodes WHERE show_id = ?1 AND title IS NULL ORDER BY season",
    )?;
    let rows = stmt
        .query_map([show_id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

#[allow(clippy::too_many_arguments)]
pub fn update_show_match(
    conn: &Connection,
    id: i64,
    tmdb_id: i64,
    title: &str,
    year: Option<i64>,
    overview: Option<&str>,
    poster_path: Option<&str>,
    backdrop_path: Option<&str>,
    genres: Option<&str>,
    rating: Option<f64>,
    identified: bool,
    cert: Option<&str>,
    status: Option<&str>,
    last_year: Option<i64>,
    runtime: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE shows SET tmdb_id=?2, title=?3, year=?4, overview=?5,
            poster_path=CASE WHEN poster_locked=1 THEN poster_path ELSE ?6 END,
            backdrop_path=CASE WHEN backdrop_locked=1 THEN backdrop_path ELSE ?7 END,
            genres=?8, rating=?9, identified=?10, cert=?11, status=?12, last_year=?13, runtime=?14 WHERE id=?1",
        params![
            id, tmdb_id, title, year, overview, poster_path, backdrop_path, genres, rating,
            identified as i64, cert, status, last_year, runtime
        ],
    )?;
    Ok(())
}

/// Manual per-show intro window — used as fallback for episodes without their own.
pub fn set_show_intro(conn: &Connection, show_id: i64, start: Option<f64>, end: Option<f64>) -> Result<()> {
    conn.execute(
        "UPDATE shows SET intro_start=?2, intro_end=?3 WHERE id=?1",
        params![show_id, start, end],
    )?;
    Ok(())
}

// ===== episodes =====

const EPISODE_COLS: &str =
    "id, show_id, season, episode, path, title, overview, still_path, air_date, runtime, added_at, intro_start, intro_end, width, height";

fn map_episode(r: &rusqlite::Row) -> rusqlite::Result<Episode> {
    Ok(Episode {
        id: r.get(0)?,
        show_id: r.get(1)?,
        season: r.get(2)?,
        episode: r.get(3)?,
        path: r.get(4)?,
        title: r.get(5)?,
        overview: r.get(6)?,
        still_path: r.get(7)?,
        air_date: r.get(8)?,
        runtime: r.get(9)?,
        added_at: r.get(10)?,
        intro_start: r.get(11)?,
        intro_end: r.get(12)?,
        width: r.get(13)?,
        height: r.get(14)?,
        show_title: None,
        file_count: 0,
    })
}

pub fn update_episode_intro(conn: &Connection, episode_id: i64, start: f64, end: f64) -> Result<()> {
    conn.execute(
        "UPDATE episodes SET intro_start=?2, intro_end=?3 WHERE id=?1",
        params![episode_id, start, end],
    )?;
    Ok(())
}

fn find_episode_id(conn: &Connection, show_id: i64, season: i64, episode: i64) -> Result<Option<i64>> {
    let id = conn
        .query_row(
            "SELECT id FROM episodes WHERE show_id=?1 AND season=?2 AND episode=?3",
            params![show_id, season, episode],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

fn episode_id_for_file_path(conn: &Connection, path: &str) -> Result<Option<i64>> {
    let id = conn
        .query_row("SELECT episode_id FROM episode_files WHERE path=?1", [path], |r| r.get::<_, i64>(0))
        .optional()?;
    Ok(id)
}

/// Move every file of `from` onto `into`, then delete the now-empty episode row.
fn merge_episodes(conn: &Connection, from: i64, into: i64) -> Result<()> {
    if from == into {
        return Ok(());
    }
    conn.execute("UPDATE OR IGNORE episode_files SET episode_id=?2 WHERE episode_id=?1", params![from, into])?;
    conn.execute("DELETE FROM episodes WHERE id=?1", [from])?;
    Ok(())
}

/// Resolve the canonical episode row for a freshly-scanned file, handling season
/// regrouping (move) and duplicate-quality merges. Returns the episode id; the
/// caller then registers the physical file via [`add_episode_file`].
pub fn find_or_create_episode(
    conn: &Connection,
    show_id: i64,
    season: i64,
    episode: i64,
    path: &str,
) -> Result<i64> {
    let target = find_episode_id(conn, show_id, season, episode)?;
    let existing = episode_id_for_file_path(conn, path)?;
    let id = match (target, existing) {
        (Some(t), Some(old)) => {
            // file already known under a different episode → merge into the grouped one
            merge_episodes(conn, old, t)?;
            t
        }
        (Some(t), None) => t,
        (None, Some(old)) => {
            // grouped show has no such episode yet → just move the existing one over
            conn.execute(
                "UPDATE episodes SET show_id=?2, season=?3, episode=?4 WHERE id=?1",
                params![old, show_id, season, episode],
            )?;
            old
        }
        (None, None) => {
            conn.execute(
                "INSERT INTO episodes(show_id, season, episode, path, added_at) VALUES(?1,?2,?3,?4,?5)",
                params![show_id, season, episode, path, now()],
            )?;
            conn.last_insert_rowid()
        }
    };
    Ok(id)
}

pub fn add_episode_file(conn: &Connection, episode_id: i64, path: &str) -> Result<()> {
    conn.execute(
        "INSERT OR IGNORE INTO episode_files(episode_id, path, added_at) VALUES(?1,?2,?3)",
        params![episode_id, path, now()],
    )?;
    Ok(())
}

/// All physical files of an episode, best quality first.
pub fn episode_files(conn: &Connection, episode_id: i64) -> Result<Vec<EpisodeFile>> {
    let mut stmt = conn.prepare(
        "SELECT id, episode_id, path, width, height, added_at FROM episode_files
         WHERE episode_id=?1 ORDER BY COALESCE(height,0) DESC, COALESCE(width,0) DESC, id",
    )?;
    let rows = stmt
        .query_map([episode_id], |r| {
            Ok(EpisodeFile {
                id: r.get(0)?,
                episode_id: r.get(1)?,
                path: r.get(2)?,
                width: r.get(3)?,
                height: r.get(4)?,
                added_at: r.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn all_episode_file_paths(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT path FROM episode_files")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn delete_episode_file_by_path(conn: &Connection, path: &str) -> Result<()> {
    conn.execute("DELETE FROM episode_files WHERE path=?1", [path])?;
    Ok(())
}

pub fn episode_files_missing_dims(conn: &Connection) -> Result<Vec<(i64, String)>> {
    // width=0 marks an earlier FAILED probe (e.g. broken ffprobe path) — retry those
    // too, so the library heals itself once the tools work again.
    let mut stmt = conn
        .prepare("SELECT id, path FROM episode_files WHERE width IS NULL OR height IS NULL OR width=0 OR height=0")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_episode_file_dims(conn: &Connection, file_id: i64, w: i64, h: i64) -> Result<()> {
    conn.execute("UPDATE episode_files SET width=?2, height=?3 WHERE id=?1", params![file_id, w, h])?;
    Ok(())
}

/// Point every episode's primary path/width/height at its best-quality file.
pub fn set_all_episode_primaries(conn: &Connection) -> Result<()> {
    conn.execute(
        "UPDATE episodes SET
            path   = COALESCE((SELECT f.path   FROM episode_files f WHERE f.episode_id=episodes.id
                               ORDER BY COALESCE(f.height,0) DESC, COALESCE(f.width,0) DESC, f.id LIMIT 1), path),
            width  = (SELECT f.width  FROM episode_files f WHERE f.episode_id=episodes.id
                               ORDER BY COALESCE(f.height,0) DESC, COALESCE(f.width,0) DESC, f.id LIMIT 1),
            height = (SELECT f.height FROM episode_files f WHERE f.episode_id=episodes.id
                               ORDER BY COALESCE(f.height,0) DESC, COALESCE(f.width,0) DESC, f.id LIMIT 1)
         WHERE EXISTS (SELECT 1 FROM episode_files f WHERE f.episode_id=episodes.id)",
        [],
    )?;
    Ok(())
}

pub fn list_episodes(conn: &Connection, show_id: i64) -> Result<Vec<Episode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS},
            (SELECT COUNT(*) FROM episode_files f WHERE f.episode_id = episodes.id) AS fc
         FROM episodes WHERE show_id = ?1 ORDER BY season, episode"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([show_id], |r| {
            let mut e = map_episode(r)?;
            e.file_count = r.get(15)?;
            Ok(e)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn get_episode(conn: &Connection, id: i64) -> Result<Option<Episode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS} FROM episodes WHERE id = ?1"
    );
    let mut ep = match conn.query_row(&sql, [id], map_episode).optional()? {
        Some(e) => e,
        None => return Ok(None),
    };
    ep.show_title = conn
        .query_row("SELECT title FROM shows WHERE id = ?1", [ep.show_id], |r| r.get::<_, String>(0))
        .optional()?;
    // fall back to the show's manual intro window when the episode has none
    if ep.intro_start.is_none() || ep.intro_end.is_none() {
        let show_intro: Option<(Option<f64>, Option<f64>)> = conn
            .query_row(
                "SELECT intro_start, intro_end FROM shows WHERE id = ?1",
                [ep.show_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;
        if let Some((Some(s), Some(e))) = show_intro {
            ep.intro_start = Some(s);
            ep.intro_end = Some(e);
        }
    }
    Ok(Some(ep))
}

/// Search episodes by title (for the library search page).
pub fn search_episodes(conn: &Connection, q: &str, limit: i64) -> Result<Vec<Episode>> {
    let sql = format!(
        "SELECT {EPISODE_COLS}, 0 AS fc FROM episodes
         WHERE title LIKE '%' || ?1 || '%' ORDER BY show_id, season, episode LIMIT ?2"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt
        .query_map(params![q, limit], |r| map_episode(r))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for ep in rows.iter_mut() {
        ep.show_title = conn
            .query_row("SELECT title FROM shows WHERE id = ?1", [ep.show_id], |r| r.get::<_, String>(0))
            .optional()?;
    }
    Ok(rows)
}

pub fn distinct_seasons(conn: &Connection, show_id: i64) -> Result<Vec<i64>> {
    let mut stmt =
        conn.prepare("SELECT DISTINCT season FROM episodes WHERE show_id = ?1 ORDER BY season")?;
    let rows = stmt
        .query_map([show_id], |r| r.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn update_episode_meta(
    conn: &Connection,
    show_id: i64,
    season: i64,
    episode: i64,
    title: Option<&str>,
    overview: Option<&str>,
    still_path: Option<&str>,
    air_date: Option<&str>,
    runtime: Option<i64>,
) -> Result<()> {
    conn.execute(
        "UPDATE episodes SET title=?4, overview=?5,
            still_path=CASE WHEN still_locked=1 THEN still_path ELSE ?6 END,
            air_date=?7, runtime=?8
         WHERE show_id=?1 AND season=?2 AND episode=?3",
        params![show_id, season, episode, title, overview, still_path, air_date, runtime],
    )?;
    Ok(())
}

pub fn set_episode_numbers(conn: &Connection, id: i64, season: i64, episode: i64) -> Result<()> {
    conn.execute(
        "UPDATE episodes SET season=?2, episode=?3 WHERE id=?1",
        params![id, season, episode],
    )?;
    Ok(())
}

// ===== resolution / quality =====

/// (id, path) for every movie whose real resolution hasn't been read yet.
pub fn movies_missing_dims(conn: &Connection) -> Result<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, path FROM movies WHERE width IS NULL OR height IS NULL OR width=0 OR height=0")?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

pub fn set_movie_dims(conn: &Connection, id: i64, w: i64, h: i64) -> Result<()> {
    conn.execute("UPDATE movies SET width=?2, height=?3 WHERE id=?1", params![id, w, h])?;
    Ok(())
}

// ===== artwork (Plex-style manual override) =====

/// Set + lock a movie image. `field` = "poster" | "backdrop".
pub fn set_movie_art(conn: &Connection, id: i64, field: &str, path: &str) -> Result<()> {
    let sql = match field {
        "backdrop" => "UPDATE movies SET backdrop_path=?2, backdrop_locked=1 WHERE id=?1",
        _ => "UPDATE movies SET poster_path=?2, poster_locked=1 WHERE id=?1",
    };
    conn.execute(sql, params![id, path])?;
    Ok(())
}

/// Set + lock a show image. `field` = "poster" | "backdrop".
pub fn set_show_art(conn: &Connection, id: i64, field: &str, path: &str) -> Result<()> {
    let sql = match field {
        "backdrop" => "UPDATE shows SET backdrop_path=?2, backdrop_locked=1 WHERE id=?1",
        _ => "UPDATE shows SET poster_path=?2, poster_locked=1 WHERE id=?1",
    };
    conn.execute(sql, params![id, path])?;
    Ok(())
}

/// Set + lock an episode still image.
pub fn set_episode_art(conn: &Connection, id: i64, path: &str) -> Result<()> {
    conn.execute(
        "UPDATE episodes SET still_path=?2, still_locked=1 WHERE id=?1",
        params![id, path],
    )?;
    Ok(())
}

pub fn set_season_art(conn: &Connection, show_id: i64, season: i64, path: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO season_art(show_id, season, poster_path) VALUES(?1,?2,?3)
         ON CONFLICT(show_id, season) DO UPDATE SET poster_path=excluded.poster_path",
        params![show_id, season, path],
    )?;
    Ok(())
}

/// (season, poster_path) pairs for a show's custom season posters.
pub fn season_art(conn: &Connection, show_id: i64) -> Result<Vec<(i64, String)>> {
    let mut stmt = conn.prepare(
        "SELECT season, poster_path FROM season_art WHERE show_id=?1 AND poster_path IS NOT NULL",
    )?;
    let rows = stmt
        .query_map([show_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ===== progress =====

#[allow(clippy::too_many_arguments)]
pub fn upsert_progress(conn: &Connection, p: &Progress) -> Result<()> {
    conn.execute(
        "INSERT INTO progress(profile_id, media_type, ref_id, tmdb_id, season, episode, position_sec, duration_sec, watched, updated_at)
         VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET
            tmdb_id=excluded.tmdb_id, season=excluded.season, episode=excluded.episode,
            position_sec=excluded.position_sec, duration_sec=excluded.duration_sec,
            watched=excluded.watched, updated_at=excluded.updated_at",
        params![
            p.profile_id, p.media_type, p.ref_id, p.tmdb_id, p.season, p.episode,
            p.position_sec, p.duration_sec, p.watched as i64, p.updated_at
        ],
    )?;
    Ok(())
}

fn map_progress(r: &rusqlite::Row) -> rusqlite::Result<Progress> {
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
}

const PROGRESS_COLS: &str =
    "profile_id, media_type, ref_id, tmdb_id, season, episode, position_sec, duration_sec, watched, updated_at";

pub fn get_progress(conn: &Connection, profile_id: &str, media_type: &str, ref_id: i64) -> Result<Option<Progress>> {
    let sql = format!(
        "SELECT {PROGRESS_COLS} FROM progress WHERE profile_id=?1 AND media_type=?2 AND ref_id=?3"
    );
    let p = conn.query_row(&sql, params![profile_id, media_type, ref_id], map_progress).optional()?;
    Ok(p)
}

pub fn list_progress(conn: &Connection, profile_id: &str) -> Result<Vec<Progress>> {
    let sql = format!("SELECT {PROGRESS_COLS} FROM progress WHERE profile_id=?1");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map([profile_id], map_progress)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(rows)
}

// ===== sync lookups =====

pub fn find_movie_by_tmdb(conn: &Connection, tmdb_id: i64) -> Result<Option<i64>> {
    let id = conn
        .query_row("SELECT id FROM movies WHERE tmdb_id = ?1", [tmdb_id], |r| r.get::<_, i64>(0))
        .optional()?;
    Ok(id)
}

pub fn find_episode_by_show_tmdb(
    conn: &Connection,
    show_tmdb: i64,
    season: i64,
    episode: i64,
) -> Result<Option<i64>> {
    let id = conn
        .query_row(
            "SELECT e.id FROM episodes e JOIN shows s ON s.id = e.show_id
             WHERE s.tmdb_id = ?1 AND e.season = ?2 AND e.episode = ?3",
            params![show_tmdb, season, episode],
            |r| r.get::<_, i64>(0),
        )
        .optional()?;
    Ok(id)
}

/// (season, episode, show_tmdb_id) for an episode, used to enrich progress for sync.
pub fn episode_sync_coords(conn: &Connection, episode_id: i64) -> Result<Option<(i64, i64, Option<i64>)>> {
    let row = conn
        .query_row(
            "SELECT e.season, e.episode, s.tmdb_id FROM episodes e JOIN shows s ON s.id = e.show_id
             WHERE e.id = ?1",
            [episode_id],
            |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, Option<i64>>(2)?)),
        )
        .optional()?;
    Ok(row)
}

pub fn movie_tmdb(conn: &Connection, movie_id: i64) -> Result<Option<i64>> {
    let id = conn
        .query_row("SELECT tmdb_id FROM movies WHERE id = ?1", [movie_id], |r| {
            r.get::<_, Option<i64>>(0)
        })
        .optional()?
        .flatten();
    Ok(id)
}

/// Items the user has started but not finished, newest first.
pub fn continue_watching(conn: &Connection, profile_id: &str) -> Result<Vec<ContinueItem>> {
    let mut items: Vec<ContinueItem> = Vec::new();

    // Movies in progress
    let mut stmt = conn.prepare(
        "SELECT p.ref_id, m.title, m.poster_path, m.backdrop_path, p.position_sec, p.duration_sec, p.updated_at
         FROM progress p JOIN movies m ON m.id = p.ref_id
         WHERE p.profile_id = ?1 AND p.media_type = 'movie' AND p.watched = 0
           AND p.position_sec > 30 AND (p.duration_sec = 0 OR p.position_sec < p.duration_sec * 0.95)",
    )?;
    let movie_rows = stmt.query_map([profile_id], |r| {
        let pos: f64 = r.get(4)?;
        let dur: f64 = r.get(5)?;
        Ok(ContinueItem {
            media_type: "movie".into(),
            ref_id: r.get(0)?,
            title: r.get(1)?,
            subtitle: None,
            poster_path: r.get(2)?,
            backdrop_path: r.get(3)?,
            position_sec: pos,
            duration_sec: dur,
            progress: if dur > 0.0 { pos / dur } else { 0.0 },
            updated_at: r.get(6)?,
            show_id: None,
            season: None,
            episode: None,
        })
    })?;
    for row in movie_rows {
        items.push(row?);
    }

    // Episodes in progress
    let mut stmt = conn.prepare(
        "SELECT p.ref_id, s.title, s.poster_path, s.backdrop_path, p.position_sec, p.duration_sec,
                p.updated_at, e.season, e.episode, e.show_id, e.title
         FROM progress p
         JOIN episodes e ON e.id = p.ref_id
         JOIN shows s ON s.id = e.show_id
         WHERE p.profile_id = ?1 AND p.media_type = 'episode' AND p.watched = 0
           AND p.position_sec > 30 AND (p.duration_sec = 0 OR p.position_sec < p.duration_sec * 0.95)",
    )?;
    let ep_rows = stmt.query_map([profile_id], |r| {
        let pos: f64 = r.get(4)?;
        let dur: f64 = r.get(5)?;
        let season: i64 = r.get(7)?;
        let episode: i64 = r.get(8)?;
        let ep_title: Option<String> = r.get(10)?;
        let sub = match ep_title {
            Some(t) => format!("S{season:02} E{episode:02} · {t}"),
            None => format!("S{season:02} E{episode:02}"),
        };
        Ok(ContinueItem {
            media_type: "episode".into(),
            ref_id: r.get(0)?,
            title: r.get(1)?,
            subtitle: Some(sub),
            poster_path: r.get(2)?,
            backdrop_path: r.get(3)?,
            position_sec: pos,
            duration_sec: dur,
            progress: if dur > 0.0 { pos / dur } else { 0.0 },
            updated_at: r.get(6)?,
            show_id: Some(r.get(9)?),
            season: Some(season),
            episode: Some(episode),
        })
    })?;
    for row in ep_rows {
        items.push(row?);
    }

    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(items)
}

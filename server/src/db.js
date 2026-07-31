// SQLite storage via Node's built-in node:sqlite — zero native dependencies,
// which keeps the Docker build 100 % reproducible (no npm install at all).
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const DATA_DIR = process.env.DATA_DIR || "/data";

let db;

export function openDb() {
  if (db) return db;
  const file = `${DATA_DIR}/ghgflix.db`;
  mkdirSync(dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS shows (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER,
      tmdb_id INTEGER,
      overview TEXT,
      poster TEXT,
      backdrop TEXT,
      genres TEXT,
      rating REAL,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS episodes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL,
      title TEXT,
      overview TEXT,
      still TEXT,
      path TEXT NOT NULL UNIQUE,
      duration REAL,
      vcodec TEXT, acodec TEXT, container TEXT, width INTEGER, height INTEGER,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      year INTEGER,
      tmdb_id INTEGER,
      overview TEXT,
      poster TEXT,
      backdrop TEXT,
      genres TEXT,
      rating REAL,
      path TEXT NOT NULL UNIQUE,
      duration REAL,
      vcodec TEXT, acodec TEXT, container TEXT, width INTEGER, height INTEGER,
      added_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      avatar TEXT,
      supabase_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS progress (
      profile_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie','episode')),
      ref_id INTEGER NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      watched INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, media_type, ref_id)
    );
    -- progress rows that arrived (sync/import) for media we have not scanned
    -- yet — applied automatically after the next library scan
    CREATE TABLE IF NOT EXISTS pending_progress (
      profile_id INTEGER NOT NULL,
      media_type TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      season INTEGER NOT NULL DEFAULT -1,
      episode INTEGER NOT NULL DEFAULT -1,
      position REAL NOT NULL DEFAULT 0,
      duration REAL NOT NULL DEFAULT 0,
      watched INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (profile_id, media_type, tmdb_id, season, episode)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    -- "Meine Liste" / favorites (Netflix-style, per profile)
    CREATE TABLE IF NOT EXISTS favorites (
      profile_id INTEGER NOT NULL,
      media_type TEXT NOT NULL CHECK (media_type IN ('movie','show')),
      ref_id INTEGER NOT NULL,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (profile_id, media_type, ref_id)
    );
    -- media folders the scanner walks, managed from the web UI (Einstellungen
    -- → Bibliotheken) — any number of them, e.g. one per drive
    CREATE TABLE IF NOT EXISTS libraries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL CHECK (kind IN ('show','movie')),
      name TEXT,
      added_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_episodes_show ON episodes(show_id, season, episode);
    CREATE INDEX IF NOT EXISTS idx_progress_updated ON progress(updated_at);
    -- desktop-app parity: remembered manual TMDb assignments (survive rebuilds)
    CREATE TABLE IF NOT EXISTS identity_map (
      folder TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('movie','show')),
      tmdb_id INTEGER NOT NULL,
      PRIMARY KEY (folder, kind)
    );
    -- per-season poster override (Plex-style artwork picker)
    CREATE TABLE IF NOT EXISTS season_art (
      show_id INTEGER NOT NULL,
      season INTEGER NOT NULL,
      path TEXT NOT NULL,
      PRIMARY KEY (show_id, season)
    );
    -- ── Desktop-Parität (siehe src-tauri/src/db.rs) ────────────────────────
    -- Gemerkte manuelle Zuordnungen NACH STABILEM KEY (nicht nach Ordnerpfad).
    -- Der Ordner kann umbenannt/verschoben werden — der Key aus dem Titel
    -- bleibt gleich, deshalb überlebt die Zuordnung auch "neu aufbauen".
    CREATE TABLE IF NOT EXISTS identity_keys (
      key TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('movie','tv')),
      tmdb_id INTEGER NOT NULL,
      PRIMARY KEY (key, kind)
    );
    -- Stabile Gruppierungs-Keys einer Serie (eine Serie kann mehrere haben,
    -- z. B. wenn Ordner unterschiedlich heißen: "Daredevil", "Marvel's Daredevil")
    CREATE TABLE IF NOT EXISTS show_keys (
      key TEXT NOT NULL PRIMARY KEY,
      show_id INTEGER NOT NULL REFERENCES shows(id) ON DELETE CASCADE
    );
    -- Pro-Datei-Platzierung: "diese Datei gehört zu TMDb-Serie X als SxxEyy".
    -- Wird bei JEDEM Scan neu angewandt und schlägt die automatische Erkennung.
    CREATE TABLE IF NOT EXISTS placements (
      path TEXT NOT NULL PRIMARY KEY,
      show_tmdb INTEGER NOT NULL,
      season INTEGER NOT NULL,
      episode INTEGER NOT NULL
    );
    -- Mehrere Dateien (Qualitäten) derselben Folge — Desktop-Modell.
    -- episodes.path bleibt die "beste" Datei, damit alter Code weiterläuft.
    CREATE TABLE IF NOT EXISTS episode_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
      path TEXT NOT NULL UNIQUE,
      width INTEGER, height INTEGER, duration REAL,
      vcodec TEXT, acodec TEXT, container TEXT,
      added_at INTEGER NOT NULL
    );
    -- Trickplay: vorgenerierte Sprite-Sheets für die Zeitleisten-Vorschau
    -- (wie Plex' "trickplay" / Jellyfins Trickplay-Plugin).
    CREATE TABLE IF NOT EXISTS trickplay (
      path TEXT NOT NULL PRIMARY KEY,
      interval INTEGER NOT NULL,
      tile_w INTEGER NOT NULL,
      tile_h INTEGER NOT NULL,
      cols INTEGER NOT NULL,
      rows INTEGER NOT NULL,
      count INTEGER NOT NULL,
      sheets INTEGER NOT NULL DEFAULT 1,
      file TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // column migrations for desktop-app parity (safe to re-run)
  const addCol = (table, ddl) => {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`); } catch { /* exists */ }
  };
  addCol("shows", "cert TEXT");
  addCol("shows", "status TEXT");
  addCol("shows", "last_year INTEGER");
  addCol("shows", "runtime INTEGER");
  addCol("shows", "intro_start REAL");
  addCol("shows", "intro_end REAL");
  addCol("shows", "identified INTEGER NOT NULL DEFAULT 0");
  addCol("shows", "folder TEXT");
  addCol("movies", "cert TEXT");
  addCol("movies", "runtime_min INTEGER");
  addCol("movies", "identified INTEGER NOT NULL DEFAULT 0");
  addCol("episodes", "air_date TEXT");
  addCol("episodes", "runtime INTEGER");
  addCol("episodes", "intro_start REAL");
  addCol("episodes", "intro_end REAL");
  // ── Bilder (Vorschau) ──
  // local_* = Bilddatei AUF DER PLATTE (poster.jpg/fanart.jpg neben dem Film,
  // wie Plex/Jellyfin) bzw. ein aus dem Video erzeugtes Standbild. Hat Vorrang
  // vor TMDb, wenn der Nutzer eigene Bilder hinlegt.
  addCol("shows", "local_poster TEXT");
  addCol("shows", "local_backdrop TEXT");
  addCol("shows", "logo TEXT");
  addCol("movies", "local_poster TEXT");
  addCol("movies", "local_backdrop TEXT");
  addCol("movies", "logo TEXT");
  addCol("episodes", "local_still TEXT");
  // aus dem Video erzeugtes Standbild (Jellyfin-Stil), damit wir es beim
  // nächsten Scan nicht erneut extrahieren
  addCol("episodes", "still_generated INTEGER NOT NULL DEFAULT 0");
  // Mehrteiler: "S01E01-E02" → episode=1, episode_end=2
  addCol("episodes", "episode_end INTEGER");
  // echtes Seitenverhältnis (für die Vorschau-Kachel und die Qualitätsanzeige)
  addCol("episodes", "aspect REAL");
  addCol("movies", "aspect REAL");
  // Serien-Gruppierungsschlüssel direkt an der Zeile (schneller als Join)
  addCol("shows", "show_key TEXT");
  addCol("shows", "overview_de TEXT");
  // Ton- und Untertitelspuren als JSON, damit ffprobe nicht bei jedem
  // Abspielen erneut laufen muss (siehe src/spuren.js)
  addCol("movies", "tracks TEXT");
  addCol("episodes", "tracks TEXT");
  // Reihenfolge/Extras
  addCol("movies", "tagline TEXT");
  addCol("shows", "tagline TEXT");
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_shows_tmdb ON shows(tmdb_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_movies_tmdb ON movies(tmdb_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_movies_path ON movies(path)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_episodes_path ON episodes(path)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_favorites_profile ON favorites(profile_id)");
    db.exec("CREATE INDEX IF NOT EXISTS idx_progress_profile ON progress(profile_id, media_type, ref_id)");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_show_keys_show ON show_keys(key)");
  } catch { /* ältere SQLite-Version — Indizes sind optional */ }
  // Einmalige Migration: alte identity_map (nach Ordnerpfad) bleibt bestehen,
  // wird aber zusätzlich als Key abgelegt, damit Umbenennungen sie nicht mehr
  // wertlos machen. Passiert lazy im Scanner (dort ist der Parser verfügbar).
  // default profile so everything works out of the box
  const n = db.prepare("SELECT COUNT(*) c FROM profiles").get().c;
  if (n === 0) {
    db.prepare("INSERT INTO profiles (name, created_at) VALUES (?, ?)").run("Standard", Date.now());
  }
  // zero-config seed: if no libraries were added yet, pick up the legacy
  // SHOWS_DIRS/MOVIES_DIRS env vars for whichever of them actually exist on
  // disk. Everything past this point is normally managed in the web UI.
  const libCount = db.prepare("SELECT COUNT(*) c FROM libraries").get().c;
  if (libCount === 0) {
    const insertLib = db.prepare("INSERT OR IGNORE INTO libraries (path, kind, added_at) VALUES (?,?,?)");
    const seed = (envName, kind) =>
      (process.env[envName] || "")
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter((p) => p && existsSync(p))
        .forEach((p) => insertLib.run(p, kind, Date.now()));
    seed("SHOWS_DIRS", "show");
    seed("MOVIES_DIRS", "movie");
  }
  // `db` ist oben bereits gesetzt, openDb() ist also wiedereintrittsfähig —
  // die Migration darf getSetting/setSetting gefahrlos benutzen.
  migrateTextProfiles(db);
  return db;
}

export function listLibraries(kind) {
  const d = openDb();
  return kind
    ? d.prepare("SELECT * FROM libraries WHERE kind = ? ORDER BY path").all(kind)
    : d.prepare("SELECT * FROM libraries ORDER BY kind, path").all();
}

export function addLibrary(path, kind, name = null) {
  const d = openDb();
  d.prepare(
    "INSERT INTO libraries (path, kind, name, added_at) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET kind=excluded.kind, name=excluded.name",
  ).run(path, kind, name, Date.now());
  return d.prepare("SELECT * FROM libraries WHERE path = ?").get(path);
}

export function removeLibrary(id) {
  const d = openDb();
  const row = d.prepare("SELECT * FROM libraries WHERE id = ?").get(id);
  if (row) d.prepare("DELETE FROM libraries WHERE id = ?").run(id);
  return row;
}

// ── Profil-Auflösung ────────────────────────────────────────────────────────
//
// DER FEHLER, DEN DAS HIER BEHEBT:
// Die Weboberfläche (und damit Fernseher + Handy-Browser) benutzt dieselbe
// React-App wie der Desktop und schickt die Profil-ID "local" — einen TEXT.
// Der Server führt seine Profile aber als ZAHLEN. Dadurch:
//   * schrieb die Weboberfläche den Fortschritt unter profile_id = 'local'
//   * der Cloud-Abgleich verbindet progress mit profiles.id (Zahl) → kein
//     Treffer → "0 gesendet"
//   * aus der Cloud geholte Daten landeten unter der ZAHL → die Weboberfläche
//     las weiter 'local' → "0 empfangen" und am Fernseher blieb alles leer.
// Beides verschwindet, sobald jede Text-ID auf ein echtes Profil zeigt.

/** Numerische ID des Profils, das für nicht-numerische IDs einspringt. */
function fallbackProfileId(db) {
  const linked = db.prepare("SELECT id FROM profiles WHERE supabase_id IS NOT NULL ORDER BY id LIMIT 1").get();
  if (linked) return linked.id;
  const first = db.prepare("SELECT id FROM profiles ORDER BY id LIMIT 1").get();
  if (first) return first.id;
  const info = db.prepare("INSERT INTO profiles (name, created_at) VALUES (?,?)").run("Standard", Date.now());
  return Number(info.lastInsertRowid);
}

/**
 * Jede von außen kommende Profil-ID auf eine echte Profilzeile abbilden.
 * Zahlen bleiben Zahlen; "local" & Co. landen beim Standardprofil.
 */
export function resolveProfile(raw) {
  const db = openDb();
  const s = String(raw ?? "").trim();
  if (/^\d+$/.test(s)) {
    const hit = db.prepare("SELECT id FROM profiles WHERE id = ?").get(Number(s));
    if (hit) return String(hit.id);
  }
  return String(fallbackProfileId(db));
}

/**
 * Einmalige Bereinigung: Zeilen, die unter einer Text-Profil-ID gelandet sind,
 * dem Standardprofil zuschlagen. Ohne das bliebe der bisher in der
 * Weboberfläche gesammelte Fortschritt für immer unsichtbar.
 */
function migrateTextProfiles(db) {
  if (getSetting("profile_ids_migrated") === "1") return;
  const target = fallbackProfileId(db);
  let moved = 0;
  for (const table of ["progress", "favorites"]) {
    let rows = [];
    try {
      rows = db.prepare(`SELECT DISTINCT profile_id FROM ${table}`).all();
    } catch {
      continue;
    }
    for (const r of rows) {
      const pid = String(r.profile_id);
      if (/^\d+$/.test(pid) && db.prepare("SELECT 1 FROM profiles WHERE id=?").get(Number(pid))) continue;
      const res = db.prepare(`UPDATE OR IGNORE ${table} SET profile_id=? WHERE profile_id=?`).run(target, pid);
      moved += res.changes;
      // Reste, die wegen des Eindeutigkeits-Schlüssels nicht umziehen konnten
      db.prepare(`DELETE FROM ${table} WHERE profile_id=?`).run(pid);
    }
  }
  // pending_progress ebenfalls
  try {
    db.prepare("UPDATE OR IGNORE pending_progress SET profile_id=? WHERE profile_id NOT GLOB '[0-9]*'").run(target);
    db.prepare("DELETE FROM pending_progress WHERE profile_id NOT GLOB '[0-9]*'").run();
  } catch { /* Tabelle evtl. leer */ }
  if (moved > 0) console.log(`[db] ${moved} Fortschritts-/Favoriten-Einträge dem Profil ${target} zugeordnet`);
  setSetting("profile_ids_migrated", "1");
}

// ── Serien-Gruppierungsschlüssel (Desktop-Parität) ──────────────────────────

/** Serie zu einem stabilen Key finden. */
export const showIdForKey = (key) =>
  openDb().prepare("SELECT show_id FROM show_keys WHERE key = ?").get(key)?.show_id ?? null;

/** Key an eine Serie hängen, wenn er noch frei ist (idempotent). */
export function setShowKeyIfAbsent(key, showId) {
  if (!key) return;
  openDb().prepare("INSERT OR IGNORE INTO show_keys (key, show_id) VALUES (?, ?)").run(key, showId);
}

/** Alle Keys einer Serie (für gemerkte Zuordnungen). */
export const keysForShow = (showId) =>
  openDb().prepare("SELECT key FROM show_keys WHERE show_id = ?").all(showId).map((r) => r.key);

/** Keys einer verschwundenen Serie auf die überlebende umbiegen. */
export const moveShowKeys = (fromId, toId) =>
  openDb().prepare("UPDATE OR IGNORE show_keys SET show_id = ? WHERE show_id = ?").run(toId, fromId);

// ── gemerkte manuelle Zuordnungen ───────────────────────────────────────────

export const identityOverride = (kind, key) =>
  openDb().prepare("SELECT tmdb_id FROM identity_keys WHERE kind = ? AND key = ?").get(kind, key)?.tmdb_id ?? null;

export function rememberIdentityKey(kind, key, tmdbId) {
  if (!key) return;
  openDb()
    .prepare(
      "INSERT INTO identity_keys (key, kind, tmdb_id) VALUES (?,?,?) ON CONFLICT(key,kind) DO UPDATE SET tmdb_id=excluded.tmdb_id",
    )
    .run(key, kind, tmdbId);
}

export const forgetIdentityKey = (kind, key) =>
  openDb().prepare("DELETE FROM identity_keys WHERE kind = ? AND key = ?").run(kind, key);

// ── Pro-Datei-Platzierungen ─────────────────────────────────────────────────

export const placementFor = (path) =>
  openDb().prepare("SELECT show_tmdb, season, episode FROM placements WHERE path = ?").get(path) ?? null;

export const setPlacement = (path, showTmdb, season, episode) =>
  openDb()
    .prepare(
      "INSERT INTO placements (path, show_tmdb, season, episode) VALUES (?,?,?,?) ON CONFLICT(path) DO UPDATE SET show_tmdb=excluded.show_tmdb, season=excluded.season, episode=excluded.episode",
    )
    .run(path, showTmdb, season, episode);

export const getSetting = (key) => openDb().prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
export const setSetting = (key, value) =>
  openDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));

/** Setting with env-var fallback (env wins only when the setting is unset). */
export const settingOr = (key, envName, def = null) => getSetting(key) ?? process.env[envName] ?? def;

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
  `);
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

export const getSetting = (key) => openDb().prepare("SELECT value FROM settings WHERE key = ?").get(key)?.value ?? null;
export const setSetting = (key, value) =>
  openDb().prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));

/** Setting with env-var fallback (env wins only when the setting is unset). */
export const settingOr = (key, envName, def = null) => getSetting(key) ?? process.env[envName] ?? def;

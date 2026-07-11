// Library scanner: walks every folder registered in the `libraries` table
// (managed from the web UI → Einstellungen → Bibliotheken — any number of
// them, e.g. one per drive), parses names, enriches with TMDb and probes
// codecs (for the direct-play decision).
import { readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { openDb, listLibraries } from "./db.js";
import { isVideo, parseEpisode, parseSeasonFolder, showTitleFromFile, parseMovie, cleanTitle, extractYear } from "./parser.js";
import { ffprobe } from "./stream.js";
import * as tmdb from "./tmdb.js";

export const scanState = { running: false, lastRun: 0, lastResult: "", shows: 0, movies: 0, episodes: 0 };

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Collect every video under a show root as {path, season, episode, epTitle}. */
function collectShowFiles(root) {
  const out = [];
  const walk = (dir, seasonHint) => {
    for (const e of listDir(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        walk(p, parseSeasonFolder(e.name) ?? seasonHint);
      } else if (e.isFile() && isVideo(e.name)) {
        const parsed = parseEpisode(e.name);
        const season = parsed?.season ?? seasonHint ?? 1;
        if (parsed?.episode != null) out.push({ path: p, season, episode: parsed.episode, epTitle: parsed.title });
      }
    }
  };
  walk(root, null);
  return out;
}

async function scanShows(db, now) {
  for (const lib of listLibraries("show")) {
    const rootDir = lib.path;
    for (const entry of listDir(rootDir)) {
      if (!entry.isDirectory()) continue;
      const showDir = join(rootDir, entry.name);
      const files = collectShowFiles(showDir);
      if (files.length === 0) continue;

      const title = cleanTitle(entry.name) || entry.name;
      const year = extractYear(entry.name);
      let show = db.prepare("SELECT * FROM shows WHERE title = ?").get(title);
      if (!show) {
        const info = db
          .prepare("INSERT INTO shows (title, year, added_at) VALUES (?, ?, ?)")
          .run(title, year, now);
        show = { id: Number(info.lastInsertRowid), title, tmdb_id: null };
      }
      // TMDb enrich once per show
      if (!show.tmdb_id && tmdb.tmdbEnabled()) {
        const hit = await tmdb.searchShow(title, year);
        if (hit) {
          const det = await tmdb.showDetails(hit.id);
          db.prepare(
            "UPDATE shows SET tmdb_id=?, overview=?, poster=?, backdrop=?, genres=?, rating=?, year=COALESCE(year, ?) WHERE id=?",
          ).run(
            hit.id,
            det?.overview ?? hit.overview ?? null,
            hit.poster_path ?? null,
            hit.backdrop_path ?? null,
            tmdb.genreNames(det),
            hit.vote_average ?? null,
            parseInt((hit.first_air_date || "").slice(0, 4), 10) || null,
            show.id,
          );
          show.tmdb_id = hit.id;
        }
      }

      const upsert = db.prepare(
        `INSERT INTO episodes (show_id, season, episode, title, path, added_at) VALUES (?,?,?,?,?,?)
         ON CONFLICT(path) DO UPDATE SET show_id=excluded.show_id, season=excluded.season, episode=excluded.episode`,
      );
      const seasons = new Set();
      for (const f of files) {
        upsert.run(show.id, f.season, f.episode, f.epTitle, f.path, now);
        seasons.add(f.season);
      }
      // episode titles/stills/overviews from TMDb, one call per season
      if (show.tmdb_id && tmdb.tmdbEnabled()) {
        for (const s of seasons) {
          const needs = db
            .prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=? AND season=? AND (still IS NULL OR overview IS NULL)")
            .get(show.id, s).c;
          if (!needs) continue;
          const det = await tmdb.seasonDetails(show.tmdb_id, s);
          for (const ep of det?.episodes ?? []) {
            db.prepare(
              "UPDATE episodes SET title=COALESCE(?, title), overview=?, still=? WHERE show_id=? AND season=? AND episode=?",
            ).run(ep.name ?? null, ep.overview ?? null, ep.still_path ?? null, show.id, s, ep.episode_number);
          }
        }
      }
    }
  }
}

async function scanMovies(db, now) {
  const addFile = db.prepare(
    "INSERT INTO movies (title, year, path, added_at) VALUES (?,?,?,?) ON CONFLICT(path) DO NOTHING",
  );
  const visit = (dir, depth) => {
    for (const e of listDir(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory() && depth < 3) visit(p, depth + 1);
      else if (e.isFile() && isVideo(e.name)) {
        // prefer folder name for "Movie (2019)/movie.mkv" layouts
        const fromFolder = depth > 0 ? parseMovie(basename(dir)) : null;
        const fromFile = parseMovie(e.name);
        const pick = fromFolder && fromFolder.year ? fromFolder : fromFile.title.length >= 2 ? fromFile : fromFolder || fromFile;
        addFile.run(pick.title, pick.year, p, now);
      }
    }
  };
  for (const lib of listLibraries("movie")) visit(lib.path, 0);

  // TMDb enrich new movies
  if (tmdb.tmdbEnabled()) {
    const missing = db.prepare("SELECT id, title, year FROM movies WHERE tmdb_id IS NULL").all();
    for (const m of missing) {
      const hit = await tmdb.searchMovie(m.title, m.year);
      if (!hit) continue;
      const det = await tmdb.movieDetails(hit.id);
      db.prepare(
        "UPDATE movies SET tmdb_id=?, title=COALESCE(?, title), overview=?, poster=?, backdrop=?, genres=?, rating=?, year=COALESCE(year, ?) WHERE id=?",
      ).run(
        hit.id,
        hit.title ?? null,
        det?.overview ?? hit.overview ?? null,
        hit.poster_path ?? null,
        hit.backdrop_path ?? null,
        tmdb.genreNames(det),
        hit.vote_average ?? null,
        parseInt((hit.release_date || "").slice(0, 4), 10) || null,
        m.id,
      );
    }
  }
}

/** Probe duration/codecs for files that don't have them yet (bounded per run). */
async function probeMissing(db, limit = 300) {
  const rows = [
    ...db.prepare("SELECT 'movie' t, id, path FROM movies WHERE duration IS NULL LIMIT ?").all(limit),
    ...db.prepare("SELECT 'episode' t, id, path FROM episodes WHERE duration IS NULL LIMIT ?").all(limit),
  ];
  for (const r of rows) {
    const info = await ffprobe(r.path);
    if (!info) continue;
    const table = r.t === "movie" ? "movies" : "episodes";
    db.prepare(`UPDATE ${table} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=? WHERE id=?`).run(
      info.duration,
      info.vcodec,
      info.acodec,
      info.container,
      info.width,
      info.height,
      r.id,
    );
  }
}

/** Progress that arrived for media we didn't have yet → attach it now. */
export function applyPendingProgress(db) {
  const rows = db.prepare("SELECT * FROM pending_progress").all();
  for (const p of rows) {
    let refId = null;
    if (p.media_type === "movie") {
      refId = db.prepare("SELECT id FROM movies WHERE tmdb_id = ?").get(p.tmdb_id)?.id ?? null;
    } else {
      refId = db
        .prepare("SELECT e.id FROM episodes e JOIN shows s ON s.id=e.show_id WHERE s.tmdb_id=? AND e.season=? AND e.episode=?")
        .get(p.tmdb_id, p.season, p.episode)?.id ?? null;
    }
    if (refId == null) continue;
    db.prepare(
      `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET
         position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
       WHERE excluded.updated_at > progress.updated_at`,
    ).run(p.profile_id, p.media_type, refId, p.position, p.duration, p.watched, p.updated_at);
    db.prepare(
      "DELETE FROM pending_progress WHERE profile_id=? AND media_type=? AND tmdb_id=? AND season=? AND episode=?",
    ).run(p.profile_id, p.media_type, p.tmdb_id, p.season, p.episode);
  }
}

/** A library folder was removed in the UI — drop everything scanned from it
 *  (the files themselves are untouched, only the DB entries go away).
 *  Compares with normalized slashes so it's robust regardless of OS. */
export function removeLibraryContent(libPath, kind) {
  const db = openDb();
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = norm(libPath) + "/";
  if (kind === "movie") {
    const del = db.prepare("DELETE FROM movies WHERE id = ?");
    for (const r of db.prepare("SELECT id, path FROM movies").all()) if (norm(r.path).startsWith(prefix)) del.run(r.id);
  } else {
    const del = db.prepare("DELETE FROM episodes WHERE id = ?");
    for (const r of db.prepare("SELECT id, path FROM episodes").all()) if (norm(r.path).startsWith(prefix)) del.run(r.id);
    db.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
  }
}

/** Remove library rows whose file disappeared from disk. */
function pruneMissing(db) {
  for (const table of ["movies", "episodes"]) {
    for (const r of db.prepare(`SELECT id, path FROM ${table}`).all()) {
      try {
        statSync(r.path);
      } catch {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(r.id);
      }
    }
  }
  db.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
}

// A scan request that arrives while one is already running is not dropped —
// it queues exactly one follow-up run, so e.g. adding a second library right
// after the first (both trigger scanLibrary()) is never silently missed
// until the next periodic rescan.
let rerunRequested = false;

export async function scanLibrary() {
  if (scanState.running) {
    rerunRequested = true;
    return;
  }
  scanState.running = true;
  const db = openDb();
  const now = Date.now();
  try {
    await scanShows(db, now);
    await scanMovies(db, now);
    pruneMissing(db);
    await probeMissing(db);
    applyPendingProgress(db);
    scanState.shows = db.prepare("SELECT COUNT(*) c FROM shows").get().c;
    scanState.episodes = db.prepare("SELECT COUNT(*) c FROM episodes").get().c;
    scanState.movies = db.prepare("SELECT COUNT(*) c FROM movies").get().c;
    scanState.lastResult = "ok";
    console.log(`[scan] ${scanState.shows} shows / ${scanState.episodes} episodes / ${scanState.movies} movies`);
  } catch (e) {
    scanState.lastResult = String(e);
    console.error("[scan] failed:", e);
  } finally {
    scanState.lastRun = Date.now();
    scanState.running = false;
    if (rerunRequested) {
      rerunRequested = false;
      void scanLibrary();
    }
  }
}

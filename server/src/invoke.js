// /api/invoke/<cmd> — the desktop app's ENTIRE Tauri command surface,
// re-implemented against the server's SQLite DB. This is what lets the
// unmodified desktop React UI run in the browser: src/lib/backend.ts routes
// every `invoke()` here, with identical argument and result shapes
// (camelCase, desktop types from src/lib/types.ts).
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, normalize, basename, dirname } from "node:path";
import { spawn } from "node:child_process";
import { openDb, getSetting, setSetting, listLibraries, addLibrary, removeLibrary, DATA_DIR } from "./db.js";
import { scanLibrary, scanState, removeLibraryContent, detectLibraries, primaryRoot, isSystemDir, applyPendingProgress } from "./scanner.js";
import { canDirectPlay, ffprobe } from "./stream.js";
import * as tmdb from "./tmdb.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const db = () => openDb();
const now = () => Date.now();

// ── row → desktop-shape mappers ──────────────────────────────────────────────

/** Desktop stores genres as a JSON array string; the server historically as
 *  "Action, Drama". Normalize to the desktop format. */
function genresJson(g) {
  if (!g) return null;
  if (typeof g === "string" && g.trim().startsWith("[")) return g;
  return JSON.stringify(String(g).split(",").map((s) => s.trim()).filter(Boolean));
}

function movieOut(r) {
  if (!r) return null;
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    year: r.year ?? null,
    tmdbId: r.tmdb_id ?? null,
    overview: r.overview ?? null,
    posterPath: r.poster ?? null,
    backdropPath: r.backdrop ?? null,
    genres: genresJson(r.genres),
    runtime: r.runtime_min ?? (r.duration ? Math.round(r.duration / 60) : null),
    rating: r.rating ?? null,
    addedAt: r.added_at,
    identified: !!(r.identified || r.tmdb_id),
    width: r.width ?? null,
    height: r.height ?? null,
    cert: r.cert ?? null,
  };
}

function showOut(r) {
  if (!r) return null;
  const c = db().prepare("SELECT COUNT(id) e, COUNT(DISTINCT season) s FROM episodes WHERE show_id=?").get(r.id);
  return {
    id: r.id,
    folder: r.folder ?? null,
    title: r.title,
    year: r.year ?? null,
    tmdbId: r.tmdb_id ?? null,
    overview: r.overview ?? null,
    posterPath: r.poster ?? null,
    backdropPath: r.backdrop ?? null,
    genres: genresJson(r.genres),
    rating: r.rating ?? null,
    addedAt: r.added_at,
    identified: !!(r.identified || r.tmdb_id),
    episodeCount: c?.e ?? 0,
    seasonCount: c?.s ?? 0,
    width: null,
    height: null,
    cert: r.cert ?? null,
    status: r.status ?? null,
    lastYear: r.last_year ?? null,
    runtime: r.runtime ?? null,
    introStart: r.intro_start ?? null,
    introEnd: r.intro_end ?? null,
  };
}

function episodeOut(r, showTitle = null) {
  if (!r) return null;
  return {
    id: r.id,
    showId: r.show_id,
    season: r.season,
    episode: r.episode,
    path: r.path,
    title: r.title ?? null,
    overview: r.overview ?? null,
    stillPath: r.still ?? null,
    airDate: r.air_date ?? null,
    runtime: r.runtime ?? (r.duration ? Math.round(r.duration / 60) : null),
    addedAt: r.added_at,
    introStart: r.intro_start ?? null,
    introEnd: r.intro_end ?? null,
    showTitle: showTitle ?? r.show_title ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    fileCount: 1,
  };
}

function progressOut(r) {
  return {
    profileId: String(r.profile_id),
    mediaType: r.media_type,
    refId: r.ref_id,
    positionSec: r.position,
    durationSec: r.duration,
    watched: !!r.watched,
    updatedAt: r.updated_at,
  };
}

const getEpisodeRow = (id) =>
  db()
    .prepare("SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=?")
    .get(id);

// ── identity map (remembered manual assignments, survives rebuilds) ─────────

const rememberIdentity = (folder, kind, tmdbId) =>
  db()
    .prepare("INSERT INTO identity_map (folder, kind, tmdb_id) VALUES (?,?,?) ON CONFLICT(folder,kind) DO UPDATE SET tmdb_id=excluded.tmdb_id")
    .run(folder, kind, tmdbId);

// ── TMDb enrichment helpers ──────────────────────────────────────────────────

async function enrichShow(showId, tmdbId) {
  const det = await tmdb.showDetails(tmdbId);
  if (!det) return;
  const cert = await tmdb.certification("tv", tmdbId).catch(() => null);
  db()
    .prepare(
      `UPDATE shows SET tmdb_id=?, title=COALESCE(?, title), overview=?, poster=?, backdrop=?, genres=?, rating=?,
        year=?, last_year=?, status=?, runtime=?, cert=?, identified=1 WHERE id=?`,
    )
    .run(
      tmdbId,
      det.name ?? null,
      det.overview ?? null,
      det.poster_path ?? null,
      det.backdrop_path ?? null,
      JSON.stringify((det.genres ?? []).map((g) => g.name)),
      det.vote_average ?? null,
      parseInt((det.first_air_date || "").slice(0, 4), 10) || null,
      parseInt((det.last_air_date || "").slice(0, 4), 10) || null,
      det.status ?? null,
      det.episode_run_time?.[0] ?? null,
      cert,
      showId,
    );
  // refresh episode metadata per season
  const seasons = db().prepare("SELECT DISTINCT season FROM episodes WHERE show_id=?").all(showId);
  for (const { season } of seasons) {
    const eps = await tmdb.seasonEpisodeList(tmdbId, season).catch(() => []);
    for (const ep of eps) {
      db()
        .prepare("UPDATE episodes SET title=?, overview=?, still=?, air_date=? WHERE show_id=? AND season=? AND episode=?")
        .run(ep.title ?? null, ep.overview ?? null, ep.stillPath ?? null, ep.airDate ?? null, showId, season, ep.episode);
    }
  }
}

async function enrichMovie(movieId, tmdbId) {
  const det = await tmdb.movieDetails(tmdbId);
  if (!det) return;
  const cert = await tmdb.certification("movie", tmdbId).catch(() => null);
  db()
    .prepare(
      `UPDATE movies SET tmdb_id=?, title=COALESCE(?, title), overview=?, poster=?, backdrop=?, genres=?, rating=?,
        year=?, runtime_min=?, cert=?, identified=1 WHERE id=?`,
    )
    .run(
      tmdbId,
      det.title ?? null,
      det.overview ?? null,
      det.poster_path ?? null,
      det.backdrop_path ?? null,
      JSON.stringify((det.genres ?? []).map((g) => g.name)),
      det.vote_average ?? null,
      parseInt((det.release_date || "").slice(0, 4), 10) || null,
      det.runtime ?? null,
      cert,
      movieId,
    );
}

/** Merge shows that ended up on the same TMDb id — returns the surviving id. */
function mergeShowsByTmdb(tmdbId, preferId) {
  const rows = db().prepare("SELECT id FROM shows WHERE tmdb_id=? ORDER BY id").all(tmdbId);
  if (rows.length <= 1) return preferId;
  const survivor = rows.some((r) => r.id === preferId) ? preferId : rows[0].id;
  for (const r of rows) {
    if (r.id === survivor) continue;
    db().prepare("UPDATE episodes SET show_id=? WHERE show_id=?").run(survivor, r.id);
    db().prepare("UPDATE favorites SET ref_id=? WHERE media_type='show' AND ref_id=?").run(survivor, r.id);
    db().prepare("DELETE FROM shows WHERE id=?").run(r.id);
  }
  return survivor;
}

// ── thumbnails (seek preview) with on-disk cache ─────────────────────────────

const THUMB_DIR = join(DATA_DIR, "thumb-cache");

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function thumbFile(path, t) {
  return join(THUMB_DIR, `${hashStr(path)}_${Math.round(t)}.jpg`);
}

export function makeThumb(path, t) {
  mkdirSync(THUMB_DIR, { recursive: true });
  const file = thumbFile(path, t);
  if (existsSync(file)) return Promise.resolve(file);
  return new Promise((resolve) => {
    const ff = spawn(FFMPEG, [
      "-hide_banner", "-loglevel", "error",
      "-ss", String(Math.max(0, t)), "-i", path,
      "-frames:v", "1", "-vf", "scale=320:-2", "-q:v", "5", file,
    ]);
    ff.on("close", () => resolve(existsSync(file) ? file : null));
    ff.on("error", () => resolve(null));
  });
}

const dirSize = (dir) => {
  let total = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile()) total += statSync(p).size;
      else if (e.isDirectory()) total += dirSize(p);
    }
  } catch { /* missing dir */ }
  return total;
};

// ── ffprobe chapters (player chapter menu + intro skip) ──────────────────────

function probeChapters(path) {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_chapters", path]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve([]));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve(
          (j.chapters ?? []).map((c) => ({
            title: c.tags?.title ?? null,
            time: parseFloat(c.start_time) || 0,
          })),
        );
      } catch {
        resolve([]);
      }
    });
  });
}

// ── tool checks ──────────────────────────────────────────────────────────────

function toolVersion(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ["-version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? (out.split("\n")[0] || "ok") : null));
  });
}

// ── the command table ────────────────────────────────────────────────────────

const kindToServer = (k) => (k === "tv" ? "show" : "movie");
const kindToDesktop = (k) => (k === "show" ? "tv" : "movie");
const libOut = (l) => ({ id: l.id, path: l.path, kind: kindToDesktop(l.kind) });

export async function handleInvoke(cmd, a = {}) {
  const d = db();
  switch (cmd) {
    // ===== settings =====
    case "get_setting":
      return getSetting(String(a.key));
    case "set_setting":
      setSetting(String(a.key), String(a.value));
      return null;

    // ===== libraries =====
    case "get_libraries":
      return listLibraries().map(libOut);
    case "add_library": {
      const path = String(a.path || "").trim();
      if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
        throw new Error("Dieser Ordner ist auf dem Server nicht sichtbar. Ist die Platte im docker-compose gemountet?");
      }
      const lib = addLibrary(path, kindToServer(a.kind), basename(path) || null);
      void scanLibrary();
      return lib.id;
    }
    case "detect_libraries": {
      // desktop: scans the picked root; web: scans ALL mounted drives
      const found = detectLibraries();
      for (const f of found) addLibrary(f.path, f.kind, f.name);
      if (found.length) void scanLibrary();
      return listLibraries().map(libOut);
    }
    case "remove_library": {
      const lib = removeLibrary(Number(a.id));
      if (lib) removeLibraryContent(lib.path, lib.kind);
      return null;
    }
    case "browse_dirs": {
      const root = primaryRoot();
      let target = a.path ? String(a.path) : root;
      let entries;
      try {
        entries = readdirSync(target, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !isSystemDir(e.name))
          .map((e) => ({ name: e.name, path: join(target, e.name) }))
          .sort((x, y) => x.name.localeCompare(y.name, "de"));
      } catch (e) {
        throw new Error("Ordner nicht lesbar: " + String(e.message || e));
      }
      const atRoot = normalize(target) === normalize(root);
      return { path: target, root, parent: atRoot ? null : normalize(join(target, "..")), entries };
    }

    // ===== scanning =====
    case "scan_libraries":
      void scanLibrary();
      return null;
    case "is_scanning":
      return !!scanState.running;
    case "scan_status":
      return {
        running: !!scanState.running,
        stage: scanState.stage || "scan",
        message: scanState.message || "Scanne Bibliothek…",
        current: scanState.current || 0,
        total: scanState.total || 0,
      };
    case "refresh_metadata": {
      (async () => {
        for (const s of d.prepare("SELECT id, tmdb_id FROM shows WHERE tmdb_id IS NOT NULL").all()) {
          await enrichShow(s.id, s.tmdb_id).catch(() => {});
        }
        for (const m of d.prepare("SELECT id, tmdb_id FROM movies WHERE tmdb_id IS NOT NULL").all()) {
          await enrichMovie(m.id, m.tmdb_id).catch(() => {});
        }
      })();
      return null;
    }
    case "reset_library": {
      // keep watched-state: convert progress to TMDb coordinates first, then
      // wipe the index and rescan — applyPendingProgress re-links afterwards
      const rows = d
        .prepare(
          `SELECT pr.profile_id, pr.media_type, pr.position, pr.duration, pr.watched, pr.updated_at,
                  COALESCE(m.tmdb_id, s.tmdb_id) tmdb_id, COALESCE(e.season,-1) season, COALESCE(e.episode,-1) episode
           FROM progress pr
           LEFT JOIN movies m ON pr.media_type='movie' AND m.id=pr.ref_id
           LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
           LEFT JOIN shows s ON s.id=e.show_id
           WHERE COALESCE(m.tmdb_id, s.tmdb_id) IS NOT NULL`,
        )
        .all();
      const up = d.prepare(
        `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
           position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
      );
      for (const r of rows) up.run(r.profile_id, r.media_type, r.tmdb_id, r.season, r.episode, r.position, r.duration, r.watched, r.updated_at);
      d.exec("DELETE FROM episodes; DELETE FROM shows; DELETE FROM movies; DELETE FROM progress;");
      return null;
    }
    case "detect_intros": {
      // chapter-based intro windows (cheap enough for a ZimaBoard). The
      // desktop app's audio fingerprinting stays desktop-only; its results
      // arrive here via sync anyway.
      const showId = a.showId ?? null;
      (async () => {
        const re = /intro|opening|\bop\b|vorspann|recap|previously|titelsong|theme song/i;
        const eps = showId
          ? d.prepare("SELECT id, path FROM episodes WHERE show_id=? AND intro_start IS NULL").all(showId)
          : d.prepare("SELECT id, path FROM episodes WHERE intro_start IS NULL LIMIT 500").all();
        scanState.stage = "intros";
        scanState.total = eps.length;
        for (let i = 0; i < eps.length; i++) {
          scanState.current = i + 1;
          scanState.message = `Intro-Erkennung (Kapitel) ${i + 1}/${eps.length}`;
          const chaps = await probeChapters(eps[i].path);
          for (let c = 0; c < chaps.length; c++) {
            if (re.test(chaps[c].title || "")) {
              const start = chaps[c].time;
              const end = c + 1 < chaps.length ? chaps[c + 1].time : start + 90;
              d.prepare("UPDATE episodes SET intro_start=?, intro_end=? WHERE id=?").run(start, end, eps[i].id);
              break;
            }
          }
        }
        scanState.message = "";
        scanState.total = 0;
      })();
      return null;
    }

    // ===== library reads =====
    case "list_movies":
      return d.prepare("SELECT * FROM movies ORDER BY title").all().map(movieOut);
    case "get_movie":
      return movieOut(d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.id)));
    case "movie_versions": {
      const m = d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.id));
      if (!m) return [];
      const list = m.tmdb_id
        ? d.prepare("SELECT * FROM movies WHERE tmdb_id=? ORDER BY height DESC").all(m.tmdb_id)
        : [m];
      return list.map(movieOut);
    }
    case "list_shows":
      return d.prepare("SELECT * FROM shows ORDER BY title").all().map(showOut);
    case "get_show_detail": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.id));
      if (!s) return null;
      const eps = d.prepare("SELECT * FROM episodes WHERE show_id=? ORDER BY season, episode").all(s.id);
      const seasons = [];
      for (const e of eps) {
        let grp = seasons.find((x) => x.season === e.season);
        if (!grp) seasons.push((grp = { season: e.season, episodes: [] }));
        grp.episodes.push(episodeOut(e, s.title));
      }
      return { show: showOut(s), seasons };
    }
    case "get_episode":
      return episodeOut(getEpisodeRow(Number(a.id)));
    case "episode_versions": {
      const e = d.prepare("SELECT * FROM episodes WHERE id=?").get(Number(a.id));
      return e ? [{ id: e.id, episodeId: e.id, path: e.path, width: e.width ?? null, height: e.height ?? null, addedAt: e.added_at }] : [];
    }
    case "list_show_episodes":
      return d
        .prepare("SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.show_id=? ORDER BY e.season, e.episode")
        .all(Number(a.showId))
        .map((r) => episodeOut(r));
    case "search_episodes": {
      const q = `%${String(a.query || "").trim()}%`;
      return d
        .prepare(
          `SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id
           WHERE e.title LIKE ?1 OR s.title LIKE ?1 ORDER BY s.title, e.season, e.episode LIMIT 100`,
        )
        .all(q)
        .map((r) => episodeOut(r));
    }
    case "path_exists":
      return existsSync(String(a.path));
    case "file_info": {
      try {
        const st = statSync(String(a.path));
        return { sizeBytes: st.size, modifiedSecs: Math.round(st.mtimeMs / 1000), exists: true };
      } catch {
        return { sizeBytes: 0, modifiedSecs: null, exists: false };
      }
    }
    case "reveal_in_explorer":
    case "open_app_data":
      throw new Error("Im Browser nicht möglich — die Dateien liegen auf dem Server.");

    // ===== TMDb + identify =====
    case "search_tmdb":
      return tmdb.searchList(String(a.query || ""), a.kind || "multi");
    case "identify_movie": {
      const m = d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.movieId));
      if (!m) throw new Error("Film nicht gefunden");
      await enrichMovie(m.id, Number(a.tmdbId));
      if (a.remember !== false) rememberIdentity(dirname(m.path), "movie", Number(a.tmdbId));
      return null;
    }
    case "identify_show": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!s) throw new Error("Serie nicht gefunden");
      await enrichShow(s.id, Number(a.tmdbId));
      const survivor = mergeShowsByTmdb(Number(a.tmdbId), s.id);
      if (a.remember !== false && s.folder) rememberIdentity(s.folder, "show", Number(a.tmdbId));
      return survivor;
    }
    case "set_episode_numbers": {
      d.prepare("UPDATE episodes SET season=?, episode=? WHERE id=?").run(Number(a.season), Number(a.episode), Number(a.episodeId));
      const e = getEpisodeRow(Number(a.episodeId));
      if (e?.show_id) {
        const s = d.prepare("SELECT tmdb_id FROM shows WHERE id=?").get(e.show_id);
        if (s?.tmdb_id) await enrichShow(e.show_id, s.tmdb_id).catch(() => {});
      }
      return null;
    }
    case "assign_episodes_sequential": {
      const start = getEpisodeRow(Number(a.episodeId));
      if (!start) throw new Error("Folge nicht gefunden");
      // "this file is SxxEyy, the rest follows in file order"
      const all = d
        .prepare("SELECT id, path FROM episodes WHERE show_id=? ORDER BY path")
        .all(start.show_id);
      const idx = all.findIndex((x) => x.id === start.id);
      if (idx < 0) return 0;
      let season = Number(a.season);
      let episode = Number(a.episode);
      let n = 0;
      for (let i = idx; i < all.length; i++) {
        d.prepare("UPDATE episodes SET season=?, episode=? WHERE id=?").run(season, episode, all[i].id);
        episode++;
        n++;
      }
      const s = d.prepare("SELECT tmdb_id FROM shows WHERE id=?").get(start.show_id);
      if (s?.tmdb_id) await enrichShow(start.show_id, s.tmdb_id).catch(() => {});
      return n;
    }
    case "tmdb_season_list":
      return tmdb.seasonEpisodeList(Number(a.tmdbId), Number(a.season));
    case "tmdb_season_numbers":
      return tmdb.seasonNumbers(Number(a.tmdbId));
    case "reassign_season": {
      const src = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!src) throw new Error("Serie nicht gefunden");
      let target = d.prepare("SELECT * FROM shows WHERE tmdb_id=?").get(Number(a.targetTmdb));
      if (!target) {
        const info = d.prepare("INSERT INTO shows (title, added_at, identified) VALUES (?,?,1)").run("…", now());
        await enrichShow(Number(info.lastInsertRowid), Number(a.targetTmdb));
        target = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(info.lastInsertRowid));
      }
      d.prepare("UPDATE episodes SET show_id=? WHERE show_id=? AND season=?").run(target.id, src.id, Number(a.season));
      d.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
      await enrichShow(target.id, Number(a.targetTmdb)).catch(() => {});
      return target.id;
    }
    case "reassign_episode": {
      const e = d.prepare("SELECT * FROM episodes WHERE id=?").get(Number(a.episodeId));
      if (!e) throw new Error("Folge nicht gefunden");
      let target = d.prepare("SELECT * FROM shows WHERE tmdb_id=?").get(Number(a.targetTmdb));
      if (!target) {
        const info = d.prepare("INSERT INTO shows (title, added_at, identified) VALUES (?,?,1)").run("…", now());
        await enrichShow(Number(info.lastInsertRowid), Number(a.targetTmdb));
        target = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(info.lastInsertRowid));
      }
      d.prepare("UPDATE episodes SET show_id=?, season=?, episode=? WHERE id=?").run(target.id, Number(a.season), Number(a.episode), e.id);
      d.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
      await enrichShow(target.id, Number(a.targetTmdb)).catch(() => {});
      return target.id;
    }
    case "repair_season_titles": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!s?.tmdb_id) throw new Error("Serie ist keiner TMDb-Serie zugeordnet");
      const season = Number(a.season);
      const tmdbEps = await tmdb.seasonEpisodeList(s.tmdb_id, season);
      const eps = d.prepare("SELECT id, path, episode FROM episodes WHERE show_id=? AND season=?").all(s.id, season);
      const norm = (x) => String(x || "").toLowerCase().replace(/[^a-zä-ü0-9]+/g, "");
      let matched = 0;
      for (const e of eps) {
        const base = norm(basename(e.path).replace(/\.[^.]+$/, "").replace(/.*e\d{1,3}/i, ""));
        if (!base) continue;
        const hit = tmdbEps.find((t) => t.title && (base.includes(norm(t.title)) || norm(t.title).includes(base)));
        if (hit && hit.episode !== e.episode) {
          d.prepare("UPDATE episodes SET episode=? WHERE id=?").run(hit.episode, e.id);
          matched++;
        } else if (hit) matched++;
      }
      await enrichShow(s.id, s.tmdb_id).catch(() => {});
      return [matched, eps.length];
    }

    // ===== progress =====
    case "set_progress": {
      d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
      ).run(String(a.profileId), a.mediaType, Number(a.refId), Number(a.positionSec) || 0, Number(a.durationSec) || 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "get_progress": {
      const r = d
        .prepare("SELECT * FROM progress WHERE profile_id=? AND media_type=? AND ref_id=?")
        .get(String(a.profileId), a.mediaType, Number(a.refId));
      return r ? progressOut(r) : null;
    }
    case "list_progress":
      return d.prepare("SELECT * FROM progress WHERE profile_id=?").all(String(a.profileId)).map(progressOut);
    case "continue_watching":
    case "recently_watched": {
      const recent = cmd === "recently_watched";
      const rows = d
        .prepare(
          `SELECT pr.*, mv.title m_title, mv.poster m_poster, mv.backdrop m_backdrop, mv.year m_year,
                  e.season, e.episode, e.title e_title, e.still, e.show_id,
                  sh.title s_title, sh.poster s_poster, sh.backdrop s_backdrop
           FROM progress pr
           LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
           LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
           LEFT JOIN shows sh ON sh.id=e.show_id
           WHERE pr.profile_id=? AND COALESCE(mv.id, e.id) IS NOT NULL
             ${recent ? "" : "AND pr.watched=0 AND pr.position > 30 AND pr.duration > 0"}
           ORDER BY pr.updated_at DESC LIMIT ?`,
        )
        .all(String(a.profileId), Number(a.limit) || 20);
      return rows.map((r) => {
        const isMovie = r.media_type === "movie";
        const pad = (n) => String(n).padStart(2, "0");
        return {
          mediaType: r.media_type,
          refId: r.ref_id,
          title: isMovie ? r.m_title : r.s_title ?? "?",
          subtitle: isMovie
            ? r.m_year
              ? String(r.m_year)
              : null
            : `S${pad(r.season)} E${pad(r.episode)}${r.e_title ? " · " + r.e_title : ""}`,
          posterPath: isMovie ? r.m_poster : r.s_poster,
          backdropPath: isMovie ? r.m_backdrop : r.still ?? r.s_backdrop,
          positionSec: r.position,
          durationSec: r.duration,
          progress: r.duration > 0 ? Math.min(1, r.position / r.duration) : 0,
          updatedAt: r.updated_at,
          showId: r.show_id ?? null,
          season: r.season ?? null,
          episode: r.episode ?? null,
        };
      });
    }
    case "apply_remote_progress": {
      const rows = Array.isArray(a.rows) ? a.rows : [];
      const up = d.prepare(
        `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
           position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
         WHERE excluded.updated_at > pending_progress.updated_at`,
      );
      for (const r of rows) {
        if (!r?.tmdbId) continue;
        up.run(String(a.profileId), r.mediaType, r.tmdbId, r.season ?? -1, r.episode ?? -1, r.positionSec ?? 0, r.durationSec ?? 0, r.watched ? 1 : 0, r.updatedAt ?? now());
      }
      applyPendingProgress(d);
      return null;
    }

    // ===== favorites / watched / stats / extras =====
    case "toggle_favorite": {
      const args = [String(a.profileId), a.mediaType, Number(a.refId)];
      const existing = d.prepare("SELECT 1 FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").get(...args);
      if (existing) {
        d.prepare("DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").run(...args);
        return false;
      }
      d.prepare("INSERT INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(...args, now());
      return true;
    }
    case "list_favorites":
      return d
        .prepare("SELECT media_type mediaType, ref_id refId, added_at addedAt FROM favorites WHERE profile_id=? ORDER BY added_at DESC")
        .all(String(a.profileId));
    case "set_watched": {
      const row = a.mediaType === "movie"
        ? d.prepare("SELECT duration FROM movies WHERE id=?").get(Number(a.refId))
        : d.prepare("SELECT duration FROM episodes WHERE id=?").get(Number(a.refId));
      d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,0,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      ).run(String(a.profileId), a.mediaType, Number(a.refId), row?.duration ?? 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "set_show_watched":
    case "set_season_watched": {
      const eps =
        cmd === "set_show_watched"
          ? d.prepare("SELECT id, duration FROM episodes WHERE show_id=?").all(Number(a.showId))
          : d.prepare("SELECT id, duration FROM episodes WHERE show_id=? AND season=?").all(Number(a.showId), Number(a.season));
      const up = d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?, 'episode', ?, 0, ?, ?, ?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      );
      for (const e of eps) up.run(String(a.profileId), e.id, e.duration ?? 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "get_stats": {
      const p = String(a.profileId);
      const r1 = d.prepare("SELECT COALESCE(SUM(CASE WHEN watched=1 THEN duration ELSE position END),0) s FROM progress WHERE profile_id=?").get(p);
      const r2 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND media_type='movie' AND watched=1").get(p);
      const r3 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND media_type='episode' AND watched=1").get(p);
      const r4 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND watched=0 AND position>30").get(p);
      return { watchedSeconds: Math.round(r1.s || 0), moviesWatched: r2.c, episodesWatched: r3.c, inProgress: r4.c };
    }
    case "tmdb_extras":
      return tmdb.extras(a.mediaType === "movie" ? "movie" : "tv", Number(a.tmdbId));

    // ===== artwork + quality =====
    case "tmdb_images":
      return tmdb.images(a.mediaType, Number(a.tmdbId), a.season ?? null, a.episode ?? null);
    case "set_artwork": {
      const { target, id, path, field, season } = a;
      const col = field === "backdrop" ? "backdrop" : "poster";
      if (target === "movie") d.prepare(`UPDATE movies SET ${col}=? WHERE id=?`).run(path, Number(id));
      else if (target === "show") d.prepare(`UPDATE shows SET ${col}=? WHERE id=?`).run(path, Number(id));
      else if (target === "episode") d.prepare("UPDATE episodes SET still=? WHERE id=?").run(path, Number(id));
      else if (target === "season")
        d.prepare("INSERT INTO season_art (show_id, season, path) VALUES (?,?,?) ON CONFLICT(show_id,season) DO UPDATE SET path=excluded.path").run(Number(id), Number(season), path);
      return null;
    }
    case "get_season_art":
      return d.prepare("SELECT season, path FROM season_art WHERE show_id=?").all(Number(a.showId)).map((r) => [r.season, r.path]);
    case "media_thumbnail": {
      const t = Math.max(0, Number(a.timeSec) || 0);
      const file = await makeThumb(String(a.path), t);
      if (!file) throw new Error("Kein Vorschaubild");
      return `/api/thumbfile?path=${encodeURIComponent(String(a.path))}&t=${Math.round(t)}`;
    }
    case "probe_qualities": {
      (async () => {
        const rows = [
          ...d.prepare("SELECT 'movie' t, id, path FROM movies WHERE width IS NULL OR duration IS NULL").all(),
          ...d.prepare("SELECT 'episode' t, id, path FROM episodes WHERE width IS NULL OR duration IS NULL").all(),
        ];
        for (const r of rows) {
          const info = await ffprobe(r.path);
          if (!info) continue;
          d.prepare(`UPDATE ${r.t === "movie" ? "movies" : "episodes"} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=? WHERE id=?`)
            .run(info.duration, info.vcodec, info.acodec, info.container, info.width, info.height, r.id);
        }
      })();
      return null;
    }
    case "set_media_dims": {
      const table = a.mediaType === "movie" ? "movies" : "episodes";
      d.prepare(`UPDATE ${table} SET width=?, height=? WHERE id=?`).run(Number(a.width), Number(a.height), Number(a.id));
      return null;
    }

    // ===== intro windows =====
    case "set_episode_intro":
      d.prepare("UPDATE episodes SET intro_start=?, intro_end=? WHERE id=?").run(Number(a.start), Number(a.end), Number(a.episodeId));
      return null;
    case "set_show_intro":
      d.prepare("UPDATE shows SET intro_start=?, intro_end=? WHERE id=?").run(a.start ?? null, a.end ?? null, Number(a.showId));
      return null;

    // ===== tools / maintenance =====
    case "check_tools": {
      const [ffm, ffp] = await Promise.all([toolVersion(FFMPEG), toolVersion(FFPROBE)]);
      return {
        mpv: { path: null, ok: false, version: "— (im Browser spielt der HTML5-Player)" },
        ffmpeg: { path: FFMPEG, ok: !!ffm, version: ffm },
        ffprobe: { path: FFPROBE, ok: !!ffp, version: ffp },
      };
    }
    case "thumb_cache_size":
      return dirSize(THUMB_DIR) + dirSize(join(DATA_DIR, "img-cache"));
    case "clear_thumb_cache": {
      const size = dirSize(THUMB_DIR);
      rmSync(THUMB_DIR, { recursive: true, force: true });
      return size;
    }
    case "db_optimize":
      d.exec("VACUUM");
      return null;
    case "export_json": {
      const data = {
        app: "ghgflix-server",
        exportedAt: now(),
        progress: d.prepare("SELECT * FROM progress").all(),
        favorites: d.prepare("SELECT * FROM favorites").all(),
        identity_map: d.prepare("SELECT * FROM identity_map").all(),
        settings: d.prepare("SELECT * FROM settings WHERE key NOT IN ('auth_tokens','password','supabase_key')").all(),
      };
      return JSON.stringify(data, null, 2);
    }
    case "import_json": {
      let j;
      try {
        j = JSON.parse(String(a.data || ""));
      } catch {
        throw new Error("Ungültige JSON-Datei");
      }
      let n = 0;
      for (const r of j.progress ?? []) {
        d.prepare(
          `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
           WHERE excluded.updated_at > progress.updated_at`,
        ).run(r.profile_id, r.media_type, r.ref_id, r.position, r.duration, r.watched, r.updated_at);
        n++;
      }
      for (const r of j.favorites ?? []) {
        d.prepare("INSERT OR IGNORE INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(r.profile_id, r.media_type, r.ref_id, r.added_at);
        n++;
      }
      for (const r of j.identity_map ?? []) {
        d.prepare("INSERT INTO identity_map (folder, kind, tmdb_id) VALUES (?,?,?) ON CONFLICT(folder,kind) DO UPDATE SET tmdb_id=excluded.tmdb_id").run(r.folder, r.kind, r.tmdb_id);
        n++;
      }
      return n;
    }
    case "export_data":
    case "import_data":
      throw new Error("Im Browser bitte den Download/Upload-Export benutzen.");

    // ===== playback (web player) =====
    case "play_info": {
      const path = String(a.path || "");
      let row = d.prepare("SELECT 'movie' mt, * FROM movies WHERE path=?").get(path);
      if (!row) row = d.prepare("SELECT 'episode' mt, * FROM episodes WHERE path=?").get(path);
      if (!row) throw new Error("Datei nicht in der Bibliothek: " + path);
      if (!row.vcodec) {
        const info = await ffprobe(path);
        if (info) {
          Object.assign(row, info);
          d.prepare(`UPDATE ${row.mt === "movie" ? "movies" : "episodes"} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=? WHERE id=?`)
            .run(info.duration, info.vcodec, info.acodec, info.container, info.width, info.height, row.id);
        }
      }
      const probe = await ffprobe(path).catch(() => null);
      const chapters = await probeChapters(path).catch(() => []);
      return {
        mediaType: row.mt,
        id: row.id,
        duration: row.duration ?? 0,
        direct: canDirectPlay(row),
        directUrl: `/api/stream/${row.mt}/${row.id}?x=1`,
        transcodeUrl: `/api/transcode/${row.mt}/${row.id}?x=1`,
        width: row.width ?? null,
        height: row.height ?? null,
        audioStreams: probe?.audioStreams ?? [],
        subtitleStreams: (probe?.subtitleStreams ?? []).filter((s) => !["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"].includes(s.codec ?? "")),
        chapters,
      };
    }

    default:
      throw new Error(`Unbekanntes Kommando: ${cmd}`);
  }
}

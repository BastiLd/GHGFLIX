// GHGFlix Server — a small Plex/Jellyfin-style media server with zero npm
// dependencies. HTTP + routing on node:http, storage on node:sqlite,
// video via ffmpeg. Designed for ZimaOS/Docker (see ../Dockerfile).
import { createServer } from "node:http";
import { createReadStream, existsSync, readdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getSetting, setSetting, settingOr, listLibraries, addLibrary, removeLibrary } from "./db.js";
import { scanLibrary, scanState, removeLibraryContent, detectLibraries, BROWSE_ROOTS, primaryRoot, isSystemDir } from "./scanner.js";
import { canDirectPlay, ffprobe, serveFile, serveThumb, serveTranscode } from "./stream.js";
import { cachedImage, tmdbEnabled } from "./tmdb.js";
import * as supabase from "./supabase.js";
import { handleInvoke, makeThumb, thumbFile } from "./invoke.js";
import { spawn } from "node:child_process";

const PORT = parseInt(process.env.PORT || "8484", 10);
const SERVER_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// webapp/ = the REAL desktop UI built for the browser (vite build:web);
// web/    = legacy fallback (icon, manifest) for files not in the build
const WEBAPP_DIR = join(SERVER_ROOT, "webapp");
const LEGACY_DIR = join(SERVER_ROOT, "web");
const WEB_DIR = existsSync(join(WEBAPP_DIR, "index.html")) ? WEBAPP_DIR : LEGACY_DIR;
const VERSION = "2.1.0";

const db = openDb();

// ── auth ────────────────────────────────────────────────────────────────────
// Optional: set GHGFLIX_PASSWORD (env or setting). Tokens survive restarts.
const password = () => settingOr("password", "GHGFLIX_PASSWORD", "");
const tokens = new Set(JSON.parse(getSetting("auth_tokens") || "[]"));
const saveTokens = () => setSetting("auth_tokens", JSON.stringify([...tokens].slice(-50)));

function authed(req, url) {
  if (!password()) return true;
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token") || "";
  return tokens.has(t);
}

// ── helpers ─────────────────────────────────────────────────────────────────
const json = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => {
      buf += d;
      if (buf.length > 10_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        reject(new Error("invalid json"));
      }
    });
  });

const mediaRow = (type, id) =>
  db.prepare(`SELECT * FROM ${type === "movie" ? "movies" : "episodes"} WHERE id = ?`).get(id);

/** progress rows in TMDb coordinates (the cross-device sync format). */
function progressAsTmdb(profileId, since = 0) {
  return db
    .prepare(
      `SELECT pr.media_type, pr.position, pr.duration, pr.watched, pr.updated_at,
              COALESCE(m.tmdb_id, s.tmdb_id) tmdb_id,
              COALESCE(e.season, -1) season, COALESCE(e.episode, -1) episode
       FROM progress pr
       LEFT JOIN movies m ON pr.media_type='movie' AND m.id = pr.ref_id
       LEFT JOIN episodes e ON pr.media_type='episode' AND e.id = pr.ref_id
       LEFT JOIN shows s ON s.id = e.show_id
       WHERE pr.profile_id = ? AND pr.updated_at > ? AND COALESCE(m.tmdb_id, s.tmdb_id) IS NOT NULL`,
    )
    .all(profileId, since);
}

async function upsertTmdbProgress(profileId, rows) {
  let applied = 0;
  for (const r of rows) {
    if (!r || !r.tmdbId || !["movie", "episode"].includes(r.mediaType)) continue;
    db.prepare(
      `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
         position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
       WHERE excluded.updated_at > pending_progress.updated_at`,
    ).run(
      profileId,
      r.mediaType,
      r.tmdbId,
      r.season ?? -1,
      r.episode ?? -1,
      r.position ?? 0,
      r.duration ?? 0,
      r.watched ? 1 : 0,
      r.updatedAt ?? Date.now(),
    );
    applied++;
  }
  // resolve immediately for known media — awaited so the HTTP response only
  // returns once the rows are actually visible in `progress` (S-011: the old
  // fire-and-forget version raced against the client's next pull)
  const { applyPendingProgress } = await import("./scanner.js");
  applyPendingProgress(db);
  return applied;
}

// ── static web UI ───────────────────────────────────────────────────────────
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  let file = normalize(join(WEB_DIR, rel));
  if ((!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) && WEB_DIR !== LEGACY_DIR) {
    const legacy = normalize(join(LEGACY_DIR, rel));
    if (legacy.startsWith(LEGACY_DIR) && existsSync(legacy) && statSync(legacy).isFile()) file = legacy;
  }
  if ((!file.startsWith(WEB_DIR) && !file.startsWith(LEGACY_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
    // SPA fallback
    const index = join(WEB_DIR, "index.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    createReadStream(index).pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": STATIC_MIME[extname(file)] || "application/octet-stream",
    "Cache-Control": rel === "/index.html" ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(file).pipe(res);
}

// ── request handling ────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*"); // desktop app + Expo dev
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  if (!p.startsWith("/api/")) return serveStatic(res, p);

  // open endpoints (needed for auto-discovery + login)
  if (p === "/api/ping") {
    return json(res, {
      ok: true,
      app: "ghgflix-server",
      version: VERSION,
      name: getSetting("server_name") || "GHGFlix",
      auth: !!password(),
      time: Date.now(),
    });
  }
  if (p === "/api/login" && req.method === "POST") {
    const body = await readBody(req);
    if (!password()) return json(res, { token: null, auth: false });
    if (body.password !== password()) return json(res, { error: "Falsches Passwort" }, 401);
    const t = randomBytes(24).toString("hex");
    tokens.add(t);
    saveTokens();
    return json(res, { token: t });
  }

  if (!authed(req, url)) return json(res, { error: "unauthorized" }, 401);

  const profileId = parseInt(url.searchParams.get("profile") || "1", 10);

  // ── library ──
  if (p === "/api/library") {
    const shows = db.prepare("SELECT s.*, COUNT(DISTINCT e.season) seasons, COUNT(e.id) episodes FROM shows s LEFT JOIN episodes e ON e.show_id=s.id GROUP BY s.id ORDER BY s.title").all();
    const movies = db.prepare("SELECT * FROM movies ORDER BY title").all();
    return json(res, { shows, movies });
  }
  let m;
  if ((m = p.match(/^\/api\/shows\/(\d+)$/))) {
    const show = db.prepare("SELECT * FROM shows WHERE id = ?").get(+m[1]);
    if (!show) return json(res, { error: "not found" }, 404);
    const eps = db.prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, episode").all(show.id);
    const seasons = [];
    for (const e of eps) {
      let s = seasons.find((x) => x.season === e.season);
      if (!s) seasons.push((s = { season: e.season, episodes: [] }));
      s.episodes.push(e);
    }
    return json(res, { show, seasons });
  }
  if ((m = p.match(/^\/api\/movies\/(\d+)$/))) {
    const movie = db.prepare("SELECT * FROM movies WHERE id = ?").get(+m[1]);
    return movie ? json(res, movie) : json(res, { error: "not found" }, 404);
  }

  // ── profiles ──
  if (p === "/api/profiles" && req.method === "GET") {
    return json(res, db.prepare("SELECT id, name, avatar FROM profiles ORDER BY id").all());
  }
  if (p === "/api/profiles" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, { error: "name fehlt" }, 400);
    try {
      const info = db.prepare("INSERT INTO profiles (name, avatar, created_at) VALUES (?,?,?)").run(name, body.avatar ?? null, Date.now());
      return json(res, { id: Number(info.lastInsertRowid), name });
    } catch {
      return json(res, { error: "Profil existiert bereits" }, 409);
    }
  }

  // ── progress ──
  if (p === "/api/progress" && req.method === "GET") {
    return json(res, db.prepare("SELECT media_type mediaType, ref_id refId, position, duration, watched, updated_at updatedAt FROM progress WHERE profile_id = ?").all(profileId));
  }
  if (p === "/api/progress" && req.method === "POST") {
    const b = await readBody(req);
    if (!["movie", "episode"].includes(b.mediaType) || !b.refId) return json(res, { error: "bad payload" }, 400);
    db.prepare(
      `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
    ).run(profileId, b.mediaType, b.refId, b.position ?? 0, b.duration ?? 0, b.watched ? 1 : 0, Date.now());
    return json(res, { ok: true });
  }
  if (p === "/api/continue") {
    const rows = db
      .prepare(
        `SELECT pr.media_type mediaType, pr.ref_id refId, pr.position, pr.duration, pr.updated_at updatedAt,
                COALESCE(mv.title, sh.title) title, e.season, e.episode, e.title epTitle,
                COALESCE(mv.poster, sh.poster) poster, e.show_id showId, mv.backdrop mBackdrop, sh.backdrop sBackdrop, e.still still
         FROM progress pr
         LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
         LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
         LEFT JOIN shows sh ON sh.id=e.show_id
         WHERE pr.profile_id=? AND pr.watched=0 AND pr.position > 30 AND pr.duration > 0
           AND COALESCE(mv.id, e.id) IS NOT NULL
         ORDER BY pr.updated_at DESC LIMIT 20`,
      )
      .all(profileId);
    return json(res, rows);
  }
  // "Zuletzt gesehen" — most recent progress rows (watched or in-progress)
  if (p === "/api/history") {
    const rows = db
      .prepare(
        `SELECT pr.media_type mediaType, pr.ref_id refId, pr.updated_at updatedAt,
                COALESCE(mv.title, sh.title) title, e.season, e.episode,
                COALESCE(mv.poster, sh.poster) poster, e.show_id showId, e.still still,
                mv.backdrop mBackdrop, sh.backdrop sBackdrop
         FROM progress pr
         LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
         LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
         LEFT JOIN shows sh ON sh.id=e.show_id
         WHERE pr.profile_id=? AND COALESCE(mv.id, e.id) IS NOT NULL
         ORDER BY pr.updated_at DESC LIMIT 20`,
      )
      .all(profileId);
    return json(res, rows);
  }

  // ── favorites / Meine Liste ──
  if (p === "/api/favorites" && req.method === "GET") {
    return json(res, db.prepare("SELECT media_type mediaType, ref_id refId, added_at addedAt FROM favorites WHERE profile_id = ? ORDER BY added_at DESC").all(profileId));
  }
  if (p === "/api/favorites" && req.method === "POST") {
    const b = await readBody(req);
    if (!["movie", "show"].includes(b.mediaType) || !b.refId) return json(res, { error: "bad payload" }, 400);
    const existing = db.prepare("SELECT 1 FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").get(profileId, b.mediaType, b.refId);
    if (existing) {
      db.prepare("DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").run(profileId, b.mediaType, b.refId);
      return json(res, { favorite: false });
    }
    db.prepare("INSERT INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(profileId, b.mediaType, b.refId, Date.now());
    return json(res, { favorite: true });
  }
  // mark a whole movie/show (or single episode) watched / unwatched
  if (p === "/api/watched" && req.method === "POST") {
    const b = await readBody(req);
    const now = Date.now();
    const setOne = (mediaType, refId, dur) =>
      db.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,0,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      ).run(profileId, mediaType, refId, dur ?? 0, b.watched ? 1 : 0, now);
    if (b.mediaType === "movie") setOne("movie", b.refId, 0);
    else if (b.mediaType === "episode") setOne("episode", b.refId, 0);
    else if (b.mediaType === "show") {
      for (const e of db.prepare("SELECT id, duration FROM episodes WHERE show_id = ?").all(b.refId)) setOne("episode", e.id, e.duration);
    } else if (b.mediaType === "season") {
      for (const e of db.prepare("SELECT id, duration FROM episodes WHERE show_id = ? AND season = ?").all(b.refId, b.season)) setOne("episode", e.id, e.duration);
    } else return json(res, { error: "bad payload" }, 400);
    return json(res, { ok: true });
  }

  // ── sync (desktop app + phone, TMDb-keyed) ──
  if (p === "/api/sync/progress" && req.method === "GET") {
    const since = parseInt(url.searchParams.get("since") || "0", 10);
    return json(res, { now: Date.now(), rows: progressAsTmdb(profileId, since) });
  }
  if (p === "/api/sync/progress" && req.method === "POST") {
    const b = await readBody(req);
    const applied = await upsertTmdbProgress(profileId, Array.isArray(b.rows) ? b.rows : []);
    return json(res, { ok: true, applied });
  }

  // ── playback ──
  if ((m = p.match(/^\/api\/play\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return json(res, { error: "not found" }, 404);
    if (!row.vcodec) {
      const info = await ffprobe(row.path);
      if (info) Object.assign(row, info);
    }
    const token = url.searchParams.get("token");
    const tq = token ? `&token=${token}` : "";
    const direct = canDirectPlay(row);
    return json(res, {
      duration: row.duration,
      direct,
      vcodec: row.vcodec,
      acodec: row.acodec,
      width: row.width,
      height: row.height,
      directUrl: `/api/stream/${m[1]}/${row.id}?x=1${tq}`,
      transcodeUrl: `/api/transcode/${m[1]}/${row.id}?x=1${tq}`,
      audioStreams: row.audioStreams ?? [],
    });
  }
  if ((m = p.match(/^\/api\/stream\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    return serveFile(req, res, row.path);
  }
  if ((m = p.match(/^\/api\/transcode\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    return serveTranscode(req, res, row, {
      start: parseFloat(url.searchParams.get("t") || "0") || 0,
      quality: url.searchParams.get("q") || "original",
      audioIndex: parseInt(url.searchParams.get("a") || "0", 10) || 0,
    });
  }
  if ((m = p.match(/^\/api\/thumb\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    const at = row.duration ? Math.min(row.duration * 0.25, 420) : 300;
    return serveThumb(res, row.path, Math.round(at));
  }

  // ── desktop-app command surface (the web UI runs the SAME React app as the
  //    Windows app; src/lib/backend.ts routes every Tauri invoke() here) ──
  if ((m = p.match(/^\/api\/invoke\/([a-z0-9_]+)$/)) && req.method === "POST") {
    const args = await readBody(req);
    try {
      const result = await handleInvoke(m[1], args);
      return json(res, { result: result === undefined ? null : result });
    } catch (e) {
      return json(res, { error: String(e?.message || e) }, 400);
    }
  }
  // seek-preview thumbnail (generated + cached by the media_thumbnail command)
  if (p === "/api/thumbfile") {
    const path = url.searchParams.get("path") || "";
    const t = parseInt(url.searchParams.get("t") || "0", 10) || 0;
    const file = await makeThumb(path, t);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" });
    return createReadStream(file).pipe(res);
  }
  // embedded text subtitles → WebVTT (browsers can only render VTT)
  if ((m = p.match(/^\/api\/subs\/(movie|episode)\/(\d+)\/(\d+)\.vtt$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    const ff = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", row.path, "-map", `0:s:${+m[3]}?`, "-f", "webvtt", "pipe:1",
    ]);
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=86400" });
    ff.stdout.pipe(res);
    ff.on("error", () => res.end());
    req.on("close", () => { try { ff.kill("SIGKILL"); } catch {} });
    return;
  }

  // ── images (TMDb proxy + cache) ──
  if (p === "/api/img") {
    const stream = await cachedImage(url.searchParams.get("path") || "", url.searchParams.get("size") || "w342");
    if (!stream) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=2592000" });
    return stream.pipe(res);
  }

  // ── libraries (Einstellungen → Bibliotheken: beliebig viele Ordner/Platten) ──
  if (p === "/api/libraries" && req.method === "GET") {
    return json(res, listLibraries());
  }
  if (p === "/api/libraries" && req.method === "POST") {
    const b = await readBody(req);
    const path = String(b.path || "").trim();
    const kind = b.kind === "movie" ? "movie" : "show";
    if (!path) return json(res, { error: "Pfad fehlt" }, 400);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return json(res, { error: "Dieser Ordner ist im Server-Container nicht sichtbar. Ist die Festplatte im docker-compose gemountet?" }, 400);
    }
    const lib = addLibrary(path, kind, b.name || null);
    void scanLibrary();
    return json(res, lib);
  }
  if ((m = p.match(/^\/api\/libraries\/(\d+)$/)) && req.method === "DELETE") {
    const lib = removeLibrary(+m[1]);
    if (lib) removeLibraryContent(lib.path, lib.kind);
    return json(res, { ok: true });
  }
  // Browse the container-visible filesystem so folders can be picked by
  // clicking instead of typing paths blind — mirrors the desktop app's
  // folder picker. With the whole host mounted at /host, this lets the user
  // navigate their ENTIRE ZimaOS and find media wherever it really lives.
  // System folders (proc, sys, AppData, …) are hidden.
  if (p === "/api/browse") {
    const root = primaryRoot();
    let target = url.searchParams.get("path");
    if (!target || target === "roots") target = root; // start at the real root
    let entries;
    try {
      entries = readdirSync(target, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !isSystemDir(e.name))
        .map((e) => ({ name: e.name, path: join(target, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
    } catch (e) {
      return json(res, { error: "Ordner nicht lesbar: " + String(e.message || e) }, 400);
    }
    // never navigate above the browse root
    const atRoot = normalize(target) === normalize(root);
    const parent = atRoot ? null : normalize(join(target, ".."));
    return json(res, { path: target, root, parent, entries });
  }
  // Auto-detect media library folders across all mounted drives.
  if (p === "/api/detect") {
    return json(res, { found: detectLibraries() });
  }

  // ── scan ──
  if (p === "/api/scan" && req.method === "POST") {
    void scanLibrary();
    return json(res, { started: true });
  }
  if (p === "/api/scan/status") return json(res, { ...scanState, tmdb: tmdbEnabled() });

  // ── settings (server-side) ──
  // SEC-002: the service-role key is NEVER echoed back — only `supabase_key_set`,
  // mirroring the existing tmdb_key_set pattern.
  if (p === "/api/settings" && req.method === "GET") {
    return json(res, {
      server_name: getSetting("server_name") || "GHGFlix",
      tmdb_key_set: tmdbEnabled(),
      password_set: !!password(),
      supabase_configured: supabase.supabaseConfigured(),
      supabase_url: settingOr("supabase_url", "SUPABASE_URL", ""),
      supabase_key_set: !!settingOr("supabase_key", "SUPABASE_SERVICE_KEY", ""),
      supabase_user_id: settingOr("supabase_user_id", "SUPABASE_USER_ID", ""),
      supabase_push: getSetting("supabase_push") !== "off",
      supabase_pull: getSetting("supabase_pull") !== "off",
      supabase_status: supabase.supabaseStatus(),
    });
  }
  if (p === "/api/settings" && req.method === "POST") {
    const b = await readBody(req);
    const allowed = ["server_name", "tmdb_key", "tmdb_lang", "password", "supabase_url", "supabase_key", "supabase_user_id", "supabase_push", "supabase_pull"];
    for (const k of allowed) {
      if (!(k in b)) continue;
      // S-021: an empty value DELETES the row so a docker-compose env var
      // (SUPABASE_SERVICE_KEY, …) becomes visible again instead of being
      // masked by an empty-string setting.
      if (String(b[k]) === "") db.prepare("DELETE FROM settings WHERE key = ?").run(k);
      else setSetting(k, String(b[k]));
    }
    return json(res, { ok: true });
  }
  if (p === "/api/supabase/import" && req.method === "POST") {
    try {
      const r = await supabase.importFromSupabase();
      return json(res, { ok: true, ...r });
    } catch (e) {
      return json(res, { error: String(e.message || e) }, 400);
    }
  }

  return json(res, { error: "not found" }, 404);
}

createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[http]", req.url, e);
    if (!res.headersSent) json(res, { error: "server error" }, 500);
    else res.end();
  });
}).listen(PORT, () => {
  console.log(`GHGFlix Server v${VERSION} → http://0.0.0.0:${PORT}`);
});

// initial scan + periodic rescan (default: every 30 min) + Supabase loop
void scanLibrary();
const every = Math.max(300, parseInt(process.env.SCAN_INTERVAL_SEC || "1800", 10)) * 1000;
setInterval(() => void scanLibrary(), every).unref();
supabase.startSupabaseLoop();

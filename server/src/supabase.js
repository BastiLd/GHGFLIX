// Optional Supabase sync (each direction can be toggled separately in the
// web UI → Einstellungen). Talks to PostgREST directly with fetch — needs the
// SERVICE-ROLE key because the server acts for all profiles (RLS bypass).
import { openDb, settingOr, getSetting } from "./db.js";

const url = () => (settingOr("supabase_url", "SUPABASE_URL", "") || "").replace(/\/$/, "");
const key = () => settingOr("supabase_key", "SUPABASE_SERVICE_KEY", "");

export const supabaseConfigured = () => !!(url() && key());
export const pushEnabled = () => supabaseConfigured() && getSetting("supabase_push") !== "off";
export const pullEnabled = () => supabaseConfigured() && getSetting("supabase_pull") !== "off";

async function rest(path, { method = "GET", body, params } = {}) {
  const u = new URL(`${url()}/rest/v1/${path}`);
  for (const [a, b] of Object.entries(params ?? {})) u.searchParams.set(a, b);
  const res = await fetch(u, {
    method,
    headers: {
      apikey: key(),
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "resolution=merge-duplicates,return=minimal" : "return=representation",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`supabase ${method} ${path}: ${res.status} ${await res.text().catch(() => "")}`);
  return res.status === 204 ? null : res.json();
}

/** Local profile for a Supabase profile row — created on demand, linked by id. */
function localProfileFor(db, sb) {
  const existing = db.prepare("SELECT id FROM profiles WHERE supabase_id = ?").get(sb.id);
  if (existing) return existing.id;
  const byName = db.prepare("SELECT id, supabase_id FROM profiles WHERE name = ?").get(sb.name);
  if (byName && !byName.supabase_id) {
    db.prepare("UPDATE profiles SET supabase_id = ? WHERE id = ?").run(sb.id, byName.id);
    return byName.id;
  }
  const info = db
    .prepare("INSERT INTO profiles (name, avatar, supabase_id, created_at) VALUES (?,?,?,?)")
    .run(sb.name, sb.avatar ?? null, sb.id, Date.now());
  return Number(info.lastInsertRowid);
}

/** TMDb coordinates for a local progress row (needed as the sync key). */
function tmdbCoords(db, mediaType, refId) {
  if (mediaType === "movie") {
    const m = db.prepare("SELECT tmdb_id FROM movies WHERE id = ?").get(refId);
    return m?.tmdb_id ? { tmdb_id: m.tmdb_id, season: -1, episode: -1 } : null;
  }
  const e = db
    .prepare("SELECT s.tmdb_id, e.season, e.episode FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id = ?")
    .get(refId);
  return e?.tmdb_id ? { tmdb_id: e.tmdb_id, season: e.season, episode: e.episode } : null;
}

/** Pull remote progress → local (last-write-wins; unknown media → pending). */
export async function pullFromSupabase() {
  if (!pullEnabled()) return { pulled: 0 };
  const db = openDb();
  const profiles = await rest("profiles", { params: { select: "*" } });
  const since = parseInt(getSetting("supabase_last_pull") ?? "0", 10);
  let pulled = 0;
  for (const sb of profiles) {
    const pid = localProfileFor(db, sb);
    const rows = await rest("watch_progress", {
      params: { select: "*", profile_id: `eq.${sb.id}`, updated_at: `gt.${since}` },
    });
    for (const r of rows) {
      db.prepare(
        `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
           position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
         WHERE excluded.updated_at > pending_progress.updated_at`,
      ).run(pid, r.media_type, r.tmdb_id, r.season, r.episode, r.position_sec, r.duration_sec, r.watched ? 1 : 0, r.updated_at);
      pulled++;
    }
  }
  // pending → progress for everything we can resolve right away
  const { applyPendingProgress } = await import("./scanner.js");
  applyPendingProgress(db);
  db.prepare("INSERT INTO settings (key, value) VALUES ('supabase_last_pull', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()));
  return { pulled };
}

/** Push local progress changed since the last push (only linked profiles). */
export async function pushToSupabase() {
  if (!pushEnabled()) return { pushed: 0 };
  const db = openDb();
  const since = parseInt(getSetting("supabase_last_push") ?? "0", 10);
  const rows = db
    .prepare(
      `SELECT pr.*, p.supabase_id FROM progress pr JOIN profiles p ON p.id = pr.profile_id
       WHERE pr.updated_at > ? AND p.supabase_id IS NOT NULL`,
    )
    .all(since);
  const payload = [];
  for (const r of rows) {
    const c = tmdbCoords(db, r.media_type, r.ref_id);
    if (!c) continue;
    payload.push({
      profile_id: r.supabase_id,
      media_type: r.media_type,
      tmdb_id: c.tmdb_id,
      season: c.season,
      episode: c.episode,
      position_sec: r.position,
      duration_sec: r.duration,
      watched: !!r.watched,
      updated_at: r.updated_at,
    });
  }
  if (payload.length > 0) {
    await rest("watch_progress?on_conflict=profile_id,media_type,tmdb_id,season,episode", { method: "POST", body: payload });
  }
  db.prepare("INSERT INTO settings (key, value) VALUES ('supabase_last_push', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(Date.now()));
  return { pushed: payload.length };
}

/** Full one-time import (ignores the "since" cursor). */
export async function importFromSupabase() {
  if (!supabaseConfigured()) throw new Error("Supabase ist nicht konfiguriert (URL + Service-Key in den Einstellungen)");
  const db = openDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('supabase_last_pull', '0') ON CONFLICT(key) DO UPDATE SET value='0'").run();
  const wasPull = getSetting("supabase_pull");
  try {
    if (wasPull === "off") db.prepare("UPDATE settings SET value='on' WHERE key='supabase_pull'").run();
    return await pullFromSupabase();
  } finally {
    if (wasPull === "off") db.prepare("UPDATE settings SET value='off' WHERE key='supabase_pull'").run();
  }
}

/** Background loop: pull + push on an interval while enabled. */
export function startSupabaseLoop() {
  const tick = async () => {
    try {
      if (pullEnabled()) await pullFromSupabase();
      if (pushEnabled()) await pushToSupabase();
    } catch (e) {
      console.error("[supabase]", String(e).slice(0, 300));
    }
  };
  setInterval(tick, 60_000).unref();
}

// Sync with a GHGFlix server (the ZimaOS Docker container). Watch progress is
// exchanged in TMDb coordinates, so it matches the same title on any device —
// exactly like the Supabase sync, but against your own box in the LAN/VPN.
//
// Endpoint auto-switching: several addresses can be configured (lokale IP,
// Domain, Tailscale). In "auto" mode the first reachable one wins, so the
// app keeps syncing at home AND on the go without touching anything.
import { listMovies, listProgress, listShows, setProgress, getSetting, setSetting } from "./api";
import { useStore } from "./store";

export interface ServerEndpoint {
  name: string;
  url: string;
}

export interface ServerConfig {
  enabled: boolean;
  mode: "auto" | "manual";
  endpoints: ServerEndpoint[];
  manualUrl: string; // used when mode === "manual"
  token: string;
}

const DEFAULTS: ServerConfig = { enabled: false, mode: "auto", endpoints: [], manualUrl: "", token: "" };

export async function loadServerConfig(): Promise<ServerConfig> {
  try {
    const raw = await getSetting("ghg_server_config");
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function saveServerConfig(cfg: ServerConfig): Promise<void> {
  await setSetting("ghg_server_config", JSON.stringify(cfg));
  activeBase = null; // re-resolve on next tick
}

async function ping(base: string, ms = 3500): Promise<{ ok: boolean; id?: string }> {
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/ping`, { signal: AbortSignal.timeout(ms) });
    const j = await res.json();
    return j?.app === "ghgflix-server" ? { ok: true, id: typeof j.id === "string" ? j.id : undefined } : { ok: false };
  } catch {
    return { ok: false };
  }
}

let activeBase: string | null = null;
// S-017/ARCH-16: stable installation ID of the active server (from /api/ping).
// Cursors are keyed by this ID, so Lokal/Domain/Tailscale addresses of the SAME
// box share ONE cursor instead of pulling everything once per address.
let activeServerId: string | null = null;

/** Resolve which server address to use right now (auto → first reachable). */
export async function resolveServer(cfg: ServerConfig): Promise<string | null> {
  if (activeBase) {
    const p = await ping(activeBase, 2500);
    if (p.ok) {
      activeServerId = p.id ?? activeServerId;
      return activeBase;
    }
  }
  activeBase = null;
  activeServerId = null;
  const candidates =
    cfg.mode === "manual" && cfg.manualUrl ? [cfg.manualUrl] : cfg.endpoints.map((e) => e.url).filter(Boolean);
  for (const url of candidates) {
    const base = url.replace(/\/$/, "");
    const p = await ping(base);
    if (p.ok) {
      activeBase = base;
      activeServerId = p.id ?? null;
      return base;
    }
  }
  return null;
}

interface SyncRow {
  mediaType: "movie" | "episode";
  tmdbId: number;
  season: number;
  episode: number;
  position: number;
  duration: number;
  watched: boolean;
  updatedAt: number;
}

async function serverApi<T>(base: string, cfg: ServerConfig, path: string, init?: RequestInit): Promise<T> {
  const url = new URL(base + path);
  if (cfg.token) url.searchParams.set("token", cfg.token);
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`server ${path}: ${res.status}`);
  return res.json();
}

/** Server profile matching the local one by name (created if missing). */
async function serverProfileId(base: string, cfg: ServerConfig, name: string): Promise<number> {
  const profiles = await serverApi<{ id: number; name: string }[]>(base, cfg, "/api/profiles");
  const hit = profiles.find((profile) => profile.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const created = await serverApi<{ id: number }>(base, cfg, "/api/profiles", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return created.id ?? profiles[0]?.id ?? 1;
}

// tmdb coordinates → local refId, rebuilt lazily and cached for 10 minutes
let mapCache: { at: number; movies: Map<number, number>; episodes: Map<string, number> } | null = null;
async function tmdbMap() {
  if (mapCache && Date.now() - mapCache.at < 600_000) return mapCache;
  const movies = new Map<number, number>();
  const episodes = new Map<string, number>();
  for (const movie of await listMovies()) {
    if (movie.tmdbId != null) movies.set(movie.tmdbId, movie.id);
  }
  const { listShowEpisodes } = await import("./api");
  for (const show of await listShows()) {
    if (show.tmdbId == null) continue;
    for (const ep of await listShowEpisodes(show.id)) {
      episodes.set(`${show.tmdbId}:${ep.season}:${ep.episode}`, ep.id);
    }
  }
  mapCache = { at: Date.now(), movies, episodes };
  return mapCache;
}

// Cursor key: prefer the stable server ID (S-017); fall back to the URL for
// older servers that don't send an `id` yet (pre-2.2 API compatibility).
const cursorKey = (base: string, profileId: string, dir: "pull" | "push") =>
  `ghgflix.serverSync.${dir}.${profileId}.${activeServerId ?? base}`;

/** One-time migration: move an existing URL-keyed cursor to the ID key so no
 *  full re-pull happens after the update (ARCH-14 in miniature). */
function migrateCursor(base: string, profileId: string, dir: "pull" | "push"): void {
  if (!activeServerId) return;
  const idKey = `ghgflix.serverSync.${dir}.${profileId}.${activeServerId}`;
  const urlKey = `ghgflix.serverSync.${dir}.${profileId}.${base}`;
  if (localStorage.getItem(idKey) == null && localStorage.getItem(urlKey) != null) {
    localStorage.setItem(idKey, localStorage.getItem(urlKey)!);
    localStorage.removeItem(urlKey);
  }
}

/** One full sync round: push local changes, pull remote ones (LWW). */
export async function syncOnce(): Promise<{ pushed: number; pulled: number } | null> {
  const cfg = await loadServerConfig();
  if (!cfg.enabled) return null;
  const base = await resolveServer(cfg);
  if (!base) return null;

  const { profileId, profileName } = useStore.getState();
  const spid = await serverProfileId(base, cfg, profileName || "Standard");
  const withProfile = (p: string) => `${p}${p.includes("?") ? "&" : "?"}profile=${spid}`;
  migrateCursor(base, profileId, "push");
  migrateCursor(base, profileId, "pull");

  // ── push ──
  const lastPush = parseInt(localStorage.getItem(cursorKey(base, profileId, "push")) ?? "0", 10);
  const local = await listProgress(profileId);
  const rows: SyncRow[] = local
    .filter((p) => p.tmdbId != null && p.updatedAt > lastPush)
    .map((p) => ({
      mediaType: p.mediaType,
      tmdbId: p.tmdbId!,
      season: p.season ?? -1,
      episode: p.episode ?? -1,
      position: p.positionSec,
      duration: p.durationSec,
      watched: p.watched,
      updatedAt: p.updatedAt,
    }));
  if (rows.length > 0) {
    await serverApi(base, cfg, withProfile("/api/sync/progress"), { method: "POST", body: JSON.stringify({ rows }) });
  }
  localStorage.setItem(cursorKey(base, profileId, "push"), String(Date.now()));

  // ── pull ──
  const lastPull = parseInt(localStorage.getItem(cursorKey(base, profileId, "pull")) ?? "0", 10);
  const remote = await serverApi<{ now: number; rows: { media_type: string; tmdb_id: number; season: number; episode: number; position: number; duration: number; watched: number; updated_at: number }[] }>(
    base,
    cfg,
    withProfile(`/api/sync/progress?since=${lastPull}`),
  );
  const localByKey = new Map(local.map((p) => [`${p.mediaType}:${p.refId}`, p]));
  const map = await tmdbMap();
  let pulled = 0;
  for (const r of remote.rows) {
    const mediaType = r.media_type as "movie" | "episode";
    const refId =
      mediaType === "movie" ? map.movies.get(r.tmdb_id) : map.episodes.get(`${r.tmdb_id}:${r.season}:${r.episode}`);
    if (refId == null) continue;
    const existing = localByKey.get(`${mediaType}:${refId}`);
    if (existing && existing.updatedAt >= r.updated_at) continue; // local is newer
    await setProgress(profileId, mediaType, refId, r.position, r.duration, !!r.watched);
    pulled++;
  }
  localStorage.setItem(cursorKey(base, profileId, "pull"), String(remote.now));
  return { pushed: rows.length, pulled };
}

let loop: number | null = null;

/** Background sync every 30 s (call once at app start; safe to re-call). */
export function startServerSync(): void {
  if (loop != null) return;
  const tick = () => void syncOnce().catch(() => {});
  tick();
  loop = window.setInterval(tick, 30_000);
}

/** Test a server address: reachable? password needed? Returns the ping info. */
export async function testServer(url: string): Promise<{ ok: boolean; name?: string; auth?: boolean }> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/ping`, { signal: AbortSignal.timeout(4000) });
    const j = await res.json();
    return j?.app === "ghgflix-server" ? { ok: true, name: j.name, auth: j.auth } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Log in against a password-protected server and store the token. */
export async function loginServer(url: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
      signal: AbortSignal.timeout(6000),
    });
    const j = await res.json();
    return j.token ?? null;
  } catch {
    return null;
  }
}

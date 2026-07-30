// ============================================================================
// Supabase-Cloud-Sync
//
// WARUM DIESE DATEI NEU IST — die zwei Gründe, warum vorher NICHTS ankam:
//
//  1. Der Abgleich lief nur, wenn auf dem Profilbildschirm ausdrücklich ein
//     CLOUD-Profil ausgewählt wurde. Mit dem Standardprofil „Lokal“ stieg
//     syncProgress() sofort wieder aus — es wurde also nie etwas hochgeladen.
//
//  2. Selbst nach dem Umschalten auf ein Cloud-Profil war die Tabelle leer:
//     der gesamte bisherige Fortschritt liegt in der lokalen Datenbank unter
//     der Profil-ID "local". Gepusht wurde aber nur, was unter der NEUEN
//     Cloud-Profil-ID stand — und das war schlicht nichts.
//
// Neu:
//   * Das lokale Profil wird EINMAL fest mit einem Cloud-Profil verknüpft
//     (Verknüpfung liegt in den Einstellungen, überlebt Neustarts).
//   * Danach wird IMMER synchronisiert, egal welches Profil gewählt ist.
//   * Vorhandener lokaler Fortschritt wird auf Nachfrage einmalig hochgeladen.
//   * „Meine Liste“ (Favoriten) wird mitsynchronisiert.
//   * Fehler sind sichtbar (Statuszeile in den Einstellungen) statt nur im Log.
// ============================================================================
import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import {
  getSetting, setSetting, listProgress, applyRemoteProgress, listFavorites, listMovies, listShows,
  toggleFavorite, type RemoteProgressRow,
} from "./api";

let client: SupabaseClient | null = null;
let initialized = false;

// ── Verbindung ──────────────────────────────────────────────────────────────

export async function initSupabase(): Promise<SupabaseClient | null> {
  if (initialized) return client;
  initialized = true;
  const url = (await getSetting("supabase_url"))?.trim();
  const key = (await getSetting("supabase_anon_key"))?.trim();
  if (url && key) {
    client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

export async function reinitSupabase(): Promise<SupabaseClient | null> {
  initialized = false;
  client = null;
  stopSupabaseSync();
  return initSupabase();
}

export function getClient(): SupabaseClient | null {
  return client;
}

export function isConfigured(): boolean {
  return !!client;
}

function requireClient(): SupabaseClient {
  if (!client) throw new Error("Supabase ist nicht konfiguriert (in Einstellungen eintragen).");
  return client;
}

// ── Anmeldung ───────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  const c = requireClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string) {
  const c = requireClient();
  const { data, error } = await c.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  stopSupabaseSync();
  const c = getClient();
  if (c) await c.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  const c = getClient();
  if (!c) return null;
  const { data } = await c.auth.getSession();
  return data.session;
}

export function onAuthChange(cb: (session: Session | null) => void): () => void {
  const c = getClient();
  if (!c) return () => {};
  const { data } = c.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
}

// ── Profile ─────────────────────────────────────────────────────────────────

export interface SupaProfile {
  id: string;
  name: string;
  avatar: string | null;
}

export async function listProfiles(): Promise<SupaProfile[]> {
  const c = getClient();
  if (!c) return [];
  const user = (await c.auth.getUser()).data.user;
  if (!user) return [];
  const { data, error } = await c
    .from("profiles")
    .select("id,name,avatar")
    .eq("user_id", user.id)
    .order("created_at");
  if (error) throw error;
  return (data as SupaProfile[]) ?? [];
}

export async function createProfile(name: string): Promise<SupaProfile> {
  const c = requireClient();
  const user = (await c.auth.getUser()).data.user;
  if (!user) throw new Error("Nicht angemeldet");
  const { data, error } = await c
    .from("profiles")
    .insert({ user_id: user.id, name })
    .select("id,name,avatar")
    .single();
  if (error) throw error;
  return data as SupaProfile;
}

export async function deleteProfile(id: string): Promise<void> {
  const c = requireClient();
  const { error } = await c.from("profiles").delete().eq("id", id);
  if (error) throw error;
}

// ── Verknüpfung lokales Profil ↔ Cloud-Profil ───────────────────────────────
// Genau hier lag der zweite Fehler: ohne diese Brücke wurde der Fortschritt des
// Profils "local" nie einem Cloud-Profil zugeordnet.

const LINK_SETTING = "supabase_profile_links";

type LinkMap = Record<string, string>;

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function loadLinks(): Promise<LinkMap> {
  try {
    const raw = await getSetting(LINK_SETTING);
    return raw ? (JSON.parse(raw) as LinkMap) : {};
  } catch {
    return {};
  }
}

async function saveLink(localId: string, cloudId: string): Promise<void> {
  const links = await loadLinks();
  links[localId] = cloudId;
  await setSetting(LINK_SETTING, JSON.stringify(links));
}

/** Verknüpftes Cloud-Profil (ohne etwas anzulegen). */
export async function linkedCloudProfile(localId: string): Promise<string | null> {
  if (isUuid(localId)) return localId; // das lokale Profil IST bereits ein Cloud-Profil
  return (await loadLinks())[localId] ?? null;
}

/**
 * Cloud-Profil für das aktuelle lokale Profil sicherstellen: verknüpftes
 * nehmen, sonst eines mit passendem Namen, sonst das erste, sonst neu anlegen.
 */
export async function ensureCloudProfile(localId: string, localName = "Lokal"): Promise<string | null> {
  const c = getClient();
  if (!c) return null;
  if (isUuid(localId)) return localId;

  const existing = await linkedCloudProfile(localId);
  if (existing) {
    // Prüfen, ob es das Profil in der Cloud noch gibt (könnte gelöscht sein)
    const { data } = await c.from("profiles").select("id").eq("id", existing).maybeSingle();
    if (data) return existing;
  }

  const session = await getSession();
  if (!session) return null;

  const profiles = await listProfiles();
  const byName = profiles.find((p) => p.name.toLowerCase() === localName.toLowerCase());
  const target = byName ?? profiles[0] ?? (await createProfile(localName || "Standard"));
  await saveLink(localId, target.id);
  return target.id;
}

// ── Fortschritt ─────────────────────────────────────────────────────────────

const ON_CONFLICT = "profile_id,media_type,tmdb_id,season,episode";

interface RemoteRow {
  media_type: "movie" | "episode";
  tmdb_id: number;
  season: number;
  episode: number;
  position_sec: number;
  duration_sec: number;
  watched: boolean;
  updated_at: number;
}

/**
 * Ein vollständiger Abgleich für EIN lokales Profil:
 * erst holen (Neueres gewinnt), dann alles Lokale hochschieben.
 */
export async function syncProgress(
  localProfileId: string,
  localName = "Lokal",
): Promise<{ pushed: number; pulled: number }> {
  const c = getClient();
  if (!c) return { pushed: 0, pulled: 0 };
  const session = await getSession();
  if (!session) return { pushed: 0, pulled: 0 };
  const cloudId = await ensureCloudProfile(localProfileId, localName);
  if (!cloudId) return { pushed: 0, pulled: 0 };

  // 1) holen
  let pulled = 0;
  const { data, error } = await c.from("watch_progress").select("*").eq("profile_id", cloudId);
  if (error) throw error;
  if (data?.length) {
    const rows: RemoteProgressRow[] = (data as RemoteRow[]).map((r) => ({
      mediaType: r.media_type,
      tmdbId: r.tmdb_id,
      season: r.season === -1 ? null : r.season,
      episode: r.episode === -1 ? null : r.episode,
      positionSec: r.position_sec,
      durationSec: r.duration_sec,
      watched: r.watched,
      updatedAt: r.updated_at,
    }));
    await applyRemoteProgress(localProfileId, rows);
    pulled = rows.length;
  }

  // 2) schieben — der komplette lokale Stand, nicht nur Änderungen. Bei diesen
  //    Datenmengen unkritisch und robust gegen jeden Zeigerfehler.
  const local = await listProgress(localProfileId);
  const toPush = local
    .filter((p) => p.tmdbId != null)
    .map((p) => ({
      profile_id: cloudId,
      media_type: p.mediaType,
      tmdb_id: p.tmdbId,
      season: p.season ?? -1,
      episode: p.episode ?? -1,
      position_sec: p.positionSec,
      duration_sec: p.durationSec,
      watched: p.watched,
      updated_at: p.updatedAt,
    }));
  if (toPush.length) {
    // in Häppchen, damit sehr große Bibliotheken nicht an Größenlimits scheitern
    for (let i = 0; i < toPush.length; i += 500) {
      const { error: upErr } = await c
        .from("watch_progress")
        .upsert(toPush.slice(i, i + 500), { onConflict: ON_CONFLICT });
      if (upErr) throw upErr;
    }
  }

  await syncFavorites(localProfileId, cloudId).catch((e) => console.warn("[supabase] Favoriten:", e));
  await touchDevice().catch(() => {});
  return { pushed: toPush.length, pulled };
}

/** Wie viele lokale Einträge könnten hochgeladen werden? (für die Nachfrage) */
export async function countLocalProgress(localProfileId: string): Promise<number> {
  const local = await listProgress(localProfileId).catch(() => []);
  return local.filter((p) => p.tmdbId != null).length;
}

// ── „Meine Liste“ ───────────────────────────────────────────────────────────

/** Favoriten in TMDb-Koordinaten abgleichen (beide Richtungen, additiv). */
export async function syncFavorites(localProfileId: string, cloudId: string): Promise<void> {
  const c = getClient();
  if (!c) return;
  const [favs, movies, shows] = await Promise.all([listFavorites(localProfileId), listMovies(), listShows()]);
  const movieById = new Map(movies.map((m) => [m.id, m]));
  const showById = new Map(shows.map((s) => [s.id, s]));

  // hoch
  const rows = favs
    .map((f) => {
      const tmdbId = f.mediaType === "movie" ? movieById.get(f.refId)?.tmdbId : showById.get(f.refId)?.tmdbId;
      return tmdbId
        ? {
            profile_id: cloudId,
            media_type: f.mediaType,
            tmdb_id: tmdbId,
            added_at: f.addedAt,
            removed: false,
            updated_at: f.addedAt,
          }
        : null;
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length) {
    await c.from("watch_favorites").upsert(rows, { onConflict: "profile_id,media_type,tmdb_id" });
  }

  // runter — was in der Cloud steht, aber lokal fehlt
  const { data } = await c.from("watch_favorites").select("*").eq("profile_id", cloudId).eq("removed", false);
  if (!data?.length) return;
  const haveMovie = new Set(rows.filter((r) => r.media_type === "movie").map((r) => r.tmdb_id));
  const haveShow = new Set(rows.filter((r) => r.media_type === "show").map((r) => r.tmdb_id));
  for (const r of data as { media_type: "movie" | "show"; tmdb_id: number }[]) {
    if (r.media_type === "movie") {
      if (haveMovie.has(r.tmdb_id)) continue;
      const m = movies.find((x) => x.tmdbId === r.tmdb_id);
      if (m) await toggleFavorite(localProfileId, "movie", m.id).catch(() => {});
    } else {
      if (haveShow.has(r.tmdb_id)) continue;
      const s = shows.find((x) => x.tmdbId === r.tmdb_id);
      if (s) await toggleFavorite(localProfileId, "show", s.id).catch(() => {});
    }
  }
}

// ── Geräteliste (welches Gerät hat wann abgeglichen) ────────────────────────

async function touchDevice(): Promise<void> {
  const c = getClient();
  if (!c) return;
  const user = (await c.auth.getUser()).data.user;
  if (!user) return;
  let key = localStorage.getItem("ghgflix.deviceKey");
  if (!key) {
    key = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("ghgflix.deviceKey", key);
  }
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  await c.from("sync_devices").upsert(
    {
      user_id: user.id,
      device_key: key,
      name: ua.includes("Windows") ? "Windows-PC" : ua.includes("Android") ? "Android-Gerät" : "GHGFlix-Gerät",
      platform: (typeof navigator !== "undefined" && navigator.platform) || "unbekannt",
      last_seen: Date.now(),
    },
    { onConflict: "user_id,device_key" },
  );
}

// ── Hintergrund-Abgleich ────────────────────────────────────────────────────

let syncTimer: number | null = null;
let syncProfile: string | null = null;
let syncName = "Lokal";
let syncErrorCount = 0;
let lastSyncErrorAt = 0;
let lastSyncAt = 0;
let lastError: string | null = null;
let lastPushed = 0;
let lastPulled = 0;
let running = false;

export interface SyncHealth {
  active: boolean;
  errors: number;
  lastErrorAt: number;
  lastError: string | null;
  lastSyncAt: number;
  lastPushed: number;
  lastPulled: number;
}

/** Klartext-Zustand für die Einstellungen-Seite. */
export function supabaseSyncHealth(): SyncHealth {
  return {
    active: syncTimer != null,
    errors: syncErrorCount,
    lastErrorAt: lastSyncErrorAt,
    lastError,
    lastSyncAt,
    lastPushed,
    lastPulled,
  };
}

async function syncTick(): Promise<void> {
  if (!syncProfile || !client || running) return;
  running = true;
  try {
    const r = await syncProgress(syncProfile, syncName);
    lastPushed = r.pushed;
    lastPulled = r.pulled;
    lastSyncAt = Date.now();
    lastError = null;
    syncErrorCount = 0;
  } catch (e) {
    syncErrorCount++;
    lastSyncErrorAt = Date.now();
    lastError = e instanceof Error ? e.message : String(e);
    // protokollieren statt Toast — eine Hintergrundschleife darf die
    // Oberfläche nicht zuspammen
    if (syncErrorCount === 1 || syncErrorCount % 10 === 0) {
      console.warn(`[supabase-sync] Fehler (${syncErrorCount}× in Folge):`, e);
    }
  } finally {
    running = false;
  }
}

/** Sofort einmal abgleichen (Knopf „Jetzt synchronisieren“). */
export async function syncNow(): Promise<SyncHealth> {
  await syncTick();
  return supabaseSyncHealth();
}

function onVisibility(): void {
  if (document.visibilityState === "visible") void syncTick();
}

/**
 * Hintergrund-Abgleich starten. Anders als früher läuft er für JEDES Profil —
 * auch für „Lokal“ —, sobald eine Anmeldung besteht.
 */
export function startSupabaseSync(localProfileId: string, localName = "Lokal"): void {
  syncProfile = localProfileId;
  syncName = localName;
  if (syncTimer != null) {
    void syncTick();
    return;
  }
  syncTimer = window.setInterval(() => void syncTick(), 60_000);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onVisibility);
  void syncTick();
}

export function stopSupabaseSync(): void {
  if (syncTimer != null) window.clearInterval(syncTimer);
  syncTimer = null;
  syncProfile = null;
  document.removeEventListener("visibilitychange", onVisibility);
  window.removeEventListener("online", onVisibility);
}

/**
 * Beim Start aufrufen: besteht eine Anmeldung, fährt der Abgleich hoch.
 * Gibt zurück, ob er läuft — die Oberfläche kann das anzeigen.
 */
export async function autoStartSync(localProfileId: string, localName = "Lokal"): Promise<boolean> {
  const c = await initSupabase();
  if (!c) return false;
  const session = await getSession();
  if (!session) return false;
  startSupabaseSync(localProfileId, localName);
  return true;
}

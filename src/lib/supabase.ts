import { createClient, type SupabaseClient, type Session } from "@supabase/supabase-js";
import { getSetting, listProgress, applyRemoteProgress, type RemoteProgressRow } from "./api";

let client: SupabaseClient | null = null;
let initialized = false;

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
  return initSupabase();
}

export function getClient(): SupabaseClient | null {
  return client;
}

export function isConfigured(): boolean {
  return !!client;
}

// ===== auth =====

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

// ===== profiles =====

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

// ===== progress sync =====

const ON_CONFLICT = "profile_id,media_type,tmdb_id,season,episode";

/** Pull remote progress (apply newest to local), then push the merged local set back. */
export async function syncProgress(profileId: string): Promise<void> {
  const c = getClient();
  if (!c || profileId === "local") return;

  // 1) pull
  const { data, error } = await c.from("watch_progress").select("*").eq("profile_id", profileId);
  if (!error && data) {
    const rows: RemoteProgressRow[] = data.map((r: any) => ({
      mediaType: r.media_type,
      tmdbId: r.tmdb_id,
      season: r.season === -1 ? null : r.season,
      episode: r.episode === -1 ? null : r.episode,
      positionSec: r.position_sec,
      durationSec: r.duration_sec,
      watched: r.watched,
      updatedAt: r.updated_at,
    }));
    if (rows.length) await applyRemoteProgress(profileId, rows);
  }

  // 2) push merged local set
  const local = await listProgress(profileId);
  const toPush = local
    .filter((p) => p.tmdbId != null)
    .map((p) => ({
      profile_id: profileId,
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
    await c.from("watch_progress").upsert(toPush, { onConflict: ON_CONFLICT });
  }
}

function requireClient(): SupabaseClient {
  if (!client) throw new Error("Supabase ist nicht konfiguriert (in Einstellungen eintragen).");
  return client;
}

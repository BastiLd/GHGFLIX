// Sync with a GHGFlix server (the ZimaOS Docker container). Watch progress is
// exchanged in TMDb coordinates, so it matches the same title on any device —
// exactly like the Supabase sync, but against your own box in the LAN/VPN.
//
// Endpoint auto-switching: several addresses can be configured (lokale IP,
// Domain, Tailscale). In "auto" mode the first reachable one wins, so the
// app keeps syncing at home AND on the go without touching anything.
import { listMovies, listProgress, listShows, listFavorites, applyRemoteProgress, getSetting, setSetting } from "./api";
import { invoke } from "./backend";
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

export async function serverProfileRequest<T>(path:string,method="GET",body?:unknown):Promise<T>{
  const cfg=await loadServerConfig(),base=await resolveServer(cfg);
  if(!cfg.enabled||!base)throw Error("Medienserver nicht erreichbar.");
  return serverApi<T>(base,cfg,path,{method,body:body?JSON.stringify(body):undefined});
}

/** Eine stabile Zuordnung überlebt Umbenennen; niemals beim Lesen Profile anlegen. */
async function serverProfileId(base:string,cfg:ServerConfig,localId:string,name:string):Promise<number>{
  const profiles=await serverApi<{id:number;name:string;avatar:string|null;supabase_id:string|null}[]>(base,cfg,"/api/profiles");
  const links=JSON.parse((await getSetting("server_profile_links"))||"{}");
  const cloudLinks=JSON.parse((await getSetting("supabase_profile_links"))||"{}");
  const hit=profiles.find(p=>String(p.id)===String(links[localId]))
    ??profiles.find(p=>p.supabase_id===(cloudLinks[localId]||localId))
    ??profiles.find(p=>localId==='server:'+p.id)
    ??profiles.find(p=>p.name.toLowerCase()===name.toLowerCase())
    ??(profiles.length===1?profiles[0]:null);
  if(!hit)throw Error("Bitte zuerst das passende Server-Profil auswählen.");
  links[localId]=hit.id;await setSetting("server_profile_links",JSON.stringify(links));
  if(useStore.getState().profileId===localId)useStore.getState().setProfile(localId,hit.name,hit.avatar);
  return hit.id;
}
let activeSync:Promise<{pushed:number;pulled:number}|null>|null=null;
export function syncOnce():Promise<{pushed:number;pulled:number}|null>{
  if(activeSync)return activeSync;
  activeSync=syncRound().finally(()=>{activeSync=null;});return activeSync;
}
async function syncRound():Promise<{pushed:number;pulled:number}|null>{
  const cfg=await loadServerConfig();if(!cfg.enabled)return null;
  const base=await resolveServer(cfg);if(!base)throw Error("Medienserver nicht erreichbar.");
  const {profileId,profileName}=useStore.getState();
  const spid=await serverProfileId(base,cfg,profileId,profileName);
  const path=(p:string)=>p+'?profile='+spid;
  const local=await listProgress(profileId);
  const rows:SyncRow[]=local.filter(p=>p.tmdbId!=null).map(p=>({mediaType:p.mediaType,tmdbId:p.tmdbId!,season:p.season??-1,episode:p.episode??-1,position:p.positionSec,duration:p.durationSec,watched:p.watched,updatedAt:p.updatedAt}));
  for(let i=0;i<rows.length;i+=500)await serverApi(base,cfg,path('/api/sync/progress'),{method:'POST',body:JSON.stringify({rows:rows.slice(i,i+500)})});
  const remote=await serverApi<{rows:{media_type:'movie'|'episode';tmdb_id:number;season:number;episode:number;position:number;duration:number;watched:number;updated_at:number}[]}>(base,cfg,path('/api/sync/progress'));
  await applyRemoteProgress(profileId,remote.rows.map(r=>({mediaType:r.media_type,tmdbId:r.tmdb_id,season:r.season,episode:r.episode,positionSec:r.position,durationSec:r.duration,watched:!!r.watched,updatedAt:r.updated_at})));
  const [favs,movies,shows]=await Promise.all([listFavorites(profileId),listMovies(),listShows()]);
  type Fav={media_type:'movie'|'show';tmdb_id:number;added_at:number;removed:boolean;updated_at:number};
  const journalKey='favorite_sync_'+profileId;
  const journal:Record<string,Fav>=JSON.parse((await getSetting(journalKey))||'{}');
  const states=new Map<string,Fav>();
  for(const f of favs){const m=(f.mediaType==='movie'?movies:shows).find(x=>x.id===f.refId);if(m?.tmdbId)states.set(f.mediaType+':'+m.tmdbId,{media_type:f.mediaType,tmdb_id:m.tmdbId,added_at:f.addedAt,updated_at:f.addedAt,removed:false});}
  for(const [k,r]of Object.entries(journal))if(!states.has(k)||r.updated_at>=states.get(k)!.updated_at)states.set(k,r);
  const payload=[...states.values()];for(let i=0;i<payload.length;i+=500)await serverApi(base,cfg,path('/api/sync/favorites'),{method:'POST',body:JSON.stringify({rows:payload.slice(i,i+500)})});
  const incoming=await serverApi<{rows:Fav[]}>(base,cfg,path('/api/sync/favorites'));
  for(const r of incoming.rows){
    const k=r.media_type+':'+r.tmdb_id;
    if(states.has(k)&&states.get(k)!.updated_at>r.updated_at)continue;
    // Ein Klick während des Netzabrufs muss auch in der sichtbaren Merkliste
    // gewinnen, nicht erst im abschließend gespeicherten Änderungsjournal.
    const [rawCurrent,currentFavorites]=await Promise.all([getSetting(journalKey),listFavorites(profileId)]);
    const current:Record<string,Fav>=JSON.parse(rawCurrent||'{}');
    if(current[k]&&current[k].updated_at>r.updated_at){journal[k]=current[k];continue;}
    const m=(r.media_type==='movie'?movies:shows).find(x=>x.tmdbId===r.tmdb_id);
    if(m){const present=currentFavorites.some(f=>f.mediaType===r.media_type&&f.refId===m.id);if(present===!!r.removed)await invoke('toggle_favorite',{profileId,mediaType:r.media_type,refId:m.id});}
    journal[k]=r;
  }
  const latest:Record<string,Fav>=JSON.parse((await getSetting(journalKey))||'{}');for(const [k,r]of Object.entries(latest))if(!journal[k]||r.updated_at>journal[k].updated_at)journal[k]=r;
  await setSetting(journalKey,JSON.stringify(journal));
  window.dispatchEvent(new Event('ghgflix:sync'));
  return {pushed:rows.length,pulled:remote.rows.length};
}

let loop: number | null = null;

/** Background sync every 30 s (call once at app start; safe to re-call). */
export function startServerSync(): void {
  if (loop != null) return;
  const tick = () => void syncOnce().catch(() => {});
  tick();
  loop = window.setInterval(tick, 30_000);
}
export function stopServerSync():void { if(loop!=null){window.clearInterval(loop);loop=null;} }

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

// Cloud-Abgleich: Profile, Fortschritt und Merkliste. Der Schlüssel bleibt
// ausschließlich auf dem NAS; alle Cloud-Zeilen sind auf dessen Besitzer begrenzt.
import { openDb, settingOr, getSetting } from "./db.js";
const url=()=>String(settingOr("supabase_url","SUPABASE_URL","")).replace(/\/$/,"");
const key=()=>settingOr("supabase_key","SUPABASE_SERVICE_KEY","");
const owner=()=>settingOr("supabase_user_id","SUPABASE_USER_ID","");
export const supabaseConfigured=()=>!!(url()&&key());
export const pushEnabled=()=>supabaseConfigured()&&getSetting("supabase_push")!=="off";
export const pullEnabled=()=>supabaseConfigured()&&getSetting("supabase_pull")!=="off";
const status={lastSyncAt:0,lastPushed:0,lastPulled:0,lastError:null,lastErrorAt:0};
export const supabaseStatus=()=>({configured:supabaseConfigured(),...status});
async function rest(table,{method="GET",body,params={}}={}) {
  const u=new URL(`${url()}/rest/v1/${table}`);
  for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
  const r=await fetch(u,{method,headers:{apikey:key(),Authorization:`Bearer ${key()}`,
    "Content-Type":"application/json",Prefer:"resolution=merge-duplicates,return=representation"},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error(`Cloud-Abgleich ${table}: HTTP ${r.status}`);
  const text=await r.text();return text?JSON.parse(text):null;
}
async function all(table,params) {
  const rows=[];
  for(let offset=0;;offset+=500){
    const page=await rest(table,{params:{...params,limit:500,offset}});
    rows.push(...page);if(page.length<500)return rows;
  }
}
function scoped(){if(!owner())throw Error("Cloud-Konto am Server noch nicht zugeordnet (Benutzer-ID fehlt).");}
async function profiles() {
  scoped();const d=openDb();
  let remote=await all("profiles",{select:"*",user_id:`eq.${owner()}`,order:"id"});
  if(pushEnabled())for(const p of d.prepare('SELECT * FROM profiles').all()){
    let r=remote.find(x=>x.id===p.supabase_id);
    if(!r&&!p.supabase_id)r=remote.find(x=>x.name===p.name);
    if(!r&&!p.supabase_id){
      [r]=await rest('profiles',{method:'POST',body:{user_id:owner(),name:p.name,avatar:p.avatar,updated_at:p.updated_at||Date.now()}});
      remote.push(r);
    }
    if(!r)continue; // Ein anderswo gelöschtes Profil niemals neu anlegen.
    if(!p.supabase_id)d.prepare('UPDATE profiles SET supabase_id=? WHERE id=?').run(r.id,p.id);
    if(p.updated_at>(r.updated_at||0)){
      [r]=await rest('profiles',{method:'PATCH',params:{id:`eq.${r.id}`,user_id:`eq.${owner()}`},
        body:{name:p.name,avatar:p.avatar,updated_at:p.updated_at}});
      remote=remote.map(x=>x.id===r.id?r:x);
    }
  }
  if(pullEnabled())for(const r of remote){
    const p=d.prepare('SELECT * FROM profiles WHERE supabase_id=?').get(r.id);
    if(p){
      if((r.updated_at||0)>=p.updated_at)d.prepare('UPDATE profiles SET name=?,avatar=?,updated_at=? WHERE id=?').run(r.name,r.avatar,r.updated_at||0,p.id);
    }else{
      const named=d.prepare('SELECT id FROM profiles WHERE name=? AND supabase_id IS NULL').get(r.name);
      if(named)d.prepare('UPDATE profiles SET supabase_id=?,avatar=?,updated_at=? WHERE id=?').run(r.id,r.avatar,r.updated_at||0,named.id);
      else d.prepare('INSERT INTO profiles(name,avatar,supabase_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(r.name,r.avatar,r.id,Date.now(),r.updated_at||0);
    }
  }
  const allowed=new Set(remote.map(p=>p.id));
  return d.prepare('SELECT * FROM profiles WHERE supabase_id IS NOT NULL').all().filter(p=>allowed.has(p.supabase_id));
}
async function progressPull(ps) {
  const d=openDb();let count=0;
  for(const p of ps){
    const rows=await all('watch_progress',{select:'*',profile_id:`eq.${p.supabase_id}`,order:'media_type,tmdb_id,season,episode'});
    for(const r of rows)d.prepare(`INSERT INTO pending_progress(profile_id,media_type,tmdb_id,season,episode,position,duration,watched,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(profile_id,media_type,tmdb_id,season,episode) DO UPDATE SET
      position=excluded.position,duration=excluded.duration,watched=excluded.watched,updated_at=excluded.updated_at
      WHERE excluded.updated_at>pending_progress.updated_at`).run(p.id,r.media_type,r.tmdb_id,r.season,r.episode,r.position_sec,r.duration_sec,r.watched?1:0,r.updated_at);
    count+=rows.length;
  }
  const {applyPendingProgress}=await import('./scanner.js');applyPendingProgress(d);return count;
}
async function progressPush(ps){
  const d=openDb();let count=0;
  for(const p of ps){
    const rows=d.prepare(`SELECT pr.*,coalesce(m.tmdb_id,s.tmdb_id) tmdb_id,e.season,e.episode FROM progress pr
      LEFT JOIN movies m ON pr.media_type='movie' AND m.id=pr.ref_id
      LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id LEFT JOIN shows s ON s.id=e.show_id
      WHERE pr.profile_id=? AND coalesce(m.tmdb_id,s.tmdb_id) IS NOT NULL`).all(p.id);
    // Auch Titel anderer Geräte weiterreichen, deren Datei dieses NAS nicht hat.
    // Andernfalls endet der Desktop-Abgleich unsichtbar in pending_progress.
    const newest=new Map();
    for(const r of [...d.prepare('SELECT * FROM pending_progress WHERE profile_id=?').all(p.id),...rows]){
      const k=[r.media_type,r.tmdb_id,r.season??-1,r.episode??-1].join(':');
      if(!newest.has(k)||newest.get(k).updated_at<r.updated_at)newest.set(k,r);
    }
    const payload=[...newest.values()].map(r=>({profile_id:p.supabase_id,media_type:r.media_type,tmdb_id:r.tmdb_id,season:r.season??-1,episode:r.episode??-1,
      position_sec:r.position,duration_sec:r.duration,watched:!!r.watched,updated_at:r.updated_at}));
    for(let i=0;i<payload.length;i+=500)await rest('watch_progress',{method:'POST',params:{on_conflict:'profile_id,media_type,tmdb_id,season,episode'},body:payload.slice(i,i+500)});
    count+=payload.length;
  }return count;
}
async function favorites(ps){
  const d=openDb();
  for(const p of ps){
    // Vorhandene Einträge einmal übernehmen; Tombstones niemals überschreiben.
    d.prepare(`INSERT OR IGNORE INTO favorite_sync(profile_id,media_type,tmdb_id,added_at,removed,updated_at)
      SELECT f.profile_id,f.media_type,coalesce(m.tmdb_id,s.tmdb_id),f.added_at,0,f.added_at FROM favorites f
      LEFT JOIN movies m ON f.media_type='movie' AND m.id=f.ref_id LEFT JOIN shows s ON f.media_type='show' AND s.id=f.ref_id
      WHERE f.profile_id=? AND coalesce(m.tmdb_id,s.tmdb_id) IS NOT NULL`).run(p.id);
    if(pushEnabled()){
      const rows=d.prepare('SELECT * FROM favorite_sync WHERE profile_id=?').all(p.id).map(r=>({...r,profile_id:p.supabase_id,removed:!!r.removed}));
      for(let i=0;i<rows.length;i+=500)await rest('watch_favorites',{method:'POST',params:{on_conflict:'profile_id,media_type,tmdb_id'},body:rows.slice(i,i+500)});
    }
    if(pullEnabled()){
      const rows=await all('watch_favorites',{select:'*',profile_id:`eq.${p.supabase_id}`,order:'media_type,tmdb_id'});
      for(const r of rows){
        const old=d.prepare('SELECT updated_at FROM favorite_sync WHERE profile_id=? AND media_type=? AND tmdb_id=?').get(p.id,r.media_type,r.tmdb_id);
        if(old&&old.updated_at>r.updated_at)continue;
        d.prepare(`INSERT INTO favorite_sync VALUES(?,?,?,?,?,?) ON CONFLICT(profile_id,media_type,tmdb_id) DO UPDATE SET
          added_at=excluded.added_at,removed=excluded.removed,updated_at=excluded.updated_at`).run(p.id,r.media_type,r.tmdb_id,r.added_at,r.removed?1:0,r.updated_at);
        const table=r.media_type==='movie'?'movies':'shows';
        const ref=d.prepare(`SELECT id FROM ${table} WHERE tmdb_id=?`).get(r.tmdb_id)?.id;if(!ref)continue;
        if(r.removed)d.prepare('DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?').run(p.id,r.media_type,ref);
        else d.prepare('INSERT OR IGNORE INTO favorites VALUES(?,?,?,?)').run(p.id,r.media_type,ref,r.added_at);
      }
    }
  }
}
let running=null;
export function syncNow(){
  if(running)return running;
  running=(async()=>{
    if(!supabaseConfigured())return {pushed:0,pulled:0};
    try{
      const ps=await profiles();let pulled=0,pushed=0;
      if(pullEnabled())pulled=await progressPull(ps);
      if(pushEnabled())pushed=await progressPush(ps);
      await favorites(ps);
      Object.assign(status,{lastSyncAt:Date.now(),lastPushed:pushed,lastPulled:pulled,lastError:null,lastErrorAt:0});
      return {pushed,pulled};
    }catch(e){status.lastError=String(e.message).slice(0,300);status.lastErrorAt=Date.now();throw e;}
  })().finally(()=>{running=null;});return running;
}
export const pullFromSupabase=syncNow;
export const pushToSupabase=syncNow;
export const importFromSupabase=syncNow;
export function startSupabaseLoop(){
  const tick=()=>syncNow().catch(e=>console.error('[supabase]',e.message));
  setTimeout(tick,5000).unref();setInterval(tick,30000).unref();
}

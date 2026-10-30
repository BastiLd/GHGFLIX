import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
process.env.DATA_DIR=mkdtempSync(join(tmpdir(),'ghgflix-cloud-'));
process.env.SUPABASE_URL='https://cloud.invalid';
process.env.SUPABASE_SERVICE_KEY='test-only';
process.env.SUPABASE_USER_ID='owner';
const {openDb,resolveProfile}=await import('../src/db.js');
const {recordFavorite,saveServerProfile}=await import('../src/profile.js');
const {syncNow,supabaseStatus}=await import('../src/supabase.js');
const d=openDb();
d.prepare('UPDATE profiles SET name=?,supabase_id=? WHERE id=1').run('Alt','cloud-profile');
d.prepare('INSERT INTO movies(title,path,tmdb_id,added_at) VALUES(?,?,?,?)').run('Film','/test.mkv',123,1);
const cloud={profiles:[{id:'cloud-profile',user_id:'owner',name:'Basti',avatar:null,updated_at:10}],watch_progress:[],watch_favorites:[]};
let requests=0;
global.fetch=async(url,opt={})=>{
  requests++;const u=new URL(url),table=u.pathname.split('/').pop();
  if(table==='profiles')assert.equal(u.searchParams.get('user_id'),'eq.owner');
  if(opt.method==='PATCH'){
    Object.assign(cloud.profiles[0],JSON.parse(opt.body));return Response.json(cloud.profiles);
  }
  if(opt.method==='POST'){
    for(const r of JSON.parse(opt.body)){
      const old=cloud[table].find(x=>x.profile_id===r.profile_id&&x.tmdb_id===r.tmdb_id&&x.media_type===r.media_type);
      if(!old)cloud[table].push(r);else if(r.updated_at>=old.updated_at)Object.assign(old,r);
    }return Response.json([]);
  }
  const offset=+(u.searchParams.get('offset')||0),limit=+(u.searchParams.get('limit')||500);
  return Response.json(cloud[table].slice(offset,offset+limit));
};
await syncNow();
assert.equal(d.prepare('SELECT name FROM profiles WHERE id=1').get().name,'Basti');
assert.equal(resolveProfile('cloud-profile'),'1');
saveServerProfile(1,{name:'Basti Neu',avatar:null});
await syncNow();assert.equal(cloud.profiles[0].name,'Basti Neu');
assert.throws(()=>saveServerProfile(1,{name:'X',avatar:'javascript:bad'}));
saveServerProfile(1,{name:'Basti Neu',avatar:'data:image/png;base64,aGVsbG8='});
saveServerProfile(1,{name:'Basti'});
assert.equal(d.prepare('SELECT avatar FROM profiles WHERE id=1').get().avatar,'data:image/png;base64,aGVsbG8=');
d.prepare('INSERT INTO favorites VALUES(1,?,?,?)').run('movie',1,11);
recordFavorite(d,1,'movie',1,false);await syncNow();assert.equal(cloud.watch_favorites[0].removed,false);
recordFavorite(d,1,'movie',1,true);d.prepare('DELETE FROM favorites').run();await syncNow();
assert.equal(cloud.watch_favorites[0].removed,true);assert.equal(d.prepare('SELECT count(*) n FROM favorites').get().n,0);
// Änderung von anderem Gerät muss ebenfalls ankommen.
cloud.watch_favorites[0].removed=false;cloud.watch_favorites[0].updated_at+=1000;
await syncNow();assert.equal(d.prepare('SELECT count(*) n FROM favorites').get().n,1);
cloud.watch_progress=Array.from({length:505},(_,i)=>({profile_id:'cloud-profile',media_type:'movie',tmdb_id:i+1000,season:-1,episode:-1,position_sec:0,duration_sec:10,watched:true,updated_at:20}));
await syncNow();assert.equal(d.prepare('SELECT count(*) n FROM pending_progress').get().n,505);
// Desktop-Titel ohne NAS-Datei müssen bis in die Cloud gelangen.
d.prepare('INSERT INTO pending_progress VALUES(1,?,?,?,?,?,?,?,?)').run('movie',99999,-1,-1,0,120,true?1:0,30);
await syncNow();assert.equal(cloud.watch_progress.find(r=>r.tmdb_id===99999)?.watched,true);
assert.equal(supabaseStatus().lastError,null);
// Parallele Aufrufe teilen einen Durchgang und können sich nicht überholen.
const a=syncNow(),b=syncNow();assert.equal(a,b);await a;
console.log('Cloud-Regressionsprüfung bestanden: Profile in beide Richtungen, UUID-Zuordnung, private Bilder, Entfernen/Wiederaufnahme, 505 Zeilen, kein paralleler Sync.',requests);

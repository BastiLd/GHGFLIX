import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'ghgflix-account-ui-'));
Object.assign(process.env,{DATA_DIR:dir,PORT:'19848',HOST:'127.0.0.1',GHGFLIX_WEB_DIR:resolve('dist'),GHGFLIX_PASSWORD:'server-ui-password',GHGFLIX_ACCOUNT_SETUP_KEY:'fixture-owner-setup',AUTO_SCAN:'off',SUPABASE_URL:'',SUPABASE_SERVICE_KEY:'',SUPABASE_USER_ID:'',TMDB_API_KEY:'',FEED_INTERVAL_SEC:'99999'});
const {openDb}=await import('../../server/src/db.js');const db=openDb();
for(const [id,title,cert]of [[1,'Familienfilm','6'],[2,'Erwachsenenfilm','18'],[3,'Unbekannte Freigabe',null]])db.prepare('INSERT INTO movies(id,title,path,cert,duration,added_at) VALUES(?,?,?,?,90,?)').run(id,title,resolve(`tests/.generated/${id}.mp4`),cert,Date.now());
await import('../../server/src/index.js');
process.on('exit',()=>{try{db.close();rmSync(dir,{recursive:true,force:true});}catch{}});

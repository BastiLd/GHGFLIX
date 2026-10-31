import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'ghgflix-account-isolation-'));
const project='b14ed30d-3ecc-4465-ac79-7988b90ab0d8';
Object.assign(process.env,{DATA_DIR:dir,EXPO_PUSH_ENABLED:'1',EXPO_PUSH_PROJECT_ID:project,PUSH_CONTACT:'mailto:test@example.test'});
const {accountContext}=await import('../src/account-context.js');
const {openDb,setSetting,getSetting}=await import('../src/db.js');
const n=await import('../src/native-push.js'),w=await import('../src/push.js');
const as=(id,fn)=>accountContext.run({accountId:id},fn);
const token='ExpoPushToken[abcdefghijklmnop]';
const sub={endpoint:'https://fcm.googleapis.com/fcm/send/fixture',keys:{p256dh:Buffer.alloc(65,1).toString('base64url'),auth:Buffer.alloc(16,2).toString('base64url')}};
try{
  await Promise.all([1,2].map(id=>as(id,async()=>{
    setSetting('feeds',JSON.stringify([{id,name:'Private '+id}]));
    await new Promise(r=>setTimeout(r,id===1?20:5));
    assert.equal(JSON.parse(getSetting('feeds'))[0].id,id);
  })));
  as(1,()=>{n.subscribeNativePush(token,project);w.subscribePush(sub);});
  as(2,()=>{assert(!n.nativePushStatus([token]).registered);assert(!w.pushStatus(sub.endpoint).registered);n.unsubscribeNativePush([token]);w.unsubscribePush(sub.endpoint);});
  as(1,()=>{assert(n.nativePushStatus([token]).registered);assert(w.pushStatus(sub.endpoint).registered);});
  const reply=data=>({ok:true,json:async()=>({data})});
  await as(2,()=>n.sendNativePosts([{feedId:'f'}],[{id:'f',benachrichtigen:true}],async()=>{throw Error('Foreign delivery');}));
  await as(1,()=>n.sendNativePosts([{feedId:'f'}],[{id:'f',benachrichtigen:true}],async()=>{
    // The same device moves to account 2 while account 1's send is in flight.
    as(2,()=>n.subscribeNativePush(token,project));
    return reply([{status:'ok',id:'old-account-receipt'}]);
  }));
  assert.equal(openDb().prepare('SELECT COUNT(*) n FROM native_push_receipts').get().n,0);
  await as(2,()=>n.sendNativePosts([{feedId:'f'}],[{id:'f',benachrichtigen:true}],async()=>reply([{status:'ok',id:'renewal'}])));
  await n.checkNativeReceipts(async()=>{
    as(1,()=>n.subscribeNativePush(token,project));
    return reply({renewal:{status:'error',details:{error:'DeviceNotRegistered'}}});
  },Date.now()+16*60_000);
  assert(as(1,()=>n.nativePushStatus([token]).registered));
  console.log('Concurrent account channels, web/native push ownership, foreign unsubscribe, account switch during delivery and stale receipt renewal passed.');
}finally{openDb().close();rmSync(dir,{recursive:true,force:true});}

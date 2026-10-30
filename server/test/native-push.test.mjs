import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
const dir=mkdtempSync(join(tmpdir(),"ghgflix-native-push-"));process.env.DATA_DIR=dir;
const p=await import("../src/native-push.js");const {openDb,setSetting}=await import("../src/db.js");
const project="b14ed30d-3ecc-4465-ac79-7988b90ab0d8", token="ExpoPushToken[abcdefghijklmnop]", old="ExponentPushToken[oldabcdefghijkl]";
const posts=[{feedId:"on"},{feedId:"off"}], feeds=[{id:"on",benachrichtigen:true}];
const reply=data=>({ok:true,json:async()=>({data})});
try {
  delete process.env.EXPO_PUSH_ENABLED;process.env.EXPO_PUSH_PROJECT_ID=project;
  assert.equal(p.nativePushStatus().configured,false);assert.throws(()=>p.subscribeNativePush(token,project));
  process.env.EXPO_PUSH_ENABLED="1";assert.equal(p.nativePushStatus().configured,true);
  assert.throws(()=>p.subscribeNativePush("https://evil.test",project));assert.throws(()=>p.subscribeNativePush(token,"wrong"));
  p.subscribeNativePush(old,project);p.subscribeNativePush(token,project,[old]);
  assert.equal(p.nativePushStatus([old]).registered,false);assert.equal(p.nativePushStatus([token]).registered,true);
  setSetting("server_id","isolated");
  let sent=0;
  const transport=async(url,options)=>{
    sent++;assert.equal(url,"https://exp.host/--/api/v2/push/send");
    const messages=JSON.parse(options.body);assert.equal(messages.length,1);
    assert.deepEqual(messages[0].data,{screen:"channels",serverId:"isolated"});
    assert.equal(messages[0].body,"1 neue Beiträge in deinen Kanälen");return reply([{status:"ok",id:"receipt-one"}]);
  };
  await p.sendNativePosts([{feedId:"off"}],feeds,transport);assert.equal(sent,0);
  await p.sendNativePosts(posts,feeds,transport);assert.equal(sent,1);
  assert.equal(openDb().prepare("SELECT COUNT(*) n FROM native_push_receipts").get().n,1);
  await p.checkNativeReceipts(async()=>{throw new Error("Too early");});
  await p.checkNativeReceipts(async(url,options)=>{
    assert.ok(url.endsWith("/getReceipts"));assert.deepEqual(JSON.parse(options.body),{ids:["receipt-one"]});
    return reply({"receipt-one":{status:"error",details:{error:"DeviceNotRegistered"}}});
  },Date.now()+16*60_000);
  assert.equal(p.nativePushStatus([token]).registered,false);
  p.subscribeNativePush(token,project);
  await p.sendNativePosts(posts,feeds,async()=>reply([{status:"error",details:{error:"DeviceNotRegistered"}}]));
  assert.equal(p.nativePushStatus([token]).registered,false);
  p.subscribeNativePush(token,project);
  await p.sendNativePosts(posts,feeds,async()=>{p.unsubscribeNativePush([token]);return reply([{status:"ok",id:"late"}]);});
  assert.equal(openDb().prepare("SELECT COUNT(*) n FROM native_push_receipts").get().n,0);
  p.subscribeNativePush(token,project);
  await assert.rejects(p.sendNativePosts(posts,feeds,async()=>({ok:false,status:503})),/503/);
  assert.equal(p.nativePushStatus([token]).registered,true);
  console.log("Native push: opt-in/configuration, project binding, renewal, preferences, tickets/receipts, expiry, unsubscribe race and provider failure passed (mock transport).");
} finally {openDb().close();rmSync(dir,{recursive:true,force:true});}

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir=mkdtempSync(join(tmpdir(),"ghgflix-feed-races-"));process.env.DATA_DIR=dir;
const db=await import("../src/db.js");const k=await import("../src/kanaele.js");
const feed={id:"f",art:"blog",titel:"Original",feedUrl:"https://fixture.test/rss",zuletzt:1,benachrichtigen:true};
const item={id:"f:old",feedId:"f",art:"blog",titel:"Alt",gelesen:false,gemerkt:false,gesehen:false,veroeffentlicht:1};
const xml='<rss><channel><title>Source title</title><item><guid>new</guid><title>New</title></item></channel></rss>';
const pending=[];
const original=global.fetch;global.fetch=async()=>new Promise(r=>pending.push(()=>r(new Response(xml))));
const reset=()=>{db.setSetting("feeds",JSON.stringify([feed]));db.setSetting("feed_items",JSON.stringify([item]));};
try {
  reset();const first=k.abholen("f");
  await new Promise(r=>setImmediate(r));assert.equal(pending.length,1);
  k.feedAendern("f",{titel:"Mein Name",gruppeIds:["avatar","alles"],benachrichtigen:false});
  k.merken(item.id,true);k.gesehenSetzen(item.id,true);k.formatSetzen(item.id,"podcasts");
  pending.shift()();await first;
  assert.equal(k.feedsLaden()[0].titel,"Mein Name");
  assert.deepEqual(k.gruppenIds(k.feedsLaden()[0]),["avatar","alles"]);
  assert.equal(k.feedsLaden()[0].benachrichtigen,false);
  const saved=k.beitraege({}).find(b=>b.id===item.id);
  assert.equal(saved.gemerkt,true);assert.equal(saved.gesehen,true);assert.equal(saved.formatOverride,"podcasts");
  const refresh=k.abholen("f");await new Promise(r=>setImmediate(r));pending.shift()();await refresh;
  assert.equal(k.feedsLaden()[0].titel,"Mein Name");
  reset();const deleting=k.abholen("f");await new Promise(r=>setImmediate(r));k.abbestellen("f");pending.shift()();await deleting;
  assert.equal(k.feedsLaden().length,0);assert.equal(k.beitraege({}).length,0);
  reset();const a=k.abholen("f"),b=k.abholen("f");await new Promise(r=>setImmediate(r));pending.shift()();const na=await a;pending.shift()();const nb=await b;
  assert.equal(na.length+nb.length,1);assert.equal(k.beitraege({}).length,2);
  // Adding a channel also awaits network requests. Changes during that window must survive.
  const finish = async (...promises) => {
    let done = false;
    const outcome = Promise.allSettled(promises).then((r) => { done = true; return r; });
    for (let i = 0; i < 100 && !done; i++) {
      await new Promise(r => setImmediate(r));
      pending.splice(0).forEach(release => release());
    }
    assert.ok(done, "subscription did not settle");
    return outcome;
  };
  reset(); const adding = k.abonnieren("UCabcdefghijklmnopqrstuv", "youtube");
  await new Promise(r => setImmediate(r));
  k.feedAendern("f", { titel: "Edited during add", gruppeIds: ["g1", "g2"], benachrichtigen: false });
  assert.equal((await finish(adding))[0].status, "fulfilled");
  assert.equal(k.feedsLaden().find(f => f.id === "f").titel, "Edited during add");
  assert.deepEqual(k.gruppenIds(k.feedsLaden().find(f => f.id === "f")), ["g1", "g2"]);
  reset(); const removeDuringAdd = k.abonnieren("UCabcdefghijklmnopqrstuv", "youtube");
  await new Promise(r => setImmediate(r)); k.abbestellen("f"); await finish(removeDuringAdd);
  assert.equal(k.feedsLaden().some(f => f.id === "f"), false);
  reset(); const different = await finish(k.abonnieren("UCabcdefghijklmnopqrstuv"), k.abonnieren("UCzyxwvutsrqponmlkjihgfe"));
  assert.ok(different.every(r => r.status === "fulfilled")); assert.equal(k.feedsLaden().length, 3);
  reset(); const same = await finish(k.abonnieren("UCabcdefghijklmnopqrstuv"), k.abonnieren("UCabcdefghijklmnopqrstuv"));
  assert.equal(same.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(same.filter(r => r.status === "rejected").length, 1);
  assert.equal(k.feedsLaden().length, 2);
  console.log("Feed races: concurrent edits, persistent custom title, unsubscribe, overlapping refresh and concurrent subscription commits passed.");
} finally {global.fetch=original;db.openDb().close();rmSync(dir,{recursive:true,force:true});}

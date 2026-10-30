import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const dir=mkdtempSync(join(tmpdir(),"ghgflix-format-"));
process.env.DATA_DIR=dir;
const k=await import("../src/kanaele.js");
const {openDb,setSetting}=await import("../src/db.js");
const oldFetch=global.fetch;
const id="AAAAAAAAAAA";
const failures=[];
async function check(name,fn){try{await fn();console.log(`PASS ${name}`);}catch(e){failures.push(name);console.error(`FAIL ${name}: ${e.message}`);}}
try {
  for(const [name,status,location,want] of [
    ["HTTP 200 alone does not identify a Short",200,null,null],
    ["consent redirect remains unknown",302,"https://consent.youtube.com/",null],
    ["redirect for another video remains unknown",303,"/watch?v=BBBBBBBBBBB",null],
    ["same-video watch redirect identifies normal video",303,`/watch?v=${id}`,false],
    ["foreign redirect remains unknown",303,`https://example.test/watch?v=${id}`,null],
  ]) {
    global.fetch=async()=>new Response(null,{status,headers:location?{location}:{}});
    await check(name,async()=>assert.equal((await k.istShortPruefen(id)).istShort,want));
  }
  global.fetch=async(_url,options)=>options?.method==="HEAD"?new Response(null,{status:503}):new Response('"lengthSeconds":"30","width":180,"height":320');
  await check("portrait and duration do not prove the format",async()=>assert.equal((await k.istShortPruefen(id)).istShort,null));
  setSetting("feed_items",JSON.stringify([{id:"legacy",feedId:"f",art:"youtube",videoId:id,istShort:true,gemerkt:true,formatOverride:"podcasts"}]));
  await check("legacy heuristic cache is unverified but manual choices survive",()=>{
    const b=k.beitraegeLaden()[0];assert.equal(b.istShort,null);assert.equal(b.gemerkt,true);assert.equal(b.formatOverride,"podcasts");
  });
  await check("unknown formats are retried later and only for requested feeds",async()=>{
    const feeds=["a","b"].map(id=>({id,art:"youtube",titel:id,feedUrl:`https://fixture.test/${id}`,zuletzt:1}));
    const entries=feeds.map(f=>({id:`${f.id}:old`,feedId:f.id,art:"youtube",videoId:id,gelesen:true}));
    setSetting("feeds",JSON.stringify(feeds));setSetting("feed_items",JSON.stringify(entries));
    let probes=0;
    global.fetch=async(_url,options)=>{
      if(options?.method==="HEAD"){probes++;return new Response(null,{status:200});}
      return new Response("<feed><title>Fixture</title></feed>");
    };
    await k.abholen("a");assert.equal(probes,1);
    await k.abholen("a");assert.equal(probes,1);
    await k.abholen("b");assert.equal(probes,2);
    assert.equal(k.beitraegeLaden().find(b=>b.feedId==="a").shortsPruefung,2);
  });
  assert.deepEqual(failures,[]);
} finally {global.fetch=oldFetch;openDb().close();rmSync(dir,{recursive:true,force:true});}

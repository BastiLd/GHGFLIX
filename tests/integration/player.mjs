// Runs the production UI, HTTP API, SQLite, ffprobe and ffmpeg together.
// Only generated media and a throwaway database are used; no API/media mocks.
import assert from "node:assert/strict";
import {spawn,execFileSync} from "node:child_process";
import {createServer} from "node:net";
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve,dirname,basename} from "node:path";
import {pathToFileURL} from "node:url";
import sharp from "sharp";
import {chromium,expect} from "@playwright/test";

const cycles=Number(process.env.GHGFLIX_STRESS_CYCLES ?? 2);
const soakSeconds=Number(process.env.GHGFLIX_PLAYBACK_SOAK_SECONDS ?? 0);
const parallel=process.env.GHGFLIX_PARALLEL_PLAYBACK === "1";
assert.ok(Number.isInteger(cycles) && cycles>=1 && cycles<=100, "cycles must be 1..100");
assert.ok(Number.isInteger(soakSeconds) && soakSeconds>=0 && soakSeconds<=3600, "soak seconds must be 0..3600");
const dir=mkdtempSync(join(tmpdir(),"ghgflix-integration-"));
process.env.DATA_DIR=dir;
// Never import library roots or cloud credentials from the developer machine.
for (const key of ["SHOWS_DIRS","MOVIES_DIRS","SUPABASE_URL","SUPABASE_SERVICE_KEY","SUPABASE_USER_ID","TMDB_API_KEY","PUSH_CONTACT","EXPO_PUSH_ENABLED","EXPO_PUSH_PROJECT_ID","EXPO_PUSH_ACCESS_TOKEN"]) process.env[key]="";
const {openDb}=await import("../../server/src/db.js");
const db=openDb();
const port=await new Promise(r=>{const s=createServer();s.listen(0,"127.0.0.1",()=>{const p=s.address().port;s.close(()=>r(p));});});
const base=`http://127.0.0.1:${port}`;
let server,browser,logs="";
const results=[];
try {
  for(const [id,name,codec,ext] of [[1,"Direct","libx264","mp4"],[2,"Transcode","ffv1","mkv"]]) {
    const file=join(dir,`${name}.${ext}`);
    execFileSync("ffmpeg",["-y","-hide_banner","-loglevel","error","-f","lavfi","-i","testsrc2=size=320x180:rate=10","-f","lavfi","-i","anullsrc=r=48000:cl=stereo","-t","90","-c:v",codec,"-pix_fmt","yuv420p","-c:a","aac",file],{stdio:"pipe"});
    db.prepare("INSERT INTO movies (id,title,path,added_at) VALUES (?,?,?,?)").run(id,name,file,Date.now());
  }
  for (const id of [2,3]) db.prepare("INSERT INTO profiles (id,name,created_at) VALUES (?,?,?)").run(id,`Testprofil ${id}`,Date.now());
  db.close();
  const moduleUrl=pathToFileURL(resolve("server/src/index.js")).href;
  server=spawn(process.execPath,["--input-type=module","-e",`process.on('message',m=>{if(m==='shutdown')process.emit('SIGTERM')});await import(${JSON.stringify(moduleUrl)});`],{
    env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:"127.0.0.1",GHGFLIX_WEB_DIR:resolve("dist"),GHGFLIX_PASSWORD:"",BROWSE_ROOTS:dir,SCAN_INTERVAL_SEC:"99999"},
    stdio:["ignore","pipe","pipe","ipc"],windowsHide:true,
  });
  server.stdout.on("data",d=>logs+=d);server.stderr.on("data",d=>logs+=d);
  await expect.poll(async()=>{try{return (await fetch(base+"/api/ping")).ok;}catch{return false;}},{timeout:15000}).toBe(true);
  browser=await chromium.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
  const errors=[];
  async function playbackCase([id,mode,profileId]) {
    const page=await browser.newPage({viewport:{width:1440,height:900}});
    page.on("pageerror",e=>errors.push(e.message));
    await page.addInitScript((id)=>localStorage.setItem("ghgflix.profileId",String(id)),profileId);
    if(mode==="fragmented-mp4") await page.addInitScript(()=>{
      const native=HTMLMediaElement.prototype.canPlayType;
      HTMLMediaElement.prototype.canPlayType=function(type){return type.includes("mpegurl")?"":native.call(this,type);};
    });
    const hls=await page.evaluate(()=>!!document.createElement("video").canPlayType("application/vnd.apple.mpegurl"));
    const transport=id===1?"/api/stream/":mode!=="fragmented-mp4"&&hls?"/api/hls/":"/api/transcode/";
    await page.goto(`${base}/#/play/movie/${id}`);
    const video=page.locator("video");
    const bar=page.getByRole("slider",{name:"Wiedergabeposition"});
    await expect(video).toHaveAttribute("src",new RegExp(transport),{timeout:15000});
    await expect.poll(()=>video.evaluate(v=>v.currentTime),{timeout:30000}).toBeGreaterThan(0);
    await expect.poll(()=>video.evaluate(v=>v.getVideoPlaybackQuality().totalVideoFrames)).toBeGreaterThan(0);
    await expect.poll(async()=>Number(await bar.getAttribute("aria-valuemax"))).toBeGreaterThanOrEqual(90);
    for(let i=0;i<cycles;i++) {
      await page.mouse.move(100,100);
      await page.getByRole("button",{name:"Vollbild",exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
      await page.getByTitle("Zurück (Mini-Player)",{exact:true}).click();
      await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
      await page.locator(".mini-player").hover();
      await page.getByTitle("Vergrößern",{exact:true}).click();
      await expect.poll(async()=>Number(await bar.getAttribute("aria-valuemax"))).toBeGreaterThanOrEqual(90);
    }
    await page.mouse.move(100,100);
    await page.getByRole("button",{name:/^Paus(e|ieren)$/,exact:true}).click();
    await bar.focus();await bar.press("ArrowRight");
    await expect.poll(async()=>Number(await bar.getAttribute("aria-valuenow"))).toBeGreaterThan(10);
    await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
    await page.getByRole("button",{name:"Abspielen",exact:true}).click();
    const before=Number(await bar.getAttribute("aria-valuenow"));
    await expect.poll(async()=>Number(await bar.getAttribute("aria-valuenow")),{timeout:15000}).toBeGreaterThan(before+1);
    const soakStart=Date.now();
    let soakChecks=0;
    while(Date.now()-soakStart<soakSeconds*1000) {
      await page.mouse.move(100,100);
      await page.getByRole("button",{name:/^Paus(e|ieren)$/,exact:true}).click();
      await bar.focus();
      const position=Number(await bar.getAttribute("aria-valuenow"));
      await bar.press(position>50 ? "Home" : "ArrowRight");
      await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
      const target=Number(await bar.getAttribute("aria-valuenow"));
      await page.getByRole("button",{name:"Abspielen",exact:true}).click();
      await expect.poll(async()=>Number(await bar.getAttribute("aria-valuenow")),{timeout:20000}).toBeGreaterThan(target+2);
      await page.waitForTimeout(5000);
      const measured=Number(await bar.getAttribute("aria-valuenow"));
      assert.ok(Number.isFinite(measured) && measured>=0 && measured<=91);
      assert.ok(Number(await bar.getAttribute("aria-valuemax"))>=90);
      soakChecks++;
      console.log(`SOAK ${mode}: ${soakChecks} pause/seek/resume rounds, ${Math.round((Date.now()-soakStart)/1000)}s`);
    }
    // Validate a thumbnail from the real ffmpeg endpoint, not an image placeholder.
    const thumb=await page.request.post(`${base}/api/invoke/media_thumbnail`,{data:{path:join(dir,id===1?"Direct.mp4":"Transcode.mkv"),timeSec:20,width:176}});
    assert.equal(thumb.status(),200);
    const payload=await thumb.json();
    assert.ok(payload.result,"thumbnail result missing");
    const frame=await page.request.get(base+payload.result);
    assert.equal(frame.status(),200);
    const metadata=await sharp(await frame.body()).metadata();
    assert.equal(metadata.width,176);assert.ok(metadata.height > 0);
    const lastPosition=Number(await bar.getAttribute("aria-valuenow"));
    const result={id,mode,profileId,transport,cycles,soakChecks,soakElapsedSeconds:Math.round((Date.now()-soakStart)/1000),duration:Number(await bar.getAttribute("aria-valuemax")),thumbnail:{width:metadata.width,height:metadata.height}};
    await page.mouse.move(100,100);await page.getByTitle("Player schließen",{exact:true}).click();
    await expect(video).toHaveCount(0);
    let saved;
    await expect.poll(async()=>{
      const rows=await fetch(`${base}/api/progress?profile=${profileId}`).then(r=>r.json());
      assert.equal(rows.length,1,"another profile's playback must not leak into this profile");
      saved=rows[0];
      assert.equal(saved.refId,id);assert.equal(saved.mediaType,"movie");
      return Math.abs(saved.position-lastPosition);
    }).toBeLessThan(3);
    assert.equal(saved.watched,0);assert.ok(saved.duration>=90);
    results.push({...result,savedPosition:saved.position});
    await page.close();
    console.log(`PASS ${mode}: ${transport}, decoded frames, timeline and thumbnail`);
  }
  const cases=[[1,"direct",1],[2,"automatic",2],[2,"fragmented-mp4",3]];
  if(parallel) {
    const completed=await Promise.allSettled(cases.map(playbackCase));
    for(const result of completed) if(result.status==="rejected") throw result.reason;
  } else for(const entry of cases) await playbackCase(entry);
  assert.deepEqual(errors,[]);
  mkdirSync("test-results",{recursive:true});
  writeFileSync(`test-results/real-player${parallel?"-parallel":""}.json`,JSON.stringify({environment:"headless Chromium with real local server and generated media",parallel,results},null,2));
  console.log("PASS real HTTP/SQLite/ffmpeg: direct MP4 and transcoded MKV, decoded frames, repeated fullscreen/mini, pause/seek/resume and thumbnail response");
} catch(e) {console.error(e);console.error(logs.slice(-10000));throw e;}
finally {
  await browser?.close();
  if(server && server.exitCode===null) {
    server.send("shutdown");
    await new Promise(r=>{const t=setTimeout(()=>{server.kill();r();},5000);server.once("exit",()=>{clearTimeout(t);r();});});
  }
  assert.equal(dirname(resolve(dir)),resolve(tmpdir()));
  assert.ok(basename(dir).startsWith("ghgflix-integration-"));
  try { rmSync(dir,{recursive:true,force:true,maxRetries:8,retryDelay:250}); }
  catch(e) { console.warn(`Test cleanup deferred for ${dir}: ${e.message}`); }
}

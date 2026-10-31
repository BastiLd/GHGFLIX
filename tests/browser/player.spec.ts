import {mockAccount} from "./account-fixture";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("fullscreen return and mini-player expansion retain a usable timeline", async ({page}) => {
  const errors: string[]=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.route("**/test-video.webm*", r => {
    const data = readFileSync("tests/.generated/video.webm");
    const match = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range ?? "");
    const start = match ? Number(match[1]) : 0;
    const end = match?.[2] ? Math.min(Number(match[2]), data.length - 1) : data.length - 1;
    return r.fulfill({status:match ? 206 : 200,contentType:"video/webm",headers:{"Accept-Ranges":"bytes",...(match ? {"Content-Range":`bytes ${start}-${end}/${data.length}`} : {})},body:data.subarray(start,end+1)});
  });
  await page.route("**/api/**",async route=>{
    if(await mockAccount(route))return;
    const cmd=route.request().url().split("/").pop();
    let result: unknown=null;
    if(cmd==="get_episode") result={id:1,showId:1,showTitle:"Testserie",season:1,episode:1,title:"Testfolge",path:"test.webm",width:320,height:180};
    if(cmd==="play_info") result={id:1,mediaType:"episode",duration:90,direct:true,directUrl:"/test-video.webm",transcodeUrl:"",audioStreams:[],subtitleStreams:[],chapters:[]};
    if(["list_movies","list_shows","list_show_episodes","episode_versions","feed_groups","feeds_list"].includes(cmd!)) result=[];
    if(cmd==="feed_unread") result=0;
    if(cmd==="scan_status") result={running:false};
    await route.fulfill({json:{result}});
  });
  await page.goto("/#/play/episode/1");
  const video=page.locator("video");
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);
  for(let i=0;i<3;i++) {
    await page.mouse.move(100,100);
    if (i === 1) await page.getByRole("button", {name:/^Paus(e|ieren)$/,exact:true}).click();
    await page.getByRole("button",{name:"Vollbild",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
    await page.getByTitle("Zurück (Mini-Player)",{exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
    await page.locator(".mini-player").hover();
    await page.getByTitle("Vergrößern",{exact:true}).click();
    await expect(page.getByRole("slider",{name:"Wiedergabeposition"})).toHaveAttribute("aria-valuemax","90");
    await page.mouse.move(100,100);
    if (i === 1) {
      await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
      await page.getByRole("button", {name:"Abspielen",exact:true}).click();
    }
  }
  await page.getByRole("button", {name:/^Paus(e|ieren)$/,exact:true}).click();
  const bar=page.getByRole("slider",{name:"Wiedergabeposition"});
  await bar.focus(); await bar.press("ArrowRight");
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(10);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
  await page.mouse.move(100,100);
  await page.getByRole("button",{name:"Vollbild",exact:true}).click();
  await page.getByTitle("Player schließen",{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(false);
  await page.evaluate(()=>{ location.hash="/play/episode/1"; });
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);
  await page.mouse.move(100,100);
  await page.getByRole("button",{name:"Vollbild",exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>!!document.fullscreenElement)).toBe(true);
  expect(errors).toEqual([]);
});

test("late episode lookup cannot relabel or save progress for the next episode", async ({page}) => {
  let releaseOld!: () => Promise<void>;
  let holdOld = true;
  await page.addInitScript(() => localStorage.setItem("ghgflix.queue", JSON.stringify([
    {key:"queued-2",kind:"episode",mediaType:"episode",label:"Queuefolge 2",ids:[2]},
  ])));
  const saves: {refId:number}[] = [];
  await page.route("**/test-video.webm*", r => r.fulfill({contentType:"video/webm",body:readFileSync("tests/.generated/video.webm")}));
  await page.route("**/api/**",async route=>{
    if(await mockAccount(route))return;
    const cmd=route.request().url().split("/").pop();
    const args=route.request().postDataJSON();
    let result: unknown=null;
    if(cmd==="get_episode") {
      result={id:args.id,showId:1,showTitle:`Serie ${args.id}`,season:1,episode:args.id,title:`Folge ${args.id}`,path:`${args.id}.webm`};
      if(args.id===2 && holdOld) {
        releaseOld=()=>route.fulfill({json:{result}});
        return;
      }
    }
    if(cmd==="set_progress") saves.push(args);
    if(cmd==="play_info") result={id:Number(args.path.split(".")[0]),mediaType:"episode",duration:90,direct:true,directUrl:"/test-video.webm",transcodeUrl:"",audioStreams:[],subtitleStreams:[],chapters:[]};
    if(["list_movies","list_shows","list_show_episodes","episode_versions","feed_groups","feeds_list"].includes(cmd!)) result=[];
    if(cmd==="feed_unread") result=0;
    if(cmd==="scan_status") result={running:false};
    await route.fulfill({json:{result}});
  });
  await page.goto("/#/play/episode/1");
  await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(0);
  await page.mouse.move(100,100);
  await page.getByTitle("Wiedergabeliste",{exact:true}).click();
  await page.getByTitle("Jetzt abspielen",{exact:true}).click();
  await expect.poll(()=>!!releaseOld).toBe(true);
  // Trigger the periodic save while the old video is still running and lookup is pending.
  await page.waitForTimeout(5200);
  expect(saves.filter(s=>s.refId===2)).toEqual([]);
  await page.evaluate(()=>{ location.hash="/play/episode/3"; });
  await expect(page.getByText("Serie 3",{exact:true}).last()).toBeVisible();
  await releaseOld();
  // This response must be consumed before checking the final title.
  await page.waitForTimeout(300);
  await page.mouse.move(100,100);
  await expect(page.getByText("Serie 3",{exact:true}).last()).toBeVisible();
  await expect(page.getByText("Serie 2",{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem("ghgflix.queue")!)[0].ids)).toEqual([2]);
  holdOld = false;
  await page.getByTitle("Wiedergabeliste",{exact:true}).click();
  await page.getByTitle("Jetzt abspielen",{exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("ghgflix.queue")!))).toEqual([]);
  await expect(page.getByText("Serie 2",{exact:true}).last()).toBeVisible();
});

test.beforeEach(async({page})=>{await page.addInitScript(()=>localStorage.setItem("ghgflix.account.browser-fixture","fixture-token"));});

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockAccount } from "./account-fixture";

test.beforeEach(async ({page}) => {
  await page.addInitScript(()=>localStorage.setItem("ghgflix.account.browser-fixture","fixture-token"));
  await page.route("**/test-video.webm*",r=>{
    const data=readFileSync("tests/.generated/video.webm"), match=/bytes=(\d+)-(\d*)/.exec(r.request().headers().range??"");
    const start=match?Number(match[1]):0, end=match?.[2]?Math.min(Number(match[2]),data.length-1):data.length-1;
    return r.fulfill({status:match?206:200,contentType:"video/webm",headers:{"Accept-Ranges":"bytes",...(match?{"Content-Range":`bytes ${start}-${end}/${data.length}`}:{})},body:data.subarray(start,end+1)});
  });
  await page.route("**/api/subs/**",r=>r.fulfill({contentType:"text/vtt",body:"WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nEigene Testuntertitel\nZweite Zeile\n"}));
  await page.route("**/api/**",async route => {
    if(await mockAccount(route))return;
    if(new URL(route.request().url()).pathname.startsWith("/api/subs/")) { await route.fulfill({contentType:"text/vtt",body:"WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nEigene Testuntertitel\nZweite Zeile\n"});return; }
    const cmd=new URL(route.request().url()).pathname.split("/").pop(), args=route.request().postDataJSON();
    let result: unknown=null;
    const episodes=[{id:1,showId:1,season:1,episode:8},{id:2,showId:1,season:2,episode:1},{id:3,showId:1,season:2,episode:2}];
    if(cmd==="get_setting")result=args.key==="pref_uiTimeoutSec"?"8":["pref_autoplayNext","pref_endAutoBack"].includes(args.key)?"off":null;
    if(cmd==="get_episode")result={...episodes.find(e=>e.id===args.id),showTitle:"Testserie",title:`Folge ${args.id}`,path:`${args.id}.webm`,width:320,height:180};
    if(cmd==="list_show_episodes")result=episodes;
    if(cmd==="play_info")result={id:2,mediaType:String(args.path).startsWith("movie")?"movie":"episode",duration:90,direct:true,directUrl:"/test-video.webm",transcodeUrl:"",audioStreams:[],subtitleStreams:[{index:0,lang:"de",title:"Deutsch"}],chapters:[]};
    if(["list_movies","list_shows","episode_versions","movie_versions","feed_groups","feeds_list"].includes(cmd!))result=[];
    if(cmd==="feed_unread")result=0;
    if(cmd==="scan_status")result={running:false};
    await route.fulfill({json:{result}});
  });
  await page.goto("/#/play/episode/2");
  await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
});

test("previous and next revisit queued movies without consuming the queue twice",async({page})=>{
  await page.route("**/api/invoke/get_movie",async route=>{
    const {id}=route.request().postDataJSON();
    await route.fulfill({json:{result:{id,title:`Testfilm ${id}`,path:`movie${id}.webm`,genres:"[]",width:320,height:180}}});
  });
  // Seed a synthetic queue before the fresh app instance, then use real controls.
  await page.addInitScript(()=>localStorage.setItem("ghgflix.queue",JSON.stringify([
    {key:"q7",kind:"movie",mediaType:"movie",label:"Testfilm 7",ids:[7]},
    {key:"q8",kind:"movie",mediaType:"movie",label:"Testfilm 8",ids:[8]},
  ])));
  await page.reload();
  await page.getByRole("button",{name:"Nächstes Video",exact:true}).click();
  await expect(page).toHaveURL(/play\/movie\/7$/);
  await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
  await page.mouse.move(100,100);
  await page.getByRole("button",{name:"Nächstes Video",exact:true}).click();
  await expect(page).toHaveURL(/play\/movie\/8$/);
  await expect(page.getByRole("button",{name:"Vorheriges Video",exact:true})).toBeEnabled();
  await page.getByRole("button",{name:"Vorheriges Video",exact:true}).click();
  await expect(page).toHaveURL(/play\/movie\/7$/);
  await page.getByRole("button",{name:"Nächstes Video",exact:true}).click();
  await expect(page).toHaveURL(/play\/movie\/8$/);
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("ghgflix.queue")||"[]"))).toEqual([]);
});
async function finger(page: Page, points: {x:number;y:number}[], hold=0) {
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[points[0]]});
  if(hold)await page.waitForTimeout(hold);
  for(const point of points.slice(1))await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[point]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]}); await cdp.detach();
}
test("touch toggles controls, double taps seek, holding restores rate, and swipes give feedback",async({page})=>{
  const size=page.viewportSize()!, centre={x:size.width*.5,y:size.height*.45}, right={x:size.width*.8,y:size.height*.4};
  const bottom=page.locator(".ghg-player-bottom"), video=page.locator("video");
  await finger(page,[centre]); await expect(bottom).toHaveCSS("opacity","0");
  await finger(page,[centre]); await expect(bottom).toHaveCSS("opacity","1");
  const before=await video.evaluate((v:HTMLVideoElement)=>v.currentTime);
  await finger(page,[right]); await page.waitForTimeout(70); await finger(page,[right]);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(before+9);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(false);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[centre]});
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.playbackRate)).toBe(2);
  await page.waitForTimeout(1000);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.playbackRate)).toBe(2);
  await cdp.send("Input.dispatchTouchEvent",{type:"touchCancel",touchPoints:[]});
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.playbackRate)).toBe(1); await cdp.detach();
  await finger(page,[right,{x:right.x,y:size.height*.65}]);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.volume)).toBeLessThan(.9);
  await finger(page,[{x:size.width*.2,y:size.height*.4},{x:size.width*.2,y:size.height*.65}]);
  await expect(page.getByRole("status")).toContainText("Bildhelligkeit");
  await page.screenshot({path:test.info().outputPath("gestures.png")});
});
test("drag previews before one final seek; Escape cancels without changing playback",async({page})=>{
  await page.getByRole("button",{name:/^Paus(e|ieren)$/,exact:true}).click();
  const video=page.locator("video"), bar=page.getByRole("slider",{name:"Wiedergabeposition"});
  const b=(await bar.boundingBox())!, start=await video.evaluate((v:HTMLVideoElement)=>v.currentTime);
  await page.mouse.move(b.x+b.width*.2,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width*.6,b.y+b.height/2,{steps:12});
  expect(await video.evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeCloseTo(start,1);
  await page.screenshot({path:test.info().outputPath("scrub-preview.png")});
  await page.mouse.up(); await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>Math.round(v.currentTime))).toBe(54);
  await page.mouse.move(b.x+b.width*.4,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+b.width*.8,b.y+b.height/2);
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await video.evaluate((v:HTMLVideoElement)=>Math.round(v.currentTime))).toBe(54);
  await bar.focus(); await bar.press("ArrowLeft"); await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>Math.round(v.currentTime))).toBe(44);
  await expect.poll(()=>video.evaluate((v:HTMLVideoElement)=>v.paused)).toBe(true);
});
test("custom subtitle values commit, cancel and survive reopening; previous crosses seasons",async({page},info)=>{
  const phone=info.project.name==="phone";
  await page.getByRole("button",{name:/^Paus(e|ieren)$/,exact:true}).click();
  await page.getByRole("button",{name:phone?"Sprache & Untertitel":"Untertitel",exact:true}).click();
  if(phone)await page.getByRole("tab",{name:"Untertitel",exact:true}).click();
  await page.getByRole("button",{name:/^Deutsch/}).click();
  if(phone)await page.getByRole("button",{name:"Schließen",exact:true}).click();
  await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.textTracks[0]?.cues?.length)).toBe(1);
  await page.getByRole("button",{name:phone?"Wiedergabeoptionen":"Untertitel & Touch-Gesten",exact:true}).click();
  const dialog=page.getByRole("dialog");
  const focusable=dialog.locator('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]');
  await expect(focusable.first()).toBeFocused();
  await page.keyboard.press("Shift+Tab"); await expect(focusable.last()).toBeFocused();
  await page.keyboard.press("Tab"); await expect(focusable.first()).toBeFocused();
  const size=dialog.getByRole("textbox",{name:"Schriftgröße (%)",exact:true});
  await size.fill("137"); await size.press("Enter");
  await expect.poll(()=>page.locator("#ghg-subtitle-style").textContent()).toContain("137%");
  await size.fill("195"); await size.press("Escape"); await expect(size).toHaveValue("137"); await expect(dialog).toBeVisible();
  await size.fill("9999"); await size.press("Enter"); await expect(dialog.getByRole("alert")).toContainText("50 und 300"); await expect(size).toHaveValue("137");
  const color=dialog.getByRole("textbox",{name:"Schriftfarbe",exact:true}); await color.fill("#12c4ab"); await color.press("Enter");
  const bg=dialog.getByRole("textbox",{name:"Hintergrundfarbe",exact:true}); await bg.fill("#421367"); await bg.press("Enter");
  await dialog.getByLabel("Schriftart",{exact:true}).selectOption("mono");
  await page.screenshot({path:info.outputPath("subtitle-editor.png")});
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button",{name:phone?"Wiedergabeoptionen":"Untertitel & Touch-Gesten",exact:true})).toBeFocused();
  await page.screenshot({path:info.outputPath("subtitle-rendered.png")});
  await page.reload();
  await expect.poll(()=>page.locator("video").evaluate((v:HTMLVideoElement)=>v.currentTime)).toBeGreaterThan(.1);
  await page.getByRole("button",{name:phone?"Wiedergabeoptionen":"Untertitel & Touch-Gesten",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Schriftfarbe",exact:true})).toHaveValue("#12c4ab");
  await expect(page.getByRole("textbox",{name:"Schriftgröße (%)",exact:true})).toHaveValue("137");
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Vorherige Folge",exact:true}).click();
  await expect(page).toHaveURL(/play\/episode\/1$/);
  await page.getByRole("button",{name:phone?"Wiedergabeoptionen":"Untertitel & Touch-Gesten",exact:true}).click();
  await page.getByRole("button",{name:"Untertitel zurücksetzen",exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Schriftgröße (%)",exact:true})).toHaveValue("100");
  await expect(page.getByRole("textbox",{name:"Schriftfarbe",exact:true})).toHaveValue("#ffffff");
});

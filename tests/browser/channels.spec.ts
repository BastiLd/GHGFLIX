import { test, expect } from "@playwright/test";
test("group to channel to formats and back", async ({page}, info) => {
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  let assigned: string | null = null;
  const item = {id:"i1",feedId:"f1",art:"youtube",videoId:"v1",titel:"Testbeitrag",veroeffentlicht:Date.now(),gelesen:true,istShort:null,feedTitel:"Avatar Kanal"};
  await page.route("**/api/**", async route => {
    const url = route.request().url();
    if (url.endsWith("/api/ping")) return route.fulfill({json:{auth:false}});
    const cmd = url.split("/").pop(); const args = route.request().postDataJSON() ?? {};
    let result: unknown = null;
    if (cmd === "feed_groups") result = [{id:"g1",name:"Avatar",emoji:"📺",abos:1,kanaele:1,blogs:0,beitraege:1,ungelesen:0,bilder:[],standardOffen:false,sortierung:0}];
    if (cmd === "feeds_list") result = [{id:"f1",art:"youtube",titel:"Avatar Kanal",gruppeIds:["g1"],benachrichtigen:true}];
    if (cmd === "feed_format") { assigned=args.format; result=true; }
    if (cmd === "feed_items") result = !args.format || args.format === (assigned ?? "unknown") ? [{...item,formatOverride:assigned}] : [];
    if (cmd === "feed_unread") result=0;
    if (cmd === "list_movies" || cmd === "list_shows") result=[];
    if (cmd === "scan_status") result={running:false};
    return route.fulfill({json:{result}});
  });
  await page.goto(info.project.name === "tv" ? "/?tv=1#/kanaele" : "/#/kanaele");
  await page.getByText("Avatar",{exact:true}).click();
  await expect(page.getByRole("region",{name:"Kanäle in dieser Gruppe"})).toBeVisible();
  await page.getByRole("button",{name:"Avatar Kanal YouTube"}).click();
  await expect(page.getByText("Testbeitrag",{exact:true})).toBeVisible();
  await page.getByRole("combobox",{name:"Format für Testbeitrag"}).selectOption("podcasts");
  await expect.poll(()=>assigned).toBe("podcasts");
  await page.getByRole("button",{name:"Podcasts",exact:true}).click();
  await expect(page.getByText("Testbeitrag",{exact:true})).toBeVisible();
  expect(await page.locator("main").evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({path:`test-results/channels-${info.project.name}.png`,fullPage:true});
  await page.getByRole("button",{name:"Zurück zu den Kanälen"}).click();
  await expect(page.getByRole("region",{name:"Kanäle in dieser Gruppe"})).toBeVisible();
  await page.getByRole("button",{name:"Zurück zu den Gruppen"}).click();
  await expect(page.getByText("Avatar",{exact:true})).toBeVisible();
  expect(errors).toEqual([]);
});

 test("custom group images and multiple memberships survive saving and reload", async ({page}) => {
  const sharp = (await import("sharp")).default;
  const png = await sharp({create:{width:1600,height:900,channels:4,background:"#9944cc"}}).png().toBuffer();
  const settings: Record<string,string> = {};
  const groups = ["Avatar","Weitere Gruppe"].map((name,i)=>({id:`g${i+1}`,name,emoji:"📺",abos:1,kanaele:1,blogs:0,beitraege:0,ungelesen:0,bilder:[],standardOffen:false,sortierung:i}));
  const feed = {id:"f1",art:"youtube",titel:"Avatar Kanal",gruppeId:"g1",gruppeIds:["g1"],benachrichtigen:true};
  await page.route("**/api/**", async route => {
    if(route.request().url().endsWith("/api/ping")) return route.fulfill({json:{auth:false}});
    const cmd=route.request().url().split("/").pop(); const args=route.request().postDataJSON() ?? {};
    let result:unknown=null;
    if(cmd==="feed_groups") result=groups;
    if(cmd==="feeds_list") result=[feed];
    if(cmd==="feed_update") { Object.assign(feed,Object.fromEntries(Object.entries(args).filter(([,v])=>v != null))); result=feed; }
    if(cmd==="get_setting") result=settings[args.key] ?? null;
    if(cmd==="set_setting") settings[args.key]=args.value;
    if(cmd==="feed_group_update") {const group=groups.find(g=>g.id===args.id)!;Object.assign(group,args);result=group;}
    if(["feed_items","list_movies","list_shows"].includes(cmd!)) result=[];
    if(cmd==="feed_unread") result=0;
    if(cmd==="scan_status") result={running:false};
    await route.fulfill({json:{result}});
  });
  await page.goto("/#/kanaele");
  await page.getByText("Weitere Gruppe",{exact:true}).click();
  await page.getByRole("button",{name:"Einstellen",exact:true}).click();
  await page.getByRole("checkbox",{name:"Avatar Kanal"}).click();
  await expect.poll(()=>feed.gruppeIds).toEqual(["g1","g2"]);
  await page.getByLabel("Name",{exact:true}).fill("Meine Gruppe");
  await page.locator('input[type="file"]').setInputFiles({name:"test.png",mimeType:"image/png",buffer:png});
  const preview=page.getByAltText("Gruppenbild",{exact:true});
  await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate((img:HTMLImageElement)=>[img.naturalWidth,img.naturalHeight])).toEqual([960,540]);
  await page.getByRole("button",{name:"Speichern",exact:true}).click();
  await expect.poll(()=>groups[1].name).toBe("Meine Gruppe");
  expect(settings.feed_group_image_g2).toMatch(/^data:image\/webp;base64,/);
  await page.reload();
  await page.getByText("Meine Gruppe",{exact:true}).click();
  await page.getByRole("button",{name:"Einstellen",exact:true}).click();
  await expect(page.getByAltText("Gruppenbild",{exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox",{name:"Avatar Kanal"})).toBeChecked();
  await page.getByRole("button",{name:"Bild entfernen",exact:true}).click();
  await page.getByRole("button",{name:"Speichern",exact:true}).click();
  await expect.poll(()=>settings.feed_group_image_g2).toBe("");
  expect(feed.gruppeIds).toEqual(["g1","g2"]);
 });

test("shared channels count unread posts once in the overview", async ({page}) => {
  await page.route("**/api/**", async route => {
    if(route.request().url().endsWith("/api/ping")) return route.fulfill({json:{auth:false}});
    const cmd=route.request().url().split("/").pop();
    let result:unknown=null;
    if(cmd==="feed_groups") result=["Science","Space"].map((name,i)=>({id:`g${i}`,name,emoji:"S",abos:1,kanaele:1,blogs:0,beitraege:1,ungelesen:1,bilder:[],standardOffen:false,sortierung:i}));
    if(cmd==="feeds_list") result=[{id:"f",titel:"Lab",art:"youtube",gruppeIds:["g0","g1"],benachrichtigen:true}];
    if(cmd==="feed_unread") result=1;
    if(["feed_items","list_movies","list_shows"].includes(cmd!)) result=[];
    if(cmd==="scan_status") result={running:false};
    return route.fulfill({json:{result}});
  });
  await page.goto("/#/kanaele");
  const header=page.getByRole("heading",{name:"Kanäle",exact:true}).locator("..");
  await expect(header.getByText("1 neu",{exact:true})).toBeVisible();
  await expect(header.getByText("2 neu",{exact:true})).toHaveCount(0);
});

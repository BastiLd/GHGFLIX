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

import { test, expect } from "@playwright/test";

async function play(page) {
  await page.setViewportSize({width:390,height:844});
  await page.goto("/app.html?device=mobile");
  await page.getByText("Ansehen",{exact:true}).click();
  await expect.poll(()=>page.locator("video").evaluate(v=>v.currentTime)).toBeGreaterThan(.2);
}
test("mobile surface toggles visible controls in both directions",async({page})=>{
  await play(page);
  const surface=page.getByTestId("player-wecken");
  await surface.click({position:{x:195,y:350}});
  await expect(page.getByRole("button",{name:"Pausieren",exact:true})).toHaveCount(0);
  await surface.click({position:{x:195,y:350}});
  await expect(page.getByRole("button",{name:"Pausieren",exact:true})).toBeVisible();
});

test("native component scrubber previews, commits once and preserves pause",async({page})=>{
  await play(page);
  await page.getByRole("button",{name:"Pausieren",exact:true}).click();
  const video=page.locator("video"),bar=page.getByTestId("player-zeitleiste"),b=await bar.boundingBox();
  const start=await video.evaluate(v=>v.currentTime);
  await page.mouse.move(b.x+b.width*.2,b.y+b.height/2);await page.mouse.down();
  await page.mouse.move(b.x+b.width*.65,b.y+b.height/2,{steps:12});
  expect(await video.evaluate(v=>v.currentTime)).toBeCloseTo(start,1);
  await expect(page.getByText("0:58",{exact:true})).toBeVisible();
  await page.screenshot({path:"evidence/mobile-scrub-preview.png"});
  await page.mouse.up();
  // Pointer coordinates are integral CSS pixels; include one pixel + one frame.
  await expect.poll(async()=>Math.abs(await video.evaluate(v=>v.currentTime)-58.5)).toBeLessThan(90/b.width+1/15);
  await expect.poll(()=>video.evaluate(v=>v.paused)).toBe(true);
});

test("native subtitle editor accepts custom colors and sizes and keeps them after restart",async({page})=>{
  await play(page);
  await page.getByRole("button",{name:"Sprache & Untertitel",exact:true}).click();
  await page.getByRole("button",{name:"Untertitel",exact:true}).click();
  await page.getByRole("button",{name:"Untertitel: Sprache 01",exact:true}).click();
  await page.getByText("Darstellung",{exact:true}).click();
  for(const [label,value] of [["Schriftgröße (%)","137"],["Schriftfarbe","#12c4ab"],["Hintergrundfarbe","#421367"]]){
    const field=page.getByRole("textbox",{name:label,exact:true});await field.fill(value);await field.press("Tab");await expect(field).toHaveValue(value);
  }
  await page.screenshot({path:"evidence/mobile-custom-subtitles.png"});
  await page.getByRole("button",{name:"Menü schließen",exact:true}).click();
  await page.getByRole("button",{name:"Fertig",exact:true}).click();
  await expect(page.getByText("Vorschau-Untertitel",{exact:true})).toHaveCSS("color","rgb(18, 196, 171)");
  await page.reload();
  await page.getByText("Ansehen",{exact:true}).click();
  await page.getByRole("button",{name:"Sprache & Untertitel",exact:true}).click();
  await page.getByText("Darstellung",{exact:true}).click();
  await expect(page.getByRole("textbox",{name:"Schriftgröße (%)",exact:true})).toHaveValue("137");
  await expect(page.getByRole("textbox",{name:"Schriftfarbe",exact:true})).toHaveValue("#12c4ab");
});

import { test, expect } from '@playwright/test';
import path from 'node:path';
// Die gezielten Player-Regressionen verwenden einen lokalen 90-s-Testclip.
// Navigation uses the disposable server from tests/integration/mobile-server.mjs.
test.beforeEach(async ({page}) => {
  await page.route('**/api/invoke/set_progress', r => r.fulfill({json:{result:null}}));
  await page.route('**/api/invoke/get_progress', r => r.fulfill({json:{result:null}}));
  await page.route('**/api/invoke/play_info', r => r.fulfill({json:{result:{mediaType:'episode',id:1,duration:90,direct:true,directUrl:'/__testclip.mp4',transcodeUrl:'/__testclip.mp4?',width:1280,height:720,audioStreams:[{index:1,lang:'eng',codec:'aac'}],subtitleStreams:[{index:2,lang:'deu',codec:'subrip'}],chapters:[]}}}));
  await page.route('**/__testclip.mp4*', r => r.fulfill({path:path.resolve('preview/public/sample.mp4'),contentType:'video/mp4'}));
  await page.route('**/api/subs/episode/1/2.vtt', r => r.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:00:00.000 --> 00:01:29.000\nTestuntertitel\n'}));
  await page.route('**/api/invoke/get_setting', async r => {
    const key = r.request().postDataJSON().key;
    const overrides = {pref_autoplayNext:'off',pref_miniPlayer:'off',pref_endAutoBack:'on',pref_uiTimeoutSec:'30'};
    if (key in overrides) await r.fulfill({json:{result:overrides[key]}}); else await r.continue();
  });
});

test('Touch-Sprachmenü bleibt offen und Untertitel lassen sich auswählen', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-touch', 'Windows-WebKit ersetzt keinen iOS-HLS-Decoder.');
  await page.goto('/#/play/episode/1');
  await expect.poll(() => page.locator('video').evaluate(v => v.currentTime), {timeout:20000}).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Pausieren',exact:true}).click();
  await page.getByRole('button',{name:/Sprache & Untertitel/}).click();
  await expect(page.getByText('Diese Datei enthält nur diese Tonspur.')).toBeVisible();
  await page.getByRole('tab',{name:'Untertitel',exact:true}).click();
  await page.getByRole('button',{name:'Deutsch',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deutsch',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.length || 0)).toBe(1);
  await page.getByRole('button',{name:'Untertitel-Darstellung & Tempo'}).click();
  await page.getByLabel('Untertitelgröße').selectOption('1.5');
  await page.getByLabel('Zeitversatz').selectOption('1');
  await expect.poll(() => page.locator('video').evaluate(v => v.textTracks[0]?.cues?.[0]?.startTime)).toBe(1);
  await expect(page.getByLabel('Streaming-Qualität')).toHaveValue('high');
  await page.screenshot({path:'evidence/webapp-player-options-testclip.png'});
});

test('Vollbild endet bei Schließen und beim automatischen Folgenende', async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-touch', 'Fullscreen-Regression mit Chromium.');
  for (const action of ['close','ended']) {
    await page.goto('/#/play/episode/1');
    await expect.poll(() => page.locator('video').evaluate(v => v.currentTime), {timeout:20000}).toBeGreaterThan(0);
    await page.getByRole('button',{name:'Vollbild',exact:true}).click();
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
    if (action === 'close') await page.getByRole('button',{name:'Player schließen',exact:true}).click();
    else await page.locator('video').evaluate(v => v.dispatchEvent(new Event('ended')));
    await expect(page).toHaveURL(/#\/show\/1/);
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    await expect(page.getByRole('navigation',{name:'Hauptnavigation'})).toBeVisible();
  }
});

test('Kompakte Playeraktionen bleiben auch bei 320 Pixeln erreichbar', async ({page}, info) => {
  test.skip(info.project.name !== 'chromium-touch', 'Layout of the decoded test clip is exercised with Chromium.');
  await page.goto('/#/play/episode/1');
  await expect.poll(() => page.locator('video').evaluate(v => v.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button',{name:'Pausieren',exact:true}).click();
  for(const viewport of [{width:320,height:568},{width:390,height:844},{width:640,height:360}]) {
    await page.setViewportSize(viewport);
    const controls=page.locator('.touch-transport button');
    await expect(controls).toHaveCount(7);
    for(const button of await controls.all()) {
      await expect(button).toBeVisible();
      const box=await button.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x+box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y+box.height).toBeLessThanOrEqual(viewport.height);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

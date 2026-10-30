import { test, expect } from '@playwright/test';
test('Suche, Serien, Folgen und Mehr mit echten Serverdaten', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/#/search');
  await page.getByRole('searchbox', { name: 'Filme, Serien und Folgen suchen' }).fill('Testserie');
  await expect(page.getByRole('heading', { name: /Ergebnisse für/ })).toContainText('Testserie');
  await page.getByRole('button',{name:'Testserie',exact:true}).click();
  await expect(page.getByRole('heading', {name:'Testserie',exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Staffel 1',exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Poster ändern',exact:true})).toBeHidden();
  await page.screenshot({path:`evidence/webapp-${testInfo.project.name}-serie.png`});
  await page.getByText('Weitere Aktionen', {exact:true}).click();
  await expect(page.getByRole('button', {name:'Poster ändern',exact:true})).toBeVisible();
  await page.getByRole('link', {name:'Filme',exact:true}).click();
  await expect(page.getByRole('heading', {name:/Filme/}).first()).toBeVisible();
  await expect(page.locator('.media-card')).toHaveCount(2);
  await page.getByRole('link', {name:'Mehr',exact:true}).click();
  await expect(page.getByText('Zum Home-Bildschirm', {exact:false})).toBeVisible();
  await page.screenshot({path:`evidence/webapp-${testInfo.project.name}-mehr.png`});
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('Serverausfall hat eine erreichbare Wiederholung', async ({ page }) => {
  await page.route('**/api/ping', route => route.abort());
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'Server nicht erreichbar'})).toBeVisible();
  await page.unroute('**/api/ping');
  await page.getByRole('button',{name:'Erneut verbinden'}).click();
  await expect(page.getByRole('navigation',{name:'Hauptnavigation'})).toBeVisible();
});

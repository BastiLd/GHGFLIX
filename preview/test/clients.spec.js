import { test, expect } from "@playwright/test";
const selected = (p) => p.getByTestId("tv-focus");
async function key(p, k, times = 1) { for (let i = 0; i < times; i++) { await p.keyboard.press(k); await p.waitForTimeout(140); } }
async function ready(p, device) { await p.goto(`/app.html?device=${device}`); await expect(p.getByText("Weiterschauen", { exact: true })).toBeVisible(); }
async function visibleFocus(p) {
  await expect(selected(p)).toHaveCount(1);
  await expect.poll(async () => { const b = await selected(p).boundingBox(); const v = p.viewportSize(); return b && b.x >= 0 && b.y >= 0 && b.x + b.width <= v.width + 2 && b.y + b.height <= v.height + 2; }).toBeTruthy();
}
test("TV: Fernbedienung erreicht lange Reihen, Details und den bisherigen Platz", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await ready(page, "tv");
  await key(page, "ArrowRight"); await expect(selected(page)).toContainText("Ansehen");
  await key(page, "ArrowDown", 2); await visibleFocus(page);
  await key(page, "ArrowRight", 14); await visibleFocus(page);
  const title = await selected(page).textContent();
  await page.screenshot({ path: "evidence/tv-poster-focus.png" });
  await key(page, "Enter"); await expect(page.getByText(/Als gesehen/, { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/tv-detail.png" });
  await key(page, "Escape");
  await expect(selected(page)).toHaveText(title); await visibleFocus(page);
  expect(errors).toEqual([]);
});
test("TV: Serien-Dialog hält den Fokus und Zurück schließt nur den Dialog", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv");
  await page.getByRole("button", { name: "Serien", exact: true }).click();
  await key(page, "Enter");
  await expect(page.getByText("Staffel 1", { exact: true }).first()).toBeVisible();
  await page.getByRole("button").filter({ hasText: "Staffel 1" }).first().click();
  await expect(page.getByText("Staffel wählen", { exact: true })).toBeVisible();
  await key(page, "ArrowDown"); await visibleFocus(page);
  await page.screenshot({ path: "evidence/tv-season-dialog.png" });
  await key(page, "Escape"); await expect(page.getByText("Staffel wählen", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Zwischen den Welten", { exact: true }).first()).toBeVisible();
});
test("TV: Einstellungen bleiben beim Ändern bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv");
  await page.getByRole("button", { name: "Einstellungen", exact: true }).click();
  await key(page, "ArrowDown", 4); await visibleFocus(page);
  await page.screenshot({ path: "evidence/tv-settings.png" });
});
test("Handy: Mediathek-Tabs, Suche, Detail, Liste und Profil mit Touch", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await ready(page, "mobile");
  await expect(selected(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Suche", exact: true }).click();
  await page.getByPlaceholder("Titel eingeben …").fill("Wildnis");
  await expect(page.getByText("3 Treffer", { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/mobile-search.png" });
  await page.getByRole("button", { name: "★ 8.0 Wildnis 2026", exact: true }).click();
  await expect(page.getByText("Zu meiner Liste", { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/mobile-detail.png" });
  await page.getByText("Zu meiner Liste", { exact: true }).click();
  await expect(page.getByText("In meiner Liste", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Meine Liste", exact: true }).click();
  await expect(page.getByText("Meine Liste", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Profil wechseln", exact: true }).click();
  await expect(page.getByText("Familie", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("TV: 960×540 Layoutpunkte lassen alle Menüpunkte erreichbar", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await ready(page, "tv");
  await key(page, "ArrowDown", 7);
  await expect(selected(page)).toHaveAttribute("aria-label", "Profil wechseln");
  await visibleFocus(page);
  await page.screenshot({ path: "evidence/tv-960.png" });
});

test("TV: Player spielt, pausiert und Dialog-Zurück verlässt das Video nicht", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv");
  await key(page, "ArrowRight"); await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(.2);
  await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.paused)).toBe(true);
  await page.getByRole("button", { name: "Optionen", exact: true }).click();
  await page.getByText("Geschwindigkeit · 1×", { exact: true }).click();
  await expect(page.getByText("Geschwindigkeit", { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/tv-player-dialog.png" });
  await key(page, "Escape");
  await expect(page.getByText("Geschwindigkeit", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Wiedergabeoptionen", { exact: true })).toBeVisible();
  await key(page, "Escape");
  await expect(page.locator("video")).toHaveCount(1);
  await page.screenshot({ path: "evidence/tv-player.png" });
  await key(page, "Escape"); await expect(page.getByText("Weiterschauen", { exact: true })).toBeVisible();
});

test("Handy: Player lässt sich nach dem Ausblenden per Tipp wieder bedienen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "mobile");
  await page.getByText("Ansehen", { exact: true }).click();
  await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(.2);
  await page.screenshot({ path: "evidence/mobile-player.png" });
  await expect(page.getByRole("button", { name: "Bedienelemente anzeigen", exact: true })).toBeVisible({ timeout: 9000 });
  await page.getByRole("button", { name: "Bedienelemente anzeigen", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sprache & Untertitel", exact: true })).toBeVisible();
});

test("Videofehler endet mit Wiederholen und spielt danach wieder", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page, "mobile");
  await page.route("**/sample.mp4*", (route) => route.abort());
  await page.getByText("Ansehen", { exact: true }).click();
  await expect(page.getByText("Wiedergabe nicht verfügbar", { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/mobile-player-error.png" });
  await page.unroute("**/sample.mp4*");
  await page.getByRole("button", { name: "Erneut versuchen", exact: true }).click();
  await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(.2);
});

test("TV-Videofehler bleibt mit OK auf Wiederholen bedienbar", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv");
  await page.route("**/sample.mp4*", (route) => route.abort());
  await key(page, "ArrowRight"); await key(page, "Enter");
  await expect(page.getByText("Wiedergabe nicht verfügbar", { exact: true })).toBeVisible();
  await expect(selected(page)).toHaveText("Erneut versuchen");
  await page.screenshot({ path: "evidence/tv-player-error.png" });
  await page.unroute("**/sample.mp4*");
  await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(.2);
});

test("TV: lange Spurliste scrollt die ausgewählte Sprache sichtbar ins Bild", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv"); await key(page, "ArrowRight"); await key(page, "Enter");
  await page.getByRole("button", { name: "Sprache & Untertitel", exact: true }).click();
  // Wait for the portal's asynchronous initial focus before sending remote input.
  await expect(selected(page)).toHaveAttribute("aria-label", /^Audio:/);
  await key(page, "ArrowRight");
  await expect(selected(page)).toHaveAttribute("aria-label", /^Untertitel: Aus/);
  await key(page, "ArrowDown", 16); await visibleFocus(page);
  await expect(selected(page)).toContainText("Sprache 16");
  await page.screenshot({ path: "evidence/tv-long-dialog.png" });
});

test("Handy: Serverfehler zeigt Wiederholen statt einer leeren Mediathek", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/app.html?device=mobile&fault=library");
  await expect(page.getByText("Mediathek nicht erreichbar", { exact: true })).toBeVisible();
  await page.getByText("Erneut versuchen", { exact: true }).click();
  await expect(page.getByText("Mediathek nicht erreichbar", { exact: true })).toBeVisible();
  await page.screenshot({ path: "evidence/mobile-server-error.png" });
});


test("TV: OK pausiert auch bei verborgener Leiste, Navigation hält sie offen", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv"); await key(page, "ArrowRight"); await key(page, "Enter");
  await expect(page.getByRole("button", { name: "Bedienelemente anzeigen" })).toBeVisible({ timeout: 9000 });
  await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.paused)).toBe(true);
  await expect(selected(page)).toHaveAttribute("aria-label", "Abspielen");
  await key(page, "Enter");
  for (let i = 0; i < 4; i++) { await page.waitForTimeout(1800); await key(page, i % 2 ? "ArrowLeft" : "ArrowRight"); }
  await expect(page.getByRole("button", { name: "Sprache & Untertitel", exact: true })).toBeVisible();
});

test("Handy: Sprachmenü, Untertitel, Darstellung, Standard und Schließen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await ready(page, "mobile");
  await page.getByText("Ansehen", { exact: true }).click();
  await page.getByRole("button", { name: "Sprache & Untertitel", exact: true }).click();
  await expect(page.getByText("Diese Datei enthält nur diese Tonspur.")).toBeVisible();
  await page.getByRole("button", { name: "Untertitel", exact: true }).click();
  await page.getByRole("button", { name: "Untertitel: Sprache 01", exact: true }).click();
  await expect(page.getByRole("button", { name: "Untertitel: Sprache 01, ausgewählt", exact: true })).toBeVisible();
  await page.getByText("Als Standard merken", { exact: true }).click();
  await expect(page.getByText("Für weitere Titel auf diesem Gerät gespeichert.")).toBeVisible();
  await page.screenshot({ path: "evidence/mobile-language.png" });
  await page.getByText("Darstellung", { exact: true }).click();
  await page.getByText("Schriftgröße · 100 %", { exact: true }).click();
  await expect(page.getByText("Schriftgröße · 125 %", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Menü schließen" }).click();
  await page.getByRole("button", { name: "Fertig", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sprache & Untertitel", exact: true })).toBeVisible();
  await expect(page.locator("video")).toHaveCount(1);
});

test("TV: Sprachmenü passt bei 960x540, kein Untertitel bleibt erklärt", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto("/app.html?device=tv&tracks=none");
  await expect(page.getByText("Weiterschauen", { exact: true })).toBeVisible();
  await key(page, "ArrowRight"); await key(page, "Enter");
  await page.getByRole("button", { name: "Sprache & Untertitel", exact: true }).click();
  await expect(selected(page)).toHaveAccessibleName('Audio: Deutsch, ausgewählt');
  await key(page, "ArrowRight"); await visibleFocus(page);
  await expect(page.getByText("Für diesen Titel sind keine Untertitel vorhanden.")).toBeVisible();
  await key(page, "ArrowDown"); await expect(selected(page)).toContainText("Darstellung"); await visibleFocus(page);
  await page.screenshot({ path: "evidence/tv-language-empty-960.png" });
  await key(page, "Escape"); await expect(selected(page)).toHaveAttribute("aria-label", "Sprache & Untertitel");
});

test("Handy quer: Sprachmenü und Darstellung bleiben im sichtbaren Bereich", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 }); await ready(page, "mobile");
  await page.getByText("Ansehen", { exact: true }).click();
  await page.getByRole("button", { name: "Sprache & Untertitel", exact: true }).click();
  for (const name of ["Fertig", "Darstellung", "Als Standard merken"]) {
    const b = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: "evidence/mobile-language-landscape.png" });
  await page.getByText("Darstellung", { exact: true }).click();
  const close = await page.getByRole("button", { name: "Menü schließen" }).boundingBox();
  expect(close.y).toBeGreaterThanOrEqual(0);
  await page.getByText("Zeitversatz · 0 s", { exact: true }).scrollIntoViewIfNeeded();
  const shift = await page.getByText("Zeitversatz · 0 s", { exact: true }).boundingBox();
  expect(shift.y + shift.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "evidence/mobile-subtitle-style-landscape.png" });
});

test("TV: Abwärts öffnet den Weg zur Sprache, Untertitel liegen oberhalb der Bedienung", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await ready(page, "tv"); await key(page, "ArrowRight"); await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.currentTime)).toBeGreaterThan(.2);
  await key(page, "Enter");
  await expect.poll(() => page.locator("video").evaluate((v) => v.paused)).toBe(true);
  await expect(selected(page)).toHaveAttribute("aria-label", "Abspielen");
  await key(page, "ArrowDown");
  await expect(selected(page)).toHaveAttribute("aria-label", "Sprache & Untertitel");
  await key(page, "Enter"); await key(page, "ArrowRight"); await key(page, "ArrowDown"); await key(page, "Enter");
  await key(page, "Escape");
  const caption = page.getByText("Vorschau-Untertitel", { exact: true });
  await expect(caption).toBeVisible();
  const text = await caption.boundingBox(), timeline = await page.getByLabel("Wiedergabeposition").boundingBox();
  expect(text.y + text.height).toBeLessThan(timeline.y);
  await page.screenshot({ path: "evidence/tv-subtitle-spacing.png" });
});

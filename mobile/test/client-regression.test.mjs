import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { erzeugeFokusKern } from "../src/fokus-kern.js";
import { erzeugeTastenSteuerung } from "../src/fernbedienung.js";
import { erzeugeFortschrittsSicherung } from "../src/fortschritt-sicherung.js";
const require = createRequire(import.meta.url);

test("Pause ueberschreibt keinen neueren Geraetestand; Aenderungen und fehlgeschlagene Meldungen werden gesendet", async () => {
  const aufrufe = []; let fehler = false;
  const sichern = erzeugeFortschrittsSicherung(async (daten) => { if (fehler) throw new Error("offline"); aufrufe.push(daten); });
  const stand = { mediaType: "movie", refId: 3, position: 100, duration: 1000, watched: false };
  assert.equal(await sichern(stand), true);
  assert.equal(await sichern({ ...stand }), false);
  assert.equal(await sichern({ ...stand }), false);
  assert.equal(aufrufe.length, 1);
  assert.equal(await sichern({ ...stand, position: 200 }), true);
  assert.equal(await sichern({ ...stand, position: 200, watched: true }), true);
  fehler = true; assert.equal(await sichern({ ...stand, position: 300 }), false);
  fehler = false; assert.equal(await sichern({ ...stand, position: 300 }), true);
  assert.equal(aufrufe.length, 4);
});

test("Richtung reagiert sofort, Wiederholung wird begrenzt, Loslassen bewegt nicht doppelt", () => {
  let t = 0, moves = 0, clicks = 0, longs = 0;
  const input = erzeugeTastenSteuerung({ bewegen: () => { moves++; return true; }, ausloesen: () => { clicks++; return true; }, langDruecken: () => { longs++; return true; }, weiter: () => {}, jetzt: () => t });
  input({ eventType: "right", eventKeyAction: 0 }); assert.equal(moves, 1);
  t = 50; input({ eventType: "right", eventKeyAction: 0 }); assert.equal(moves, 1);
  t = 130; input({ eventType: "right", eventKeyAction: 0 }); assert.equal(moves, 2);
  input({ eventType: "right", eventKeyAction: 1 }); assert.equal(moves, 2);
  input({ eventType: "select", eventKeyAction: 0 }); t += 100;
  input({ eventType: "select", eventKeyAction: 1 }); assert.equal(clicks, 1);
  input({ eventType: "select", eventKeyAction: 0 }); t += 700;
  input({ eventType: "select", eventKeyAction: 1 }); assert.equal(clicks, 1); assert.equal(longs, 1);
});

test("Geänderte Metadaten behalten Fokus und deaktivierte Elemente lösen nichts aus", () => {
  const k = erzeugeFokusKern(); let calls = 0;
  k.anmelden("a", { bereich: "inhalt", zeile: 0, spalte: 0, onPress: () => calls++ });
  k.anmelden("b", { bereich: "inhalt", zeile: 0, spalte: 1 });
  k.aktualisieren("a", { spalte: 2 }); assert.equal(k.aktiv, "a");
  k.aktualisieren("a", { uebersprigen: true }); assert.equal(k.aktiv, "b");
  k.setzen("a"); assert.equal(k.aktiv, "b"); assert.equal(calls, 0);
});

test("Navigation kehrt in die bisherige Inhaltszeile zurück", () => {
  const k = erzeugeFokusKern();
  k.anmelden("nav", { bereich: "nav", zeile: 0, spalte: 0 });
  k.anmelden("oben", { bereich: "inhalt", zeile: 0, spalte: 0 });
  k.anmelden("unten", { bereich: "inhalt", zeile: 8, spalte: 0 });
  k.setzen("unten"); k.bewegen("left"); assert.equal(k.aktiv, "nav");
  k.bewegen("right"); assert.equal(k.aktiv, "unten");
});

test("Der Bildschirmpunkt wird nach einem asynchronen Neuaufbau wiederhergestellt", () => {
  const k = erzeugeFokusKern();
  k.vormerken({ bereich: "inhalt", zeile: 3, spalte: 7 });
  k.anmelden("nav", { bereich: "nav", zeile: 0, spalte: 0 });
  k.anmelden("anfang", { bereich: "inhalt", zeile: 0, spalte: 0 });
  k.anmelden("ziel", { bereich: "inhalt", zeile: 3, spalte: 7 });
  assert.equal(k.aktiv, "ziel");
});

test("Dialogaktivierung kann keine Hintergrundaktion auslösen", () => {
  const k = erzeugeFokusKern(); let calls = 0;
  k.anmelden("hintergrund", { bereich: "inhalt", zeile: 0, spalte: 0, onPress: () => calls++ });
  k.dialogAuf(); assert.equal(k.ausloesen(), false); assert.equal(calls, 0);
});

test("TV und Mobile haben getrennte IDs, Laufzeiten und Launcher-Konfigurationen", () => {
  const config = require("../app.config.js");
  const previous = process.env.EXPO_PUBLIC_APP_VARIANT;
  try {
    process.env.EXPO_PUBLIC_APP_VARIANT = "tv"; const tv = config();
    process.env.EXPO_PUBLIC_APP_VARIANT = "mobile"; const mobile = config();
    assert.notEqual(tv.android.package, mobile.android.package);
    assert.notEqual(tv.runtimeVersion, mobile.runtimeVersion);
    assert.equal(tv.orientation, "landscape");
    assert.equal(tv.plugins[0][1].tv, true); assert.equal(mobile.plugins[0][1].tv, false);
  } finally { if (previous === undefined) delete process.env.EXPO_PUBLIC_APP_VARIANT; else process.env.EXPO_PUBLIC_APP_VARIANT = previous; }
});

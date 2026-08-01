/**
 * OBERFLÄCHEN-TEST — rendert wirklich und bedient die Fernbedienung.
 *
 * Die vorigen Tests prüfen Bausteine einzeln: die Auswahl-Logik ohne React,
 * das Laden der Module ohne Bildschirm. Hier kommt beides zusammen: der
 * Startbildschirm wird mit echten Daten durchgerendert, und dann wird mit
 * dem Steuerkreuz hindurchnavigiert — genau wie am Fernseher.
 *
 * Das beantwortet die Fragen, die am Gerät aufgefallen sind:
 *   - Melden sich Poster-Kacheln überhaupt beim Fokus an? (vorher: nein)
 *   - Ist der Player bedienbar? (vorher: nein)
 *   - Kommt man in die Seitenleiste und wieder heraus?
 *
 * Aufruf:
 *   cd mobile
 *   node test/oberflaeche.test.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { baueUmgebung } from "./mini-renderer.mjs";

/* fileURLToPath statt .pathname — siehe Erklaerung in laden.test.mjs
   (unter Windows entstuende sonst "C:\C:\Users\..."). */
const basis = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const U = baueUmgebung(basis);

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

const { lade, render, taste, erzeuge: e } = U;

/* ── Module laden ──────────────────────────────────────────────────────── */
const fokus = lade("src/fokus.js");
const seiten = lade("src/seiten.js");
const seitenleiste = lade("src/seitenleiste.js");
const player = lade("src/player.js");

/* ── Testdaten, wie sie der echte Server liefert ───────────────────────── */
const jetzt = Math.floor(Date.now() / 1000);
const lib = {
  shows: [
    { id: 1, title: "Daredevil", year: 2015, poster: "/d.jpg", backdrop: "/db.jpg", rating: 8.6, seasons: 3, genres: '["Action","Drama","Krimi"]', added_at: jetzt - 2 * 86400, overview: "Anwalt bei Tag." },
    { id: 2, title: "Avatar", year: 2005, poster: "/a.jpg", backdrop: "/ab.jpg", rating: 8.8, seasons: 3, genres: '["Abenteuer","Drama"]', added_at: jetzt - 40 * 86400, overview: "Ein Junge." },
    { id: 3, title: "Miraculous", year: 2015, poster: "/m.jpg", rating: 7.2, seasons: 5, genres: '["Action","Drama"]', added_at: jetzt - 5 * 86400 },
  ],
  movies: [
    { id: 11, title: "Dune", year: 2021, poster: "/du.jpg", backdrop: "/dub.jpg", rating: 8.0, genres: '["Science Fiction","Drama"]', added_at: jetzt - 86400 },
    { id: 12, title: "Alter Film", year: 1998, rating: 4.2, added_at: jetzt - 900 * 86400 },
  ],
};
const weiter = [
  { mediaType: "episode", refId: 101, title: "Miraculous", season: 4, episode: 3, position: 84, duration: 1300, still: "/s.jpg" },
  { mediaType: "movie", refId: 11, title: "Dune", position: 600, duration: 9000 },
];
const verlauf = [{ mediaType: "episode", refId: 99, title: "Daredevil", season: 1, episode: 1, position: 100, duration: 3000 }];
const favoriten = [{ mediaType: "show", refId: 1 }];
const img = (p, g) => (p ? `http://server/api/img?path=${p}&size=${g}` : null);

/* ── Startbildschirm rendern ───────────────────────────────────────────── */
console.log("\n── Startbildschirm rendert durch ───────────────────────────");
let kern = null;
const gedrueckt = [];

function Wurzel() {
  return e(fokus.FokusProvider, null, [
    e(Fang, { key: "f" }),
    e(seitenleiste.Seitenleiste, {
      key: "n", seite: "home", aufSeite: (s) => gedrueckt.push("nav:" + s),
      zahlen: { movies: 2, shows: 3 }, profilName: "Basti", version: "3.0.0", offen: true,
    }),
    e(seiten.StartSeite, {
      key: "s", lib, weiter, verlauf, favoriten, img,
      aufTitel: (x) => gedrueckt.push("titel:" + x.title),
      aufAbspielen: (x) => gedrueckt.push("spiel:" + (x.title || x.refId)),
    }),
  ]);
}
/** Holt sich den Fokus-Kern aus dem Kontext, damit der Test ihn befragen kann. */
function Fang() {
  const sys = fokus.useFokusSystem();
  if (sys) kern = sys.kern;
  return null;
}

let renderFehler = null;
try { render(e(Wurzel)); } catch (err) { renderFehler = err; }

pruefe(
  renderFehler ? `Rendern ohne Ausnahme → FEHLER in <${renderFehler.komponente}>: ${renderFehler.message}` : "Rendern ohne Ausnahme",
  !renderFehler,
);
pruefe("der Fokus-Kern ist erreichbar", !!kern);

if (kern) {
  const alle = kern._alle();
  const nav = alle.filter((x) => x.bereich === "nav");
  const inhalt = alle.filter((x) => x.bereich === "inhalt");

  console.log("\n── Alles meldet sich beim Fokus an ─────────────────────────");
  pruefe(`Seitenleiste: ${nav.length} Einträge (6 Seiten + Profil = 7)`, nav.length === 7);
  pruefe(`Inhalt: ${inhalt.length} auswählbare Elemente`, inhalt.length > 15);
  pruefe("etwas ist von Anfang an ausgewählt", kern.aktiv != null);

  const zeilen = [...new Set(inhalt.map((x) => x.zeile))].sort((a, b) => a - b);
  console.log(`     Inhaltszeilen: ${zeilen.join(", ")}`);
  pruefe("die Zeilen sind lückenlos durchnummeriert",
    zeilen.every((z, i) => z === i));
  pruefe("es gibt mehr als nur die Kopfbild-Zeile", zeilen.length >= 6);

  console.log("\n── Poster-Kacheln sind auswählbar (das ging vorher NICHT) ──");
  // Kachelreihen erkennt man daran, dass sie mehrere Spalten haben
  const proZeile = new Map();
  for (const x of inhalt) proZeile.set(x.zeile, (proZeile.get(x.zeile) || 0) + 1);
  const kachelZeilen = [...proZeile.entries()].filter(([, n]) => n >= 2);
  pruefe(`${kachelZeilen.length} Reihen mit mehreren Kacheln gefunden`, kachelZeilen.length >= 4);
  pruefe("jede Kachel hat eine eigene Spalte",
    kachelZeilen.every(([z]) => {
      const sp = inhalt.filter((x) => x.zeile === z).map((x) => x.spalte);
      return new Set(sp).size === sp.length;
    }));

  console.log("\n── Mit dem Steuerkreuz durch die Oberfläche ────────────────");
  // Auf die erste Kachelreihe stellen
  const ersteKachelZeile = Math.min(...kachelZeilen.map(([z]) => z));
  const start = inhalt.find((x) => x.zeile === ersteKachelZeile && x.spalte === 0);
  kern.setzen(start.schluessel);
  const vorher = kern.aktiv;
  taste("right");
  pruefe("rechts wechselt zur nächsten Kachel", kern.aktiv !== vorher);
  const nachRechts = kern.aktiv;
  taste("left");
  pruefe("links geht zurück", kern.aktiv === vorher);

  taste("down");
  pruefe("runter wechselt die Reihe",
    kern.aktivesElement?.zeile === ersteKachelZeile + 1);
  taste("up");
  pruefe("hoch kommt zurück", kern.aktivesElement?.zeile === ersteKachelZeile);

  console.log("\n── Seitenleiste erreichen und verlassen ────────────────────");
  kern.setzen(start.schluessel);
  taste("left");
  pruefe("links am Rand führt in die Seitenleiste", kern.aktivesElement?.bereich === "nav");
  taste("down");
  pruefe("in der Seitenleiste geht es abwärts", kern.aktivesElement?.bereich === "nav");
  taste("right");
  pruefe("rechts führt zurück in den Inhalt", kern.aktivesElement?.bereich === "inhalt");

  console.log("\n── OK löst wirklich etwas aus ──────────────────────────────");
  gedrueckt.length = 0;
  const eineKachel = inhalt.find((x) => x.zeile === ersteKachelZeile && x.spalte === 1);
  kern.setzen(eineKachel.schluessel);
  taste("select");
  pruefe(`OK ruft die Aktion auf (${gedrueckt[0] || "nichts"})`, gedrueckt.length === 1);

  gedrueckt.length = 0;
  const navEintrag = nav.find((x) => x.zeile === 1);
  kern.setzen(navEintrag.schluessel);
  taste("select");
  pruefe(`OK in der Seitenleiste wechselt die Seite (${gedrueckt[0] || "nichts"})`,
    gedrueckt.length === 1 && String(gedrueckt[0]).startsWith("nav:"));
}

/* ── Player ────────────────────────────────────────────────────────────── */
console.log("\n── Player: Bedienleiste ist erreichbar ─────────────────────");
{
  let pKern = null;
  const api = async (pfad) => {
    if (pfad.startsWith("/api/play")) return { direct: true, directUrl: "/v.mkv", duration: 1300, width: 1920, height: 1080 };
    if (pfad === "/api/progress") return [];
    return {};
  };
  function PWurzel() {
    return e(fokus.FokusProvider, null, [
      e(PFang, { key: "f" }),
      e(player.PlayerScreen, {
        key: "p", api, pop: () => {}, push: () => {}, base: "http://s", conn: {},
        type: "episode", id: 101, title: "Miraculous", subtitle: "S04E03",
        nextEp: { id: 102, se: "S04E04", title: "Nächste" },
      }),
    ]);
  }
  function PFang() {
    const sys = fokus.useFokusSystem();
    if (sys) pKern = sys.kern;
    return null;
  }

  let pFehler = null;
  try { render(e(PWurzel)); } catch (err) { pFehler = err; }
  pruefe(
    pFehler ? `Player rendert → FEHLER in <${pFehler.komponente}>: ${pFehler.message}` : "Player rendert ohne Ausnahme",
    !pFehler,
  );

  if (pKern) {
    const alle = pKern._alle();
    const balken = alle.find((x) => x.schluessel === "player:balken");
    const knoepfe = alle.filter((x) => x.zeile === 1);
    pruefe("der Fortschrittsbalken ist auswählbar", !!balken);
    pruefe(`die Bedienknöpfe sind auswählbar (${knoepfe.length} Stück)`, knoepfe.length >= 4);
    pruefe("der Zurück-Knopf ist auswählbar", alle.some((x) => x.schluessel === "player:zurueck"));

    if (balken) {
      pKern.setzen("player:balken");
      pruefe("beim Öffnen lässt sich der Balken anwählen", pKern.aktiv === "player:balken");
      taste("right");
      pruefe("rechts auf dem Balken springt im Video statt den Fokus zu bewegen",
        pKern.aktiv === "player:balken");
      taste("down");
      pruefe("runter führt zu den Knöpfen", pKern.aktivesElement?.zeile === 1);
      taste("right");
      pruefe("zwischen den Knöpfen lässt sich wechseln", pKern.aktivesElement?.zeile === 1);
      taste("up");
      pruefe("hoch führt zurück zum Balken", pKern.aktiv === "player:balken");
    }
  }
}

/* ── Rasterseiten ──────────────────────────────────────────────────────── */
console.log("\n── Filme-Raster ────────────────────────────────────────────");
{
  let rKern = null;
  function RWurzel() {
    return e(fokus.FokusProvider, null, [
      e(RFang, { key: "f" }),
      e(seiten.RasterSeite, {
        key: "r", titel: "Filme", img, aufTitel: () => {},
        items: Array.from({ length: 23 }, (_, i) => ({ id: i + 1, title: "Film " + (i + 1), rating: 7 })),
      }),
    ]);
  }
  function RFang() {
    const sys = fokus.useFokusSystem();
    if (sys) rKern = sys.kern;
    return null;
  }
  let rFehler = null;
  try { render(e(RWurzel)); } catch (err) { rFehler = err; }
  pruefe(rFehler ? `Raster rendert → ${rFehler.message}` : "Raster rendert ohne Ausnahme", !rFehler);
  if (rKern) {
    const alle = rKern._alle();
    pruefe(`alle 23 Filme sind auswählbar (${alle.length} gefunden)`, alle.length === 23);
    const zeilen = [...new Set(alle.map((x) => x.zeile))];
    pruefe(`sie verteilen sich auf ${zeilen.length} Zeilen`, zeilen.length >= 2);
    pruefe("in jeder Zeile sind die Spalten eindeutig",
      zeilen.every((z) => {
        const sp = alle.filter((x) => x.zeile === z).map((x) => x.spalte);
        return new Set(sp).size === sp.length;
      }));
  }
}

/* ── Leere Bibliothek darf nicht abstürzen ─────────────────────────────── */
console.log("\n── Randfälle ──────────────────────────────────────────────");
{
  let f1 = null;
  try {
    render(e(fokus.FokusProvider, null,
      e(seiten.StartSeite, { lib: { shows: [], movies: [] }, weiter: [], verlauf: [], favoriten: [], img, aufTitel: () => {}, aufAbspielen: () => {} })));
  } catch (err) { f1 = err; }
  pruefe(f1 ? `leere Bibliothek → ${f1.message}` : "leere Bibliothek stürzt nicht ab", !f1);

  let f2 = null;
  try {
    render(e(fokus.FokusProvider, null,
      e(seiten.StartSeite, { lib: null, weiter: [], verlauf: [], favoriten: [], img, aufTitel: () => {}, aufAbspielen: () => {} })));
  } catch (err) { f2 = err; }
  pruefe(f2 ? `noch nicht geladen → ${f2.message}` : "Ladeanzeige stürzt nicht ab", !f2);

  let f3 = null;
  try {
    render(e(fokus.FokusProvider, null,
      e(seiten.StartSeite, {
        lib: { shows: [{ id: 1, title: "Ohne alles" }], movies: [] },
        weiter: [], verlauf: [], favoriten: [], img, aufTitel: () => {}, aufAbspielen: () => {},
      })));
  } catch (err) { f3 = err; }
  pruefe(f3 ? `Titel ohne Bild/Genre/Jahr → ${f3.message}` : "Titel ohne Bild, Genre und Jahr stürzt nicht ab", !f3);
}

/* ── Navigationsleiste unten (Handy) ─────────────────────────────────────
   Am Handy nahm die Seitenleiste die halbe Bildbreite ein; Überschriften
   brachen dadurch mitten im Wort um. Hier wird geprüft, dass die Leiste
   unten dieselben Einträge anbietet, sich beim Fokus anmeldet und WAAGERECHT
   bedient wird — sie liegt ja nebeneinander, nicht untereinander. */
console.log("\n── Navigationsleiste unten (Handy) ─────────────────────────");
{
  let uKern = null;
  const gedrueckt = [];
  function Fang2() {
    const sys = fokus.useFokusSystem();
    if (sys) uKern = sys.kern;
    return null;
  }
  let fehlerU = null;
  try {
    render(e(fokus.FokusProvider, null, [
      e(Fang2, { key: "f" }),
      e(seitenleiste.Unterleiste, {
        key: "u", seite: "home", zahlen: { movies: 65, shows: 12 },
        aufSeite: (s) => gedrueckt.push(s),
      }),
    ]));
  } catch (err) { fehlerU = err; }
  pruefe(fehlerU ? `Leiste unten → ${fehlerU.message}` : "Leiste unten rendert ohne Ausnahme", !fehlerU);

  if (uKern) {
    const nav = uKern._alle().filter((x) => x.bereich === "nav");
    pruefe(`alle ${seitenleiste.NAV.length} Einträge sind anwählbar (${nav.length})`,
      nav.length === seitenleiste.NAV.length);
    pruefe("sie liegen nebeneinander (eine Zeile, verschiedene Spalten)",
      nav.every((x) => x.zeile === 0) && new Set(nav.map((x) => x.spalte)).size === nav.length);

    uKern.setzen(nav[0].schluessel);
    taste("right");
    pruefe("rechts wandert zum nächsten Eintrag", uKern.aktivesElement?.spalte === 1);
    taste("left");
    pruefe("links wieder zurück", uKern.aktivesElement?.spalte === 0);

    gedrueckt.length = 0;
    uKern.setzen(nav[1].schluessel);
    taste("select");
    pruefe(`OK wechselt die Seite (${gedrueckt[0] || "nichts"})`,
      gedrueckt.length === 1 && gedrueckt[0] === seitenleiste.NAV[1].id);
  }
}

console.log("\n────────────────────────────────────────────────────────────");
U.aufraeumen();
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Oberflächen-Tests bestanden.`);

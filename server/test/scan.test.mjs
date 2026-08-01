// ============================================================================
// Scanner-Test — baut eine echte Beispiel-Bibliothek auf der Platte auf und
// lässt den Scanner darüberlaufen (ohne TMDb, rein die Erkennung).
//
// Start:  node --experimental-sqlite test/scan.test.mjs      (Node 22)
//         node test/scan.test.mjs                            (Node 24+)
//
// Geprüft wird genau das, was am Desktop bereits funktioniert und im Server
// vorher kaputt war: Staffeln einer Serie in EINEM Eintrag, Serienordner als
// Bibliothek, Sample-Filter, Mehrteiler, Specials, Filme aus Ordnernamen.
// ============================================================================
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = join(tmpdir(), `ghgflix-test-${Date.now()}`);
process.env.DATA_DIR = join(ROOT, "data");
process.env.TMDB_API_KEY = ""; // keine Netzwerkzugriffe im Test

const { openDb, addLibrary } = await import("../src/db.js");
const { scanLibrary } = await import("../src/scanner.js");

// ── Beispiel-Bibliothek anlegen ─────────────────────────────────────────────
const FILLER = Buffer.alloc(1.2 * 1024 * 1024, 0); // > MIN_VIDEO_MB
const file = (...parts) => {
  const p = join(ROOT, ...parts);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, FILLER);
  return p;
};
const img = (...parts) => {
  const p = join(ROOT, ...parts);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  return p;
};

// Serien
file("tv", "Marvel's Daredevil Season 1", "Daredevil.S01E01.1080p.BluRay.x264-GROUP.mkv");
file("tv", "Marvel's Daredevil Season 1", "Daredevil.S01E02.1080p.BluRay.x264-GROUP.mkv");
file("tv", "Marvel's Daredevil Season 2", "Daredevil.S02E01.1080p.WEB-DL.mkv");
file("tv", "Marvel's Daredevil Season 2", "sample.mkv"); // muss ignoriert werden
file("tv", "Stranger Things", "Season 1", "Stranger.Things.S01E01.mkv");
file("tv", "Stranger Things", "Season 1", "Stranger.Things.S01E02.mkv");
file("tv", "Stranger Things", "Specials", "Stranger.Things.S00E01.Behind.mkv");
file("tv", "Stranger Things", "Extras", "irgendwas.mkv"); // Extras-Ordner: ignorieren
file("tv", "Firefly (2002)", "Season 1", "Firefly - s01e01-e02 - Serenity.mkv");
file("tv", "www.UIndex.org - Loki", "Staffel 1", "Folge 3.mkv");
// Regression: Sammelordner einer Release-Seite. Vorher wurde daraus der Titel
// "org" und TMDb fand die völlig fremde Serie "OrG! (Come & Play)".
file("tv", "www.UIndex.org", "Daredevil.Born.Again.S02E01.DSNP.DDP5.1.HDR.2160p.WEB-DL.mkv");
file("tv", "www.UIndex.org", "Daredevil.Born.Again.S02E06.Requiem.DSNP.DDP5.1.HDR.2160p.WEB-DL.mkv");
img("tv", "Stranger Things", "poster.jpg");
img("tv", "Stranger Things", "fanart.jpg");
img("tv", "Stranger Things", "season01-poster.jpg");

// Filme
file("movies", "The.Matrix.1999.1080p.BluRay.x264.mkv");
file("movies", "Inception (2010)", "Inception.mkv");
img("movies", "Inception (2010)", "poster.jpg");
file("movies", "Interstellar (2014)", "Interstellar-trailer.mkv"); // Trailer: ignorieren
file("movies", "Interstellar (2014)", "Interstellar.mkv");

// ── Scan ────────────────────────────────────────────────────────────────────
const db = openDb();
addLibrary(join(ROOT, "tv"), "show", "TV");
addLibrary(join(ROOT, "movies"), "movie", "Filme");
await scanLibrary();

// ── Prüfungen ───────────────────────────────────────────────────────────────
let fails = 0;
const check = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) {
    fails++;
    console.error(`✗ ${label}\n   erwartet: ${JSON.stringify(want)}\n   bekommen: ${JSON.stringify(got)}`);
  } else console.log(`✓ ${label}`);
};

const shows = db.prepare("SELECT id, title, year, folder FROM shows ORDER BY title").all();
const titles = shows.map((s) => s.title);
check("Serien: Staffeln zusammengefasst, kein Seiten-Ordner als Serie", titles, [
  "Daredevil Born Again",
  "Firefly",
  "Loki",
  "Marvel's Daredevil",
  "Stranger Things",
]);

// Regression zum "OrG!"-Fehler: der Sammelordner darf NIE eine Serie werden
check("Kein Muell-Titel 'org' in der Bibliothek", titles.some((t) => /^org/i.test(t)), false);
const dba = shows.find((s) => s.title === "Daredevil Born Again");
check(
  "Dateien aus dem Seiten-Ordner landen bei der richtigen Serie",
  db.prepare("SELECT season, episode FROM episodes WHERE show_id=? ORDER BY episode").all(dba.id),
  [{ season: 2, episode: 1 }, { season: 2, episode: 6 }],
);

const dd = shows.find((s) => s.title === "Marvel's Daredevil");
const ddEps = db.prepare("SELECT season, episode FROM episodes WHERE show_id=? ORDER BY season, episode").all(dd.id);
check("Daredevil: 2 Staffeln in EINER Serie", ddEps, [
  { season: 1, episode: 1 },
  { season: 1, episode: 2 },
  { season: 2, episode: 1 },
]);

const st = shows.find((s) => s.title === "Stranger Things");
const stEps = db.prepare("SELECT season, episode FROM episodes WHERE show_id=? ORDER BY season, episode").all(st.id);
check("Stranger Things: Specials als Staffel 0, Extras ignoriert", stEps, [
  { season: 0, episode: 1 },
  { season: 1, episode: 1 },
  { season: 1, episode: 2 },
]);

/* Specials zaehlen NICHT als eigene Staffel.
   Stranger Things hat hier Staffel 0 (Specials) und Staffel 1 — richtig ist
   also "1 Staffel", nicht "2". Genau dieser Fehler liess Miraculous mit
   "7 Staffeln" dastehen, obwohl es sechs plus Specials sind. Geprueft wird
   dieselbe Rechnung, die die Oberflaeche benutzt (siehe invoke.js/showOut
   und die Bibliotheksabfrage in index.js). */
const stStaffeln = db
  .prepare("SELECT COUNT(DISTINCT CASE WHEN season > 0 THEN season END) s FROM episodes WHERE show_id=?")
  .get(st.id).s;
check("Specials zaehlen nicht als Staffel (1, nicht 2)", stStaffeln, 1);
const stFolgen = db.prepare("SELECT COUNT(id) e FROM episodes WHERE show_id=?").get(st.id).e;
check("Folgenzahl enthaelt die Specials aber schon", stFolgen, 3);

const ff = shows.find((s) => s.title === "Firefly");
const ffEp = db.prepare("SELECT season, episode, episode_end FROM episodes WHERE show_id=?").get(ff.id);
check("Firefly: Mehrteiler s01e01-e02", ffEp, { season: 1, episode: 1, episode_end: 2 });
check("Firefly: Jahr aus dem Ordner", ff.year, 2002);

const loki = shows.find((s) => s.title === "Loki");
const lokiEp = db.prepare("SELECT season, episode FROM episodes WHERE show_id=?").get(loki.id);
check("Loki: URL-Präfix weg, 'Folge 3' im Staffelordner erkannt", lokiEp, { season: 1, episode: 3 });

const movies = db.prepare("SELECT title, year FROM movies ORDER BY title").all();
check("Filme: Trailer ignoriert, Ordnernamen genutzt", movies, [
  { title: "Inception", year: 2010 },
  { title: "Interstellar", year: 2014 },
  { title: "The Matrix", year: 1999 },
]);

const stArt = db.prepare("SELECT local_poster, local_backdrop FROM shows WHERE id=?").get(st.id);
check("Lokales Poster gefunden", !!stArt.local_poster, true);
check("Lokaler Hintergrund gefunden", !!stArt.local_backdrop, true);
const seasonArt = db.prepare("SELECT season, path FROM season_art WHERE show_id=?").all(st.id);
check("Staffelposter (season01-poster.jpg) gefunden", seasonArt.length >= 1, true);

const inception = db.prepare("SELECT local_poster FROM movies WHERE title='Inception'").get();
check("Film: lokales Poster gefunden", !!inception.local_poster, true);

// Zweiter Lauf muss stabil sein (keine Duplikate, keine Wanderung)
await scanLibrary();
check("Zweiter Scan: gleiche Serienanzahl", db.prepare("SELECT COUNT(*) c FROM shows").get().c, 5);
check("Zweiter Scan: gleiche Folgenanzahl", db.prepare("SELECT COUNT(*) c FROM episodes").get().c, 10);
check("Zweiter Scan: gleiche Filmanzahl", db.prepare("SELECT COUNT(*) c FROM movies").get().c, 3);

// ── Regressionstests zu den im Review gefundenen Fehlern ───────────────────

// (a) Zweite Qualität derselben Folge = Variante, keine doppelte Folge
file("tv", "Marvel's Daredevil Season 1", "Daredevil.S01E01.2160p.WEB-DL.mkv");
await scanLibrary();
check("Zweite Qualität erzeugt KEINE doppelte Folge", db.prepare("SELECT COUNT(*) c FROM episodes").get().c, 10);
check(
  "Zweite Qualität ist als Dateivariante hinterlegt",
  db.prepare("SELECT COUNT(*) c FROM episode_files ef JOIN episodes e ON e.id=ef.episode_id WHERE e.season=1 AND e.episode=1 AND e.show_id=?").get(dd.id).c,
  2,
);

// (b) Leerer Ordner (kaputter Docker-Mount) darf die Bibliothek NICHT löschen
const moviesBefore = db.prepare("SELECT COUNT(*) c FROM movies").get().c;
rmSync(join(ROOT, "movies"), { recursive: true, force: true });
mkdirSync(join(ROOT, "movies"), { recursive: true }); // existiert, aber leer
await scanLibrary();
check("Leerer Mount löscht die Filme NICHT", db.prepare("SELECT COUNT(*) c FROM movies").get().c, moviesBefore);

// (c) Wirklich entfernte Datei verschwindet auch aus der Datenbank
const stEpsBefore = db.prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=?").get(st.id).c;
rmSync(join(ROOT, "tv", "Stranger Things", "Season 1", "Stranger.Things.S01E02.mkv"), { force: true });
await scanLibrary();
check("Gelöschte Datei verschwindet aus der Bibliothek", db.prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=?").get(st.id).c, stEpsBefore - 1);

// (d) Gelöschtes lokales Poster wird auch in der Datenbank geleert
rmSync(join(ROOT, "tv", "Stranger Things", "poster.jpg"), { force: true });
await scanLibrary();
check("Entferntes lokales Poster wird zurückgesetzt", db.prepare("SELECT local_poster FROM shows WHERE id=?").get(st.id).local_poster, null);

// Aufräumen
try {
  rmSync(ROOT, { recursive: true, force: true });
} catch {
  /* egal */
}

console.log(fails === 0 ? "\nAlle Scanner-Tests bestanden." : `\n${fails} Test(s) fehlgeschlagen.`);
process.exit(fails === 0 ? 0 : 1);

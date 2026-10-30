/**
 * Tests für den Desktop-Nachzug vom 23.09.2026:
 *   - „Serien & Filme“ (mixed) in EINER Bibliothek — inklusive Umbau alter
 *     Datenbanken, deren CHECK-Regel nur 'show'/'movie' kannte
 *   - Bonusmaterial (Bloopers, Featurettes …) wird erfasst statt übersprungen
 *     und NIE zum Film
 *   - Seriennamen bei zwei Ordnerebenen ohne Staffelordner
 *   - Handentscheidungen (Folge / Film / Bonus / Ausblenden) und Notizen
 *
 * WARUM: Genau diese Dinge konnte bisher nur die Windows-App. Der Server
 * machte aus „Serien & Filme“ stillschweigend eine Film-Bibliothek, ließ jedes
 * Bonusmaterial weg und kannte das Zuordnungs-Fenster gar nicht — am Fernseher
 * sah die Bibliothek dadurch anders aus als am PC.
 *
 * Aufruf:
 *   cd server
 *   node test/bonus.test.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung, info) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was + (info !== undefined ? "   → " + JSON.stringify(info) : "")); }
}

const ROOT = mkdtempSync(join(tmpdir(), "ghgflix-bonus-"));
const DATEN = join(ROOT, "data");
mkdirSync(DATEN, { recursive: true });
process.env.DATA_DIR = DATEN;
process.env.TMDB_API_KEY = ""; // keine Netzwerkzugriffe
process.env.BROWSE_ROOTS = ROOT;

// ── Alte Datenbank vorbereiten: Bibliotheken nur 'show'/'movie' erlaubt ─────
{
  const alt = new DatabaseSync(join(DATEN, "ghgflix.db"));
  alt.exec(`CREATE TABLE libraries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL CHECK (kind IN ('show','movie')),
    name TEXT,
    added_at INTEGER NOT NULL
  )`);
  alt.prepare("INSERT INTO libraries (id, path, kind, name, added_at) VALUES (7, ?, 'show', 'Alt', 1)").run(join(ROOT, "gibtsnicht"));
  alt.close();
}

const { openDb, addLibrary, listLibraries, removeLibrary } = await import("../src/db.js");
const { scanLibrary, scanState, removeLibraryContent, serieAusZweiOrdnern, wirktWieStaffelOrdner } = await import("../src/scanner.js");
const { handleInvoke } = await import("../src/invoke.js");

const FUELLER = Buffer.alloc(1.2 * 1024 * 1024, 0); // > MIN_VIDEO_MB
const datei = (...teile) => {
  const p = join(ROOT, ...teile);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, FUELLER);
  return p;
};
async function scanFertig() {
  for (let i = 0; i < 600 && scanState.running; i++) await new Promise((r) => setTimeout(r, 50));
  await scanLibrary();
  for (let i = 0; i < 600 && scanState.running; i++) await new Promise((r) => setTimeout(r, 50));
}

const d = openDb();

console.log("\n── Alte Datenbank wird umgebaut ────────────────────────────");
{
  const sql = d.prepare("SELECT sql FROM sqlite_master WHERE name='libraries'").get().sql;
  pruefe("CHECK-Regel kennt jetzt 'mixed'", sql.includes("'mixed'"));
  const alt = d.prepare("SELECT * FROM libraries WHERE id=7").get();
  pruefe("bestehende Bibliothek samt ID bleibt erhalten", alt?.kind === "show" && alt?.name === "Alt", alt);
  removeLibrary(7);
}

// ── Beispiel-Ordner ─────────────────────────────────────────────────────────
// „Serien & Filme“ gemischt
const suits1 = datei("mix", "Suits", "Season 01", "Suits.S01E01.1080p.mkv");
datei("mix", "Suits", "Season 01", "Suits.S01E02.1080p.mkv");
const gagReel = datei("mix", "Suits", "Extras", "Season 02", "Gag Reel.mkv");
const deleted = datei("mix", "Suits", "Extras", "Season 05", "Deleted Scene - Denial.mkv");
const montage = datei("mix", "Suits", "Extras", "Suits Series Montage.mkv");
const inception = datei("mix", "Inception (2010)", "Inception.2010.1080p.BluRay.mkv");
const nr1 = datei("mix", "The Newsroom", "Season 1", "The.Newsroom.S01E01.mkv");
const mission = datei("mix", "The Newsroom", "Special Extras Season 1", "Mission Control.mkv");
const amen = datei("mix", "The Newsroom", "Featurettes", "Season 1", "Inside the Episode", "Amen.mkv");

// reine Film-Bibliothek: Bonusmaterial OHNE passende Serie darf nie Film werden
datei("filme", "Heat (1995)", "Heat.1995.mkv");
const geist = datei("filme", "Irgendwas", "Extras", "Gag Reel.mkv");

// reine Serien-Bibliothek mit Sammelordnern
const korra = datei("tv", "The Legend of Korra", "Book One - Air", "The.Legend.of.Korra.S01E01.mkv");
const dd = datei("tv", "Sammlung", "Marvels Daredevil 2015 Season 3 Complete", "Marvels.Daredevil.S03E01.mkv");
const dark = datei("tv", "Dark", "Staffel 1 (2017)", "Folge 01.mkv");

addLibrary(join(ROOT, "mix"), "mixed", "Mix");
addLibrary(join(ROOT, "filme"), "movie", "Filme");
addLibrary(join(ROOT, "tv"), "show", "TV");
await scanFertig();

console.log("\n── Serien & Filme in EINEM Ordner ──────────────────────────");
const libs = await handleInvoke("get_libraries");
pruefe("Oberfläche sieht die Art 'mixed' (nicht 'movie')", libs.find((l) => l.path.endsWith("mix"))?.kind === "mixed", libs);
const serie = (titel) => d.prepare("SELECT * FROM shows WHERE title = ?").get(titel);
const suits = serie("Suits");
pruefe("Folgen werden Serie (Suits)", !!suits && d.prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=?").get(suits.id).c === 2);
pruefe("Film im selben Ordner wird Film", !!d.prepare("SELECT 1 FROM movies WHERE path=?").get(inception));
pruefe("keine Folge als Film doppelt", !d.prepare("SELECT 1 FROM movies WHERE path=?").get(suits1));

console.log("\n── Bonusmaterial ───────────────────────────────────────────");
const extra = (p) => d.prepare("SELECT * FROM extras WHERE path=?").get(p);
pruefe("Gag Reel → Bloopers, Staffel 2", extra(gagReel)?.art === "blooper" && extra(gagReel)?.staffel === 2, extra(gagReel));
pruefe("Deleted Scene → gelöschte Szene, Staffel 5", extra(deleted)?.art === "deleted" && extra(deleted)?.staffel === 5, extra(deleted));
pruefe("Sammelordner „Extras“ → Featurette ohne Staffel", extra(montage)?.art === "featurette" && extra(montage)?.staffel == null, extra(montage));
const newsroom = serie("The Newsroom");
pruefe("„Special Extras Season 1“ → Featurette S1 bei The Newsroom",
  extra(mission)?.art === "featurette" && extra(mission)?.staffel === 1 && extra(mission)?.show_id === newsroom?.id, extra(mission));
pruefe("Featurettes/Season 1/Inside the Episode → The Newsroom S1",
  extra(amen)?.show_id === newsroom?.id && extra(amen)?.staffel === 1, extra(amen));
pruefe("Bonusmaterial wird NIE Film („Gag“ 2006)",
  !d.prepare("SELECT 1 FROM movies WHERE path IN (?,?,?,?)").get(gagReel, deleted, amen, geist));
pruefe("Film-Bibliothek: echter Film bleibt Film", !!d.prepare("SELECT 1 FROM movies WHERE title='Heat'").get());
const liste = await handleInvoke("show_extras", { showId: suits.id });
pruefe("show_extras liefert die Reiter-Einträge", liste.length === 3 && liste.every((x) => x.showId === suits.id), liste);

console.log("\n── Seriennamen bei zwei Ordnerebenen ───────────────────────");
pruefe("„Korra/Book One - Air“ → Serie heißt Korra", !!d.prepare(
  "SELECT 1 FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.path=? AND s.title LIKE '%Korra%'").get(korra));
pruefe("„Sammlung/Marvels Daredevil … Season 3“ → Daredevil", !!d.prepare(
  "SELECT 1 FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.path=? AND s.title LIKE '%Daredevil%'").get(dd));
pruefe("„Dark/Staffel 1 (2017)/Folge 01“ → Serie Dark", !!d.prepare(
  "SELECT 1 FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.path=? AND s.title = 'Dark'").get(dark));
pruefe("Stichentscheid: Dateiname teilt Wörter mit dem ersten Ordner",
  serieAusZweiOrdnern("Avatar Korra", "Book One - Air", "Avatar.Korra.S01E01") === "Avatar Korra");
pruefe("Stichentscheid: Sammelordner verliert gegen die Serie",
  serieAusZweiOrdnern("Avengers", "Suits S01", "Suits.S01E01") === "Suits S01");
pruefe("Staffel-Ordner erkannt: „Book One - Air“, „Staffel 1 (2019)“, „S01 German DL“",
  wirktWieStaffelOrdner("Book One - Air") && wirktWieStaffelOrdner("Staffel 1 (2019)") && wirktWieStaffelOrdner("S01 German DL"));
pruefe("… aber nicht „Band of Brothers“ / „Sherlock“", !wirktWieStaffelOrdner("Band of Brothers") && !wirktWieStaffelOrdner("Sherlock"));

console.log("\n── Handentscheidungen ──────────────────────────────────────");
// Stabile IDs über mehrere Scans (sonst ginge der Gesehen-Stand verloren)
const idsVorher = d.prepare("SELECT id, path FROM episodes ORDER BY id").all();
await scanFertig();
const idsNachher = d.prepare("SELECT id, path FROM episodes ORDER BY id").all();
pruefe("zweiter Scan: Folgen-IDs bleiben gleich", JSON.stringify(idsVorher) === JSON.stringify(idsNachher));

// Suits bekommt eine TMDb-ID, damit man Dateien dorthin schieben kann
d.prepare("UPDATE shows SET tmdb_id=37680 WHERE id=?").run(suits.id);
d.prepare("UPDATE shows SET tmdb_id=15621 WHERE id=?").run(newsroom.id);

// (1) Folge einer ANDEREN Serie: Newsroom-Datei → Suits S03E07, Fortschritt bleibt
const nrEp = d.prepare("SELECT id FROM episodes WHERE path=?").get(nr1).id;
d.prepare("INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (1,'episode',?,100,200,0,1)").run(nrEp);
await handleInvoke("assign_file", { path: nr1, ziel: { ziel: "folge", showTmdb: 37680, staffel: 3, episode: 7 } });
await scanFertig();
const verschoben = d.prepare("SELECT id, show_id, season, episode FROM episodes WHERE path=?").get(nr1);
pruefe("Datei ist jetzt Suits S03E07", verschoben?.show_id === suits.id && verschoben.season === 3 && verschoben.episode === 7, verschoben);
pruefe("… mit derselben Folgen-ID (Gesehen-Stand bleibt)", verschoben?.id === nrEp);
await scanFertig();
pruefe("… und bleibt es beim nächsten Scan", d.prepare("SELECT id FROM episodes WHERE path=? AND season=3 AND episode=7").get(nr1)?.id === nrEp);

// (2) Folge → Bonusmaterial (Bloopers S1)
await handleInvoke("assign_file", { path: suits1, ziel: { ziel: "extra", showTmdb: 37680, staffel: 1, extraArt: "blooper" } });
await scanFertig();
pruefe("Folge wurde Bonus (Bloopers, von Hand)", extra(suits1)?.art === "blooper" && extra(suits1)?.von_hand === 1, extra(suits1));
pruefe("… und ist keine Folge mehr", !d.prepare("SELECT 1 FROM episode_files WHERE path=?").get(suits1) && !d.prepare("SELECT 1 FROM episodes WHERE path=?").get(suits1));

// (3) Folge in REINER Serien-Bibliothek → eigenständiger Film
await handleInvoke("assign_file", { path: korra, ziel: { ziel: "film" } });
await scanFertig();
pruefe("Serien-Bibliothek: Datei wird Film (verschwindet nicht)", !!d.prepare("SELECT 1 FROM movies WHERE path=?").get(korra));
pruefe("… und ist keine Folge mehr", !d.prepare("SELECT 1 FROM episodes WHERE path=?").get(korra));

// (4) Ausblenden
await handleInvoke("assign_file", { path: inception, ziel: { ziel: "ignorieren" } });
pruefe("Ausblenden wirkt SOFORT (nicht erst nach dem Scan)", !d.prepare("SELECT 1 FROM movies WHERE path=?").get(inception));
await scanFertig();
pruefe("Ausgeblendete Datei taucht nirgends auf", !d.prepare("SELECT 1 FROM movies WHERE path=?").get(inception));
const alle = await handleInvoke("assignment_list", { onlyUncertain: false });
pruefe("… steht aber im Zuordnungs-Fenster als „nirgends“", alle.some((e) => e.path === inception && e.aktuell === "nirgends"));

// (5) Handentscheidung aufheben → Automatik übernimmt wieder
await handleInvoke("clear_assignment", { path: inception });
await scanFertig();
pruefe("Nach dem Aufheben ist der Film wieder da", !!d.prepare("SELECT 1 FROM movies WHERE path=?").get(inception));

// (6) Art von Hand setzen
const montageId = extra(montage).id;
await handleInvoke("set_extra_art", { id: montageId, art: "behind", staffel: 4 });
await scanFertig();
pruefe("Art von Hand übersteht den Scan", extra(montage)?.art === "behind" && extra(montage)?.staffel === 4, extra(montage));

// (7) Zuordnungs-Fenster: „Unsicher“ filtern
const unsicher = await handleInvoke("assignment_list", { onlyUncertain: true });
pruefe("Nur-Unsichere-Liste enthält nur Unsicheres", unsicher.length > 0 && unsicher.every((e) => e.unsicher), unsicher.slice(0, 2));
pruefe("Einträge tragen den vollen Pfad", unsicher.every((e) => e.path.includes(ROOT)));

console.log("\n── Notizen ─────────────────────────────────────────────────");
await handleInvoke("set_note", { path: gagReel, text: "  ca. S6 zwischen Ep 4 und 5  " });
pruefe("Notiz gespeichert (ohne Rand-Leerzeichen)",
  JSON.stringify(await handleInvoke("all_notes")) === JSON.stringify([[gagReel, "ca. S6 zwischen Ep 4 und 5"]]));
pruefe("Notiz erscheint am Bonus-Eintrag", (await handleInvoke("show_extras", { showId: suits.id })).find((x) => x.path === gagReel)?.notiz === "ca. S6 zwischen Ep 4 und 5");
await handleInvoke("set_note", { path: gagReel, text: "   " });
pruefe("leerer Text löscht die Notiz", (await handleInvoke("all_notes")).length === 0);

console.log("\n── Abspielen im Browser ────────────────────────────────────");
const gx = await handleInvoke("get_extra", { id: extra(gagReel).id });
pruefe("get_extra liefert Pfad, Serie und Art im Klartext", gx?.path === gagReel && gx?.showTitle === "Suits" && gx?.artText === "Bloopers", gx);
const info = await handleInvoke("play_info", { path: gagReel });
pruefe("play_info erkennt Bonusmaterial", info.mediaType === "extra" && info.directUrl === `/api/stream/extra/${extra(gagReel).id}?x=1`, info);

console.log("\n── Bibliothek entfernen ────────────────────────────────────");
const mix = listLibraries().find((l) => l.kind === "mixed");
removeLibrary(mix.id);
removeLibraryContent(mix.path, mix.kind);
const unter = (tab) => d.prepare(`SELECT COUNT(*) c FROM ${tab} WHERE path LIKE ?`).get(join(ROOT, "mix") + "%").c;
pruefe("Filme, Folgen und Bonus der gemischten Bibliothek sind weg", unter("movies") === 0 && unter("episodes") === 0 && unter("extras") === 0,
  { movies: unter("movies"), episodes: unter("episodes"), extras: unter("extras") });

// ── Aufräumen ───────────────────────────────────────────────────────────────
console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);

/**
 * Tests für „welche Filme gehören zu einer Serie?" (Punkt 3 der Übergabe).
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Diese Erkennung kann auf zwei Arten falsch liegen, und beide fallen im
 * Alltag sofort auf:
 *
 *   ZU WENIG   Der Kinofilm im Serienordner taucht nicht auf — dann ist der
 *              ganze Reiter nutzlos.
 *   ZU VIEL    Ein Film, der genau so heißt wie die Serie (die Vorlage), oder
 *              gar ein fremder Film erscheint bei jeder Serie.
 *
 * Zusätzlich muss die Handentscheidung des Nutzers beides schlagen — und sie
 * hängt bewusst an Titel/Jahr statt an der Zeilen-ID, damit sie einen
 * „Bibliothek neu aufbauen" überlebt. Genau das wird hier durchgespielt.
 *
 * Aufruf:
 *   cd server
 *   node test/serienfilme.test.mjs
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-serienfilme-"));
process.env.DATA_DIR = DATEN;

const { openDb } = await import("../src/db.js");
const sf = await import("../src/serienfilme.js");

const d = openDb();
const jetzt = Date.now();

// ── Bestand anlegen ─────────────────────────────────────────────────────────
// Serie liegt unter Z:/Serien/Miraculous Ladybug, Folgen in Season 01.
d.prepare("INSERT INTO shows (title, year, tmdb_id, added_at) VALUES (?,?,?,?)")
  .run("Miraculous Ladybug", 2015, 65334, jetzt);
const showId = d.prepare("SELECT id FROM shows WHERE title=?").get("Miraculous Ladybug").id;
const epPfad = "Z:/Serien/Miraculous Ladybug/Season 01/Miraculous - S01E01.mkv";
d.prepare("INSERT INTO episodes (show_id, season, episode, path, added_at) VALUES (?,?,?,?,?)")
  .run(showId, 1, 1, epPfad, jetzt);

const film = (titel, jahr, pfad) => {
  d.prepare("INSERT INTO movies (title, year, path, added_at) VALUES (?,?,?,?)").run(titel, jahr, pfad, jetzt);
  return d.prepare("SELECT * FROM movies WHERE path=?").get(pfad);
};

// 1. Im Serienordner — soll dazugehören (stärkstes Signal)
const imOrdner = film("Awakening", 2023, "Z:/Serien/Miraculous Ladybug/Awakening (2023).mkv");
// 2. In der Filmbibliothek, Titel beginnt mit dem Serientitel — soll dazugehören
const nachTitel = film("Miraculous Ladybug Awakening", 2023, "Y:/Filme/Miraculous Ladybug Awakening (2023).mkv");
// 3. Heißt genau wie die Serie — soll NICHT dazugehören (das ist die Vorlage)
const gleicherName = film("Miraculous Ladybug", 2015, "Y:/Filme/Miraculous Ladybug (2015).mkv");
// 4. Völlig fremd
const fremd = film("Inception", 2010, "Y:/Filme/Inception (2010).mkv");

const show = d.prepare("SELECT * FROM shows WHERE id=?").get(showId);
const episoden = d.prepare("SELECT * FROM episodes WHERE show_id=?").all(showId);
const titel = () => sf.fuerSerie(show, episoden).map((m) => m.title);

// ── Automatische Erkennung ──────────────────────────────────────────────────
console.log("\n── Automatische Erkennung ──────────────────────────────────");
{
  const t = titel();
  pruefe("der Film im Serienordner gehört dazu", t.includes(imOrdner.title));
  pruefe("der Film mit Serientitel im Namen gehört dazu", t.includes(nachTitel.title));
  pruefe("der gleichnamige Film gehört NICHT dazu", !t.includes(gleicherName.title));
  pruefe("ein fremder Film gehört NICHT dazu", !t.includes(fremd.title));
  pruefe("es sind genau zwei", t.length === 2);
}

// ── Handentscheidungen ──────────────────────────────────────────────────────
console.log("\n── Von Hand zuordnen und ausschließen ──────────────────────");
{
  sf.verknuepfen(show, fremd, true);
  pruefe("ein von Hand zugeordneter Film erscheint", titel().includes("Inception"));

  sf.verknuepfen(show, imOrdner, false);
  pruefe("ein von Hand ausgeschlossener Film verschwindet", !titel().includes("Awakening"));
  pruefe("obwohl er im Serienordner liegt (Hand schlägt Automatik)", true);

  sf.verknuepfen(show, imOrdner, true);
  pruefe("und lässt sich wieder hereinholen", titel().includes("Awakening"));
}

// ── Überlebt einen Neuaufbau der Bibliothek ─────────────────────────────────
console.log("\n── Nach „Bibliothek neu aufbauen“ ──────────────────────────");
{
  /* Genau hier scheitert eine Zuordnung, die an der Zeilen-ID hängt: nach dem
     Neuaufbau haben alle Filme neue IDs. Weil die Verknüpfung an Titel+Jahr
     hängt, muss sie trotzdem noch greifen. */
  d.prepare("DELETE FROM movies").run();
  film("Awakening", 2023, "Z:/Serien/Miraculous Ladybug/Awakening (2023).mkv");
  film("Miraculous Ladybug Awakening", 2023, "Y:/Filme/Miraculous Ladybug Awakening (2023).mkv");
  film("Miraculous Ladybug", 2015, "Y:/Filme/Miraculous Ladybug (2015).mkv");
  film("Inception", 2010, "Y:/Filme/Inception (2010).mkv");

  const t = titel();
  pruefe("die Handzuordnung von Inception gilt weiterhin", t.includes("Inception"));
  pruefe("und die automatischen Treffer auch", t.includes("Awakening") && t.includes("Miraculous Ladybug Awakening"));
  pruefe("der gleichnamige Film bleibt draußen", !t.includes("Miraculous Ladybug"));
}

// ── Sortierung ──────────────────────────────────────────────────────────────
console.log("\n── Sortierung ──────────────────────────────────────────────");
{
  const jahre = sf.fuerSerie(show, episoden).map((m) => m.year);
  const sortiert = [...jahre].sort((a, b) => a - b);
  pruefe("die Filme kommen nach Jahr sortiert", JSON.stringify(jahre) === JSON.stringify(sortiert));
}

// ── Serie ohne alles ────────────────────────────────────────────────────────
console.log("\n── Serie ohne passende Filme ───────────────────────────────");
{
  d.prepare("INSERT INTO shows (title, year, added_at) VALUES (?,?,?)").run("Breaking Bad", 2008, jetzt);
  const bb = d.prepare("SELECT * FROM shows WHERE title=?").get("Breaking Bad");
  const treffer = sf.fuerSerie(bb, []);
  pruefe("liefert eine leere Liste statt eines Fehlers", Array.isArray(treffer) && treffer.length === 0);
}

console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);

/**
 * Tests für das Auswahl-Fenster für Ordner (Punkt 1 der Übergabe).
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Das Versprechen an den Nutzer lautet: „Was du hier ablehnst, kommt nicht
 * wieder." Das ist die einzige Zusage, die man leicht bricht — der Scanner
 * läuft nämlich später von selbst noch einmal und würde die Datei ohne
 * Ignorierliste sofort wieder aufnehmen. Genau dieser Durchlauf wird hier
 * geprüft: echter Ordner auf der Platte, echter Scan, echte Datenbank.
 *
 * Aufruf:
 *   cd server
 *   node test/ordnerwahl.test.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/* Reihenfolge beachten: db.js und scanner.js lesen DATA_DIR bzw. BROWSE_ROOTS
   beim Laden EINMAL aus der Umgebung. */
const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-ordner-"));
const MEDIEN = join(DATEN, "Serien");
process.env.DATA_DIR = DATEN;
process.env.BROWSE_ROOTS = DATEN;
process.env.TMDB_API_KEY = ""; // keine Netzabfragen im Test

// ── Testordner bauen ────────────────────────────────────────────────────────
// Dateien müssen über 1 MB sein, sonst gelten sie als Reste (MIN_VIDEO_MB).
const GROSS = Buffer.alloc(1_200_000, 7);
const KLEIN = Buffer.alloc(1000, 7);

const staffel = join(MEDIEN, "Testserie", "Season 01");
mkdirSync(staffel, { recursive: true });
const E01 = join(staffel, "Testserie - S01E01 - Anfang.mkv");
const E02 = join(staffel, "Testserie - S01E02 - Mitte.mkv");
const E03 = join(staffel, "Testserie - S01E03 - Ende.mkv");
const SCHNIPSEL = join(staffel, "Testserie - S01E01 - sample.mkv");
const WINZIG = join(staffel, "Testserie - S01E04 - Rest.mkv");
writeFileSync(E01, GROSS);
writeFileSync(E02, GROSS);
writeFileSync(E03, GROSS);
writeFileSync(SCHNIPSEL, GROSS);
writeFileSync(WINZIG, KLEIN);

const ow = await import("../src/ordnerwahl.js");
const { openDb } = await import("../src/db.js");
const { scanLibrary } = await import("../src/scanner.js");

// ── Durchsuchen ─────────────────────────────────────────────────────────────
console.log("\n── Ordner durchsuchen ──────────────────────────────────────");
let vorschau;
{
  vorschau = ow.preview(MEDIEN);
  const pfade = vorschau.hits.map((h) => h.path);
  pruefe("die drei echten Folgen werden gefunden", vorschau.hits.length === 3);
  pruefe("E01 ist dabei", pfade.includes(E01));
  pruefe("der sample-Schnipsel wird übersprungen", !pfade.includes(SCHNIPSEL));
  pruefe("die Winzdatei wird übersprungen", !pfade.includes(WINZIG));
  pruefe("und die Zahl der Übersprungenen wird gemeldet", vorschau.skipped === 2);
  pruefe("nichts wurde abgeschnitten", vorschau.truncated === false);

  const e1 = vorschau.hits.find((h) => h.path === E01);
  pruefe("Staffel und Folge werden erkannt", e1.kind === "episode" && e1.season === 1 && e1.episode === 1);
  pruefe("der Serientitel kommt aus dem Ordner", e1.title.toLowerCase().includes("testserie"));
  pruefe("die Dateigröße stimmt", e1.sizeBytes === GROSS.length);
  pruefe("noch nichts ist in der Bibliothek", vorschau.hits.every((h) => !h.inLibrary));
  pruefe("und nichts ist abgelehnt", vorschau.hits.every((h) => !h.ignored));

  pruefe("die Vorschaubild-Freigabe gilt für die Funde", ow.istVorschauDatei(E01));
  pruefe("aber nicht für beliebige Pfade", !ow.istVorschauDatei(join(DATEN, "fremd.mkv")));
}

// ── Pfadschutz ──────────────────────────────────────────────────────────────
console.log("\n── Pfadschutz ──────────────────────────────────────────────");
{
  let abgelehnt = false;
  try {
    ow.preview(tmpdir()); // liegt über BROWSE_ROOTS
  } catch (e) {
    abgelehnt = /außerhalb|nicht sichtbar/i.test(String(e.message || e));
  }
  pruefe("ein Ordner außerhalb der erlaubten Wurzeln wird abgewiesen", abgelehnt);
}

// ── Auswahl übernehmen ──────────────────────────────────────────────────────
console.log("\n── Auswahl übernehmen ──────────────────────────────────────");
{
  const ergebnis = ow.apply({ root: MEDIEN, kind: "tv", accept: [E01, E02], reject: [E03] });
  pruefe("zwei übernommen, einer abgelehnt", ergebnis.accepted === 2 && ergebnis.rejected === 1);
  pruefe("der Ordner wurde als Bibliothek angelegt", ergebnis.libraryCreated === true && ergebnis.libraryId > 0);
  pruefe("die Ablehnung steht in der Ignorierliste", ow.listIgnored().length === 1);
  pruefe("und zwar die richtige Datei", ow.listIgnored()[0] === ow.norm(E03));
}

// ── DER EIGENTLICHE REGRESSIONSTEST ─────────────────────────────────────────
console.log("\n── Hält die Ablehnung einen echten Scan aus? ───────────────");
{
  await scanLibrary();
  const d = openDb();
  const folgen = d.prepare("SELECT path FROM episodes").all().map((r) => r.path);

  pruefe("die bestätigten Folgen sind in der Bibliothek", folgen.includes(E01) && folgen.includes(E02));
  /* Ohne die Prüfung in walkVideos() stünde E03 hier drin — die Ablehnung
     wäre beim ersten automatischen Scan wieder aufgehoben gewesen. */
  pruefe("die ABGELEHNTE Folge ist NICHT drin", !folgen.includes(E03));
  pruefe("der Schnipsel ist auch nicht drin", !folgen.includes(SCHNIPSEL));

  const zweite = ow.preview(MEDIEN);
  const e1 = zweite.hits.find((h) => h.path === E01);
  const e3 = zweite.hits.find((h) => h.path === E03);
  pruefe("die Vorschau erkennt jetzt „bereits in der Bibliothek“", e1.inLibrary === true);
  pruefe("und markiert die abgelehnte Datei als abgelehnt", e3.ignored === true && e3.inLibrary === false);
}

// ── Ablehnung zurücknehmen ──────────────────────────────────────────────────
console.log("\n── Ablehnung zurücknehmen ──────────────────────────────────");
{
  const n = ow.unignore([E03]);
  pruefe("die Ablehnung wird zurückgenommen", n === 1 && ow.listIgnored().length === 0);

  await scanLibrary();
  const d = openDb();
  const folgen = d.prepare("SELECT path FROM episodes").all().map((r) => r.path);
  pruefe("beim nächsten Scan ist die Folge wieder da", folgen.includes(E03));
}

// ── Bestätigen hebt eine frühere Ablehnung auf ──────────────────────────────
console.log("\n── Bestätigen schlägt eine alte Ablehnung ──────────────────");
{
  ow.apply({ root: MEDIEN, kind: "tv", accept: [], reject: [E02] });
  pruefe("E02 ist abgelehnt", ow.listIgnored().includes(ow.norm(E02)));
  ow.apply({ root: MEDIEN, kind: "tv", accept: [E02], reject: [] });
  pruefe("nach dem Bestätigen ist die Ablehnung weg", !ow.listIgnored().includes(ow.norm(E02)));
}

console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);

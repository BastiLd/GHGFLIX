/**
 * Tests fuer nichtssagende Ordnernamen (gemeldet am 01.08.2026).
 *
 * DER ECHTE FALL
 * --------------
 *   Websites Download\miraculous to\Downloads\Staffel 1\101 - Stormy Weather.mp4
 *
 * Als Bibliothek war "...\miraculous to" eingetragen. Der Serienordner heisst
 * damit "Downloads" — und genau so stand die Serie dann in der Bibliothek:
 * "Downloads", 4 Staffeln, 90 Folgen, "NICHT ERKANNT". TMDb kennt keine Serie
 * namens Downloads, also blieb sie fuer immer ohne Poster und Beschreibung.
 *
 * Der bedeutungsvolle Name steht eine Ebene HOEHER ("miraculous to"), und das
 * angehaengte "to" ist die Domainendung von miraculous.to, nicht Teil des
 * Titels. Beides wird hier geprueft — einmal die Regel fuer sich und einmal
 * mit echtem Scan gegen echte Dateien.
 *
 * Aufruf:
 *   cd server
 *   node test/ordnernamen.test.mjs
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

const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-ordner-namen-"));
process.env.DATA_DIR = DATEN;
process.env.BROWSE_ROOTS = DATEN;
process.env.TMDB_API_KEY = "";

const { isGenericDir, stripDomainSuffix, parseEpisode } = await import("../src/parser.js");

// ── Die Regeln fuer sich ────────────────────────────────────────────────────
console.log("\n── Welche Ordnernamen sagen nichts aus? ────────────────────");
{
  for (const n of ["Downloads", "downloads", "Videos", "Neuer Ordner", "New Folder", "temp", "Downloads (2)", "Neuer Ordner 3"]) {
    pruefe(`"${n}" gilt als nichtssagend`, isGenericDir(n));
  }
  // Gegenprobe — ohne die wuerde die Regel echte Serien schlucken.
  for (const n of ["Miraculous", "Breaking Bad", "Downton Abbey", "Film Noir Collection", "Serienstar"]) {
    pruefe(`"${n}" bleibt ein echter Titel`, !isGenericDir(n));
  }
}

console.log("\n── Domainendung im Ordnernamen ─────────────────────────────");
{
  pruefe('"miraculous to" wird zu "miraculous"', stripDomainSuffix("miraculous to") === "miraculous");
  pruefe('"kinox to" wird zu "kinox"', stripDomainSuffix("kinox to") === "kinox");
  pruefe('"Person of Interest" bleibt unveraendert', stripDomainSuffix("Person of Interest") === "Person of Interest");
  // Zu kurzer Rest darf nicht abgeschnitten werden, sonst bliebe nichts uebrig.
  pruefe('"Up to" bleibt unveraendert', stripDomainSuffix("Up to") === "Up to");
}

// ── Zusammengezogene Folgennummern ──────────────────────────────────────────
console.log("\n── Folgennummer wie \"101\" in \"Staffel 1\" ───────────────────");
{
  const se = (stem, dir) => {
    const r = parseEpisode(stem, dir);
    return r ? `S${r.season}E${r.episode}` : "nichts";
  };
  pruefe('"101 - Stormy Weather" in "Staffel 1" -> S1E1', se("101 - Stormy Weather", "Staffel 1") === "S1E1");
  pruefe('"125 - The Origins" in "Staffel 1" -> S1E25', se("125 - The Origins", "Staffel 1") === "S1E25");
  pruefe('"201 - The Collector" in "Staffel 2" -> S2E1', se("201 - The Collector", "Staffel 2") === "S2E1");
  pruefe('"612 - Letzte" in "Staffel 6" -> S6E12', se("612 - Letzte", "Staffel 6") === "S6E12");
  // Gegenproben: nur zerlegen, wenn die fuehrende Ziffer zur Staffel passt.
  pruefe('"250 - Titel" in "Staffel 1" bleibt Folge 250', se("250 - Titel", "Staffel 1") === "S1E250");
  pruefe('"07 - Titel" in "Staffel 1" bleibt Folge 7', se("07 - Titel", "Staffel 1") === "S1E7");
  pruefe('"100 - Titel" in "Staffel 1" bleibt Folge 100', se("100 - Titel", "Staffel 1") === "S1E100");
}

// ── DER EIGENTLICHE BEWEIS: echter Scan ─────────────────────────────────────
console.log("\n── Echter Scan mit der gemeldeten Ordnerform ───────────────");
{
  const GROSS = Buffer.alloc(1_200_000, 7);
  const wurzel = join(DATEN, "Websites Download", "miraculous to");
  const titel = {
    1: ["101 - Stormy Weather", "102 - The Bubbler", "103 - The Pharaoh"],
    2: ["201 - The Collector", "202 - Prime Queen"],
  };
  for (const [staffel, dateien] of Object.entries(titel)) {
    const ordner = join(wurzel, "Downloads", `Staffel ${staffel}`);
    mkdirSync(ordner, { recursive: true });
    for (const d of dateien) writeFileSync(join(ordner, `${d}.mp4`), GROSS);
  }

  const { openDb, addLibrary } = await import("../src/db.js");
  const { scanLibrary } = await import("../src/scanner.js");
  addLibrary(wurzel, "show", "miraculous to");
  await scanLibrary();

  const d = openDb();
  const serien = d.prepare("SELECT title FROM shows").all().map((r) => r.title);
  console.log("     gefundene Serien: " + JSON.stringify(serien));

  /* DAS ist der Regressionstest: vorher stand hier "Downloads". */
  pruefe('die Serie heisst NICHT mehr "Downloads"', !serien.some((t) => /^downloads$/i.test(t)));
  pruefe('sondern traegt den Titel aus dem Ordner darueber', serien.some((t) => /miraculous/i.test(t)));
  pruefe('und ohne die Domainendung "to"', !serien.some((t) => /^miraculous to$/i.test(t)));

  const folgen = d.prepare("SELECT season, episode FROM episodes ORDER BY season, episode").all();
  const gelesen = folgen.map((e) => `S${e.season}E${e.episode}`).join(", ");
  console.log("     gefundene Folgen: " + gelesen);
  pruefe("alle fuenf Dateien wurden aufgenommen", folgen.length === 5);
  pruefe("und in genau eine Serie einsortiert", d.prepare("SELECT COUNT(*) n FROM shows").get().n === 1);
  /* Vorher stand hier S1E101, S1E102, S1E103, S2E201, S2E202 — mit solchen
     Nummern findet TMDb nie einen Folgentitel. */
  pruefe("die Folgennummern sind richtig zerlegt", gelesen === "S1E1, S1E2, S1E3, S2E1, S2E2");
}

console.log(`\n${gut} Pruefungen bestanden, ${fehler.length} fehlgeschlagen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);

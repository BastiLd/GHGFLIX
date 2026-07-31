/**
 * Tests für den Versionsvergleich der App-Aktualisierung.
 *
 * Der Vergleich klingt trivial, ist aber die häufigste Fehlerquelle bei
 * Selbst-Updates: Ein Textvergleich hält "3.9.0" für neuer als "3.10.0",
 * weil "9" nach "1" kommt. Dann bietet die App ewig ein Update an, das
 * keines ist — oder schlimmer, sie bietet keines an, obwohl eines da ist.
 *
 * Aufruf:
 *   cd mobile
 *   node test/update.test.mjs
 */
import { vergleicheVersion } from "../src/update.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

console.log("\n── Einfache Fälle ──────────────────────────────────────────");
pruefe("3.1.0 ist neuer als 3.0.0", vergleicheVersion("3.1.0", "3.0.0") > 0);
pruefe("3.0.0 ist älter als 3.1.0", vergleicheVersion("3.0.0", "3.1.0") < 0);
pruefe("gleich ist gleich", vergleicheVersion("3.0.0", "3.0.0") === 0);
pruefe("Hauptversion zählt zuerst", vergleicheVersion("4.0.0", "3.99.99") > 0);
pruefe("letzte Stelle zählt auch", vergleicheVersion("3.0.2", "3.0.1") > 0);

console.log("\n── Die Falle: zweistellige Zahlen ──────────────────────────");
pruefe("3.10.0 ist neuer als 3.9.0  (Textvergleich läge falsch)",
  vergleicheVersion("3.10.0", "3.9.0") > 0);
pruefe("3.9.0 ist älter als 3.10.0", vergleicheVersion("3.9.0", "3.10.0") < 0);
pruefe("2.0.0 ist neuer als 1.99.99", vergleicheVersion("2.0.0", "1.99.99") > 0);
pruefe("10.0.0 ist neuer als 9.0.0", vergleicheVersion("10.0.0", "9.0.0") > 0);
pruefe("3.0.10 ist neuer als 3.0.9", vergleicheVersion("3.0.10", "3.0.9") > 0);

console.log("\n── Ungleiche Länge ─────────────────────────────────────────");
pruefe("3.1 und 3.1.0 sind gleich", vergleicheVersion("3.1", "3.1.0") === 0);
pruefe("3.1.1 ist neuer als 3.1", vergleicheVersion("3.1.1", "3.1") > 0);
pruefe("3 ist älter als 3.0.1", vergleicheVersion("3", "3.0.1") < 0);
pruefe("4 ist neuer als 3.9.9", vergleicheVersion("4", "3.9.9") > 0);

console.log("\n── Unsinnige Eingaben stürzen nicht ab ─────────────────────");
pruefe("leer gegen Version", vergleicheVersion("", "1.0.0") < 0);
pruefe("null gegen Version", vergleicheVersion(null, "1.0.0") < 0);
pruefe("beides leer ist gleich", vergleicheVersion("", "") === 0);
pruefe("Buchstaben werden als 0 gewertet", vergleicheVersion("abc", "0.0.0") === 0);
pruefe("Version mit Zusatz vergleicht die Zahlen", vergleicheVersion("3.1.0", "3.0.9") > 0);

console.log("\n── Der echte Ablauf ────────────────────────────────────────");
{
  // So, wie die App es benutzt: Server meldet eine Version, App vergleicht
  const faelle = [
    { server: "3.1.0", app: "3.0.0", anbieten: true,  was: "neuere Fassung liegt bereit" },
    { server: "3.0.0", app: "3.0.0", anbieten: false, was: "gleiche Fassung — nichts tun" },
    { server: "2.9.0", app: "3.0.0", anbieten: false, was: "ältere Fassung — nichts tun" },
    { server: "3.10.0", app: "3.9.0", anbieten: true, was: "zweistellig, trotzdem richtig" },
  ];
  for (const f of faelle) {
    const anbieten = vergleicheVersion(f.server, f.app) > 0;
    pruefe(`Server ${f.server} / App ${f.app}: ${f.was}`, anbieten === f.anbieten);
  }
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Update-Tests bestanden.`);

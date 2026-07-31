/**
 * Tests für die Untertitel-Anzeige.
 *
 * Untertitel sind eine der Stellen, an denen Fehler sofort auffallen: Ein um
 * eine Sekunde verschobener Zeitstempel oder ein verschluckter Block ist beim
 * Zuschauen unmittelbar störend. Deshalb wird hier genau geprüft, was zu
 * welchem Zeitpunkt angezeigt wird — inklusive der Lücken dazwischen.
 *
 * Aufruf:
 *   cd mobile
 *   node test/untertitel.test.mjs
 */
import { erzeugeSucher, vttLesen, vttZeit } from "../src/untertitel.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

console.log("\n── Zeitangaben lesen ───────────────────────────────────────");
pruefe("Stunden:Minuten:Sekunden.Millisekunden", vttZeit("00:01:02.500") === 62.5);
pruefe("ohne Stunden", vttZeit("01:02.500") === 62.5);
pruefe("mit Stunden über 9", vttZeit("12:34:56.789") === 45296.789);
pruefe("Komma statt Punkt (SRT-Rest)", vttZeit("00:00:01,250") === 1.25);
pruefe("Unsinn ergibt null", vttZeit("keine Zeit") === null);

console.log("\n── WebVTT zerlegen ─────────────────────────────────────────");
const vtt = `WEBVTT
Kind: captions
Language: de

NOTE
Dieser Block muss übersprungen werden.

1
00:00:01.000 --> 00:00:04.000
Guten Abend.

2
00:00:05.500 --> 00:00:08.000 line:90% align:middle
Zweite Zeile,
über zwei Zeilen.

3
00:00:10.000 --> 00:00:12.000
<i>Kursiv</i> und <b>fett</b>

4
00:00:12.000 --> 00:00:14.000
{\\an8}Oben stehend
`;
const stuecke = vttLesen(vtt);
pruefe(`vier Blöcke erkannt (${stuecke.length})`, stuecke.length === 4);
pruefe("NOTE wurde übersprungen", !stuecke.some((s) => s.text.includes("übersprungen")));
pruefe("Kopfzeilen wurden übersprungen", !stuecke.some((s) => s.text.includes("Language")));
pruefe("erste Zeit stimmt", stuecke[0]?.von === 1 && stuecke[0]?.bis === 4);
pruefe("erster Text stimmt", stuecke[0]?.text === "Guten Abend.");
pruefe("Ausrichtungsangaben stören die Zeit nicht",
  stuecke[1]?.von === 5.5 && stuecke[1]?.bis === 8);
pruefe("mehrzeiliger Text bleibt mehrzeilig", stuecke[1]?.text.includes("\n"));
pruefe("HTML-Auszeichnung ist entfernt", stuecke[2]?.text === "Kursiv und fett");
pruefe("ASS-Reste sind entfernt", stuecke[3]?.text === "Oben stehend");

console.log("\n── Was wird wann angezeigt? ────────────────────────────────");
{
  const s = erzeugeSucher(stuecke);
  pruefe("vor dem ersten Block: nichts", s.beiZeit(0.5) === null);
  pruefe("genau am Anfang: der erste Text", s.beiZeit(1.0) === "Guten Abend.");
  pruefe("mittendrin: derselbe Text", s.beiZeit(2.7) === "Guten Abend.");
  pruefe("am Ende (ausschließend): nichts mehr", s.beiZeit(4.0) === null);
  pruefe("in der Lücke: nichts", s.beiZeit(4.8) === null);
  pruefe("zweiter Block erscheint", s.beiZeit(6.0)?.startsWith("Zweite Zeile"));
  pruefe("nach dem letzten Block: nichts", s.beiZeit(99) === null);
}

console.log("\n── Springen im Film (vor und zurück) ───────────────────────");
{
  const s = erzeugeSucher(stuecke);
  s.beiZeit(2);                       // erst vorn
  pruefe("Sprung nach hinten findet den richtigen Block", s.beiZeit(11) === "Kursiv und fett");
  pruefe("Sprung zurück nach vorn ebenso", s.beiZeit(2) === "Guten Abend.");
  pruefe("Sprung mitten in eine Lücke ergibt nichts", s.beiZeit(9) === null);
  pruefe("und danach geht es normal weiter", s.beiZeit(6) !== null);
}

console.log("\n── Versatz (falls Untertitel zu früh oder spät kommen) ─────");
{
  const s = erzeugeSucher(stuecke);
  pruefe("ohne Versatz wie gehabt", s.beiZeit(2, 0) === "Guten Abend.");
  pruefe("2 Sekunden später verschoben", s.beiZeit(4, 2) === "Guten Abend.");
  pruefe("1 Sekunde früher verschoben", s.beiZeit(0.5, -1) === "Guten Abend.");
}

console.log("\n── Ein ganzer Film (Geschwindigkeit) ───────────────────────");
{
  // 1800 Untertitel über zwei Stunden — eine typische Serie oder ein Film
  const viele = Array.from({ length: 1800 }, (_, i) => ({
    von: i * 4, bis: i * 4 + 2.5, text: "Zeile " + i,
  }));
  const s = erzeugeSucher(viele);
  pruefe("mitten im Film wird richtig gefunden", s.beiZeit(3600) === "Zeile 900");
  pruefe("in der Lücke dazwischen nichts", s.beiZeit(3603) === null);

  // So oft, wie der Player in einem zweistündigen Film nachfragt (2×/Sekunde)
  const t0 = Date.now();
  let treffer = 0;
  for (let t = 0; t < 7200; t += 0.5) if (s.beiZeit(t)) treffer++;
  const dauer = Date.now() - t0;
  console.log(`     14 400 Abfragen in ${dauer} ms, ${treffer} Anzeigen`);
  pruefe(`ein ganzer Film in unter 100 ms (${dauer} ms)`, dauer < 100);
  pruefe("und die Trefferzahl stimmt (5 Abfragen je Block)", treffer === 1800 * 5);
}

console.log("\n── Randfälle ──────────────────────────────────────────────");
{
  pruefe("leerer Text ergibt leere Liste", vttLesen("").length === 0);
  pruefe("null ergibt leere Liste", vttLesen(null).length === 0);
  pruefe("nur die Kopfzeile ergibt leere Liste", vttLesen("WEBVTT\n\n").length === 0);
  const s = erzeugeSucher([]);
  pruefe("ein leerer Sucher stürzt nicht ab", s.beiZeit(5) === null);

  // Blöcke mit verdrehten Zeiten dürfen nicht ins Ergebnis
  const kaputt = vttLesen("WEBVTT\n\n00:00:05.000 --> 00:00:02.000\nRueckwaerts\n");
  pruefe("verdrehte Zeiten werden verworfen", kaputt.length === 0);

  // Byte-Order-Mark am Anfang (kommt bei Windows-Editoren vor)
  const mitBom = vttLesen("﻿WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMit BOM\n");
  pruefe("Byte-Order-Mark stört nicht", mitBom.length === 1 && mitBom[0].text === "Mit BOM");

  // Unsortierte Eingabe
  const unsortiert = vttLesen(
    "WEBVTT\n\n00:00:09.000 --> 00:00:10.000\nSpaet\n\n00:00:01.000 --> 00:00:02.000\nFrueh\n",
  );
  pruefe("unsortierte Blöcke werden sortiert",
    unsortiert[0]?.text === "Frueh" && unsortiert[1]?.text === "Spaet");
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Untertitel-Tests bestanden.`);

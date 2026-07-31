/**
 * Tests für den QR-Code-Erzeuger.
 *
 * Ein QR-Code ist heikel: Er sieht auch dann „richtig aus", wenn er
 * unlesbar ist — schwarze und weiße Kästchen erkennt das Auge nicht als
 * falsch. Ein Fehler fiele erst auf, wenn das Handy am Fernseher nichts
 * erkennt, und dann wäre die Ursache schwer zu finden.
 *
 * Deshalb wird hier nicht nur die Struktur geprüft, sondern der erzeugte
 * Code WIEDER AUSGELESEN: demaskieren, Bits im Zickzack zurücklesen,
 * entschachteln, die Reed-Solomon-Syndrome berechnen (die bei fehlerfreier
 * Kodierung alle null sein müssen) und den Text dekodieren. Kommt derselbe
 * Text heraus und sind die Syndrome null, ist der Code nach ISO/IEC 18004
 * korrekt — unabhängig davon, ob er „richtig aussieht".
 *
 * Aufruf:
 *   cd mobile
 *   node test/qr.test.mjs
 */
import { qrErzeugen } from "../src/qr.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/* ── Ein unabhängiger Nachbau der Rechenregeln zum Gegenprüfen ─────────── */
const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

const VERSIONEN = {
  1: [26, 10, 1, 16, 0, 0], 2: [44, 16, 1, 28, 0, 0], 3: [70, 26, 1, 44, 0, 0],
  4: [100, 18, 2, 32, 0, 0], 5: [134, 24, 2, 43, 0, 0], 6: [172, 16, 4, 27, 0, 0],
  7: [196, 18, 4, 31, 0, 0], 8: [242, 22, 2, 38, 2, 39], 9: [292, 22, 3, 36, 2, 37],
  10: [346, 26, 4, 43, 1, 44],
};
const AUSRICHTUNG = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Den fertigen Code wieder auslesen — der eigentliche Beweis. */
function qrLesen({ groesse: n, punkte: m, version, maske }) {
  const maskeGilt = (nr, z, s) => {
    switch (nr) {
      case 0: return (z + s) % 2 === 0;
      case 1: return z % 2 === 0;
      case 2: return s % 3 === 0;
      case 3: return (z + s) % 3 === 0;
      case 4: return (Math.floor(z / 2) + Math.floor(s / 3)) % 2 === 0;
      case 5: return ((z * s) % 2) + ((z * s) % 3) === 0;
      case 6: return (((z * s) % 2) + ((z * s) % 3)) % 2 === 0;
      case 7: return (((z + s) % 2) + ((z * s) % 3)) % 2 === 0;
      default: return false;
    }
  };

  // Welche Felder sind Funktionsmuster (also keine Daten)?
  const belegt = Array.from({ length: n }, () => new Array(n).fill(false));
  const merke = (z0, s0, h, b) => {
    for (let z = z0; z < z0 + h; z++)
      for (let s = s0; s < s0 + b; s++)
        if (z >= 0 && s >= 0 && z < n && s < n) belegt[z][s] = true;
  };
  merke(0, 0, 9, 9);
  merke(0, n - 8, 9, 8);
  merke(n - 8, 0, 8, 9);
  for (let i = 0; i < n; i++) { belegt[6][i] = true; belegt[i][6] = true; }
  const mitten = AUSRICHTUNG[version];
  for (const z of mitten) for (const s of mitten) {
    if ((z <= 8 && s <= 8) || (z <= 8 && s >= n - 9) || (z >= n - 9 && s <= 8)) continue;
    merke(z - 2, s - 2, 5, 5);
  }

  // Bits im Zickzack zurücklesen und dabei demaskieren
  const bits = [];
  let aufwaerts = true;
  for (let spalte = n - 1; spalte > 0; spalte -= 2) {
    if (spalte === 6) spalte--;
    for (let i = 0; i < n; i++) {
      const zeile = aufwaerts ? n - 1 - i : i;
      for (let d = 0; d < 2; d++) {
        const s = spalte - d;
        if (belegt[zeile][s]) continue;
        const wert = m[zeile][s];
        bits.push((maskeGilt(maske, zeile, s) ? !wert : wert) ? 1 : 0);
      }
    }
    aufwaerts = !aufwaerts;
  }

  const bytes = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    bytes.push(b);
  }

  // Entschachteln
  const [, ecJeBlock, b1, d1, b2, d2] = VERSIONEN[version];
  const bloecke = [];
  for (let i = 0; i < b1; i++) bloecke.push({ daten: [], ec: [], laenge: d1 });
  for (let i = 0; i < b2; i++) bloecke.push({ daten: [], ec: [], laenge: d2 });

  let p = 0;
  const maxDaten = Math.max(d1, d2);
  for (let i = 0; i < maxDaten; i++)
    for (const bl of bloecke) if (i < bl.laenge) bl.daten.push(bytes[p++]);
  for (let i = 0; i < ecJeBlock; i++)
    for (const bl of bloecke) bl.ec.push(bytes[p++]);

  // Reed-Solomon-Syndrome: bei fehlerfreier Kodierung alle null
  const syndromeNull = bloecke.every((bl) => {
    const voll = [...bl.daten, ...bl.ec];
    for (let i = 0; i < ecJeBlock; i++) {
      let s = 0;
      for (const b of voll) s = mul(s, EXP[i]) ^ b;
      if (s !== 0) return false;
    }
    return true;
  });

  // Nutzdaten dekodieren
  const alleDaten = [];
  for (const bl of bloecke) alleDaten.push(...bl.daten);
  const modus = alleDaten[0] >> 4;
  const laengeBits = version < 10 ? 8 : 16;
  let laenge;
  let ab;
  if (laengeBits === 8) {
    laenge = ((alleDaten[0] & 0x0f) << 4) | (alleDaten[1] >> 4);
    ab = 1;
  } else {
    laenge = ((alleDaten[0] & 0x0f) << 12) | (alleDaten[1] << 4) | (alleDaten[2] >> 4);
    ab = 2;
  }
  const nutz = [];
  for (let i = 0; i < laenge; i++) {
    const hoch = alleDaten[ab + i] & 0x0f;
    const tief = alleDaten[ab + i + 1] >> 4;
    nutz.push((hoch << 4) | tief);
  }
  const text = Buffer.from(nutz).toString("utf8");
  return { modus, laenge, text, syndromeNull };
}

/* ── Struktur ──────────────────────────────────────────────────────────── */
console.log("\n── Aufbau des Rasters ──────────────────────────────────────");
{
  const q = qrErzeugen("http://192.168.68.157:8484/koppeln?code=K7M2QX");
  pruefe("ein Code wird erzeugt", !!q);
  pruefe(`Größe passt zur Version (${q.groesse}×${q.groesse}, Version ${q.version})`,
    q.groesse === 17 + q.version * 4);
  pruefe("das Raster ist quadratisch",
    q.punkte.length === q.groesse && q.punkte.every((z) => z.length === q.groesse));
  pruefe("es enthält nur echte Wahrheitswerte",
    q.punkte.every((z) => z.every((w) => typeof w === "boolean")));

  // Suchmuster: 7×7 mit Rahmen und 3×3-Kern
  const suchmusterOk = (z0, s0) => {
    for (let z = 0; z < 7; z++)
      for (let s = 0; s < 7; s++) {
        const soll = z === 0 || z === 6 || s === 0 || s === 6 || (z >= 2 && z <= 4 && s >= 2 && s <= 4);
        if (q.punkte[z0 + z][s0 + s] !== soll) return false;
      }
    return true;
  };
  pruefe("Suchmuster oben links", suchmusterOk(0, 0));
  pruefe("Suchmuster oben rechts", suchmusterOk(0, q.groesse - 7));
  pruefe("Suchmuster unten links", suchmusterOk(q.groesse - 7, 0));

  // Zeitmuster: abwechselnd, beginnend mit schwarz
  let zeitOk = true;
  for (let i = 8; i < q.groesse - 8; i++) {
    if (q.punkte[6][i] !== (i % 2 === 0)) zeitOk = false;
    if (q.punkte[i][6] !== (i % 2 === 0)) zeitOk = false;
  }
  pruefe("Zeitmuster wechseln korrekt", zeitOk);
  pruefe("der immer schwarze Punkt sitzt richtig", q.punkte[q.groesse - 8][8] === true);

  const schwarz = q.punkte.flat().filter(Boolean).length;
  const anteil = Math.round((schwarz / (q.groesse * q.groesse)) * 100);
  console.log(`     Schwarzanteil: ${anteil} % (gut ist 40–60)`);
  pruefe(`der Schwarzanteil ist ausgewogen (${anteil} %)`, anteil >= 35 && anteil <= 65);
}

/* ── Der eigentliche Beweis: zurücklesen ───────────────────────────────── */
console.log("\n── Der Code lässt sich wieder auslesen ─────────────────────");
{
  const texte = [
    "A",
    "http://192.168.1.5:8484",
    "http://192.168.68.157:8484/koppeln?code=K7M2QX",
    "GHGFLIX:PAIR:K7M2QX:http://192.168.68.157:8484",
    "Grüße vom Fernseher — Umlaute und ein Gedankenstrich",
    "x".repeat(100),
  ];
  for (const t of texte) {
    const q = qrErzeugen(t);
    if (!q) { pruefe(`"${t.slice(0, 30)}" lässt sich kodieren`, false); continue; }
    const z = qrLesen(q);
    const kurz = t.length > 34 ? t.slice(0, 31) + "..." : t;
    pruefe(`"${kurz}" → Version ${q.version}, Fehlerkorrektur stimmt`, z.syndromeNull);
    pruefe(`"${kurz}" → derselbe Text kommt zurück`, z.text === t);
  }
}

/* ── Verschiedene Längen wählen die richtige Version ───────────────────── */
console.log("\n── Versionswahl nach Länge ─────────────────────────────────");
{
  const laengen = [5, 20, 40, 80, 120, 180];
  let letzteVersion = 0;
  let steigend = true;
  for (const l of laengen) {
    const q = qrErzeugen("x".repeat(l));
    if (!q) { pruefe(`${l} Zeichen passen noch`, false); continue; }
    if (q.version < letzteVersion) steigend = false;
    letzteVersion = q.version;
    const z = qrLesen(q);
    pruefe(`${String(l).padStart(3)} Zeichen → Version ${q.version}, wieder lesbar`,
      z.text === "x".repeat(l) && z.syndromeNull);
  }
  pruefe("längere Texte brauchen keine kleinere Version", steigend);
}

/* ── Randfälle ─────────────────────────────────────────────────────────── */
console.log("\n── Randfälle ──────────────────────────────────────────────");
{
  const leer = qrErzeugen("");
  pruefe("leerer Text ergibt trotzdem einen gültigen Code", !!leer && qrLesen(leer).syndromeNull);

  const zuLang = qrErzeugen("x".repeat(400));
  pruefe("zu langer Text ergibt null statt Unsinn", zuLang === null);

  const umlaute = qrErzeugen("äöüß ÄÖÜ €");
  pruefe("Umlaute und Euro-Zeichen überstehen es",
    !!umlaute && qrLesen(umlaute).text === "äöüß ÄÖÜ €");
}

/* ── Zwei Aufrufe ergeben dasselbe ─────────────────────────────────────── */
console.log("\n── Gleiche Eingabe, gleiches Ergebnis ──────────────────────");
{
  const a = qrErzeugen("http://192.168.68.157:8484/apk");
  const b = qrErzeugen("http://192.168.68.157:8484/apk");
  pruefe("zweimal derselbe Text ergibt dasselbe Raster",
    JSON.stringify(a.punkte) === JSON.stringify(b.punkte));
}

console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} QR-Tests bestanden.`);

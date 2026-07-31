/**
 * ══════════════════════════════════════════════════════════════════════════
 *  QR-CODE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Erzeugt QR-Codes nach ISO/IEC 18004 — ohne Zusatzbibliothek.
 *
 * WARUM SELBST GESCHRIEBEN
 * Die üblichen Pakete (react-native-qrcode-svg und Verwandte) bringen
 * react-native-svg mit, also ein natives Modul. Genau so ein Modul
 * (expo-asset) hat die Fernseh-App wochenlang beim Start abstürzen lassen,
 * weil es nur mittelbar installiert war. Ein QR-Code ist am Ende ein
 * Schwarz-Weiß-Raster — das lässt sich aus einfachen Rechtecken zeichnen,
 * die React Native ohnehin kann.
 *
 * WAS UNTERSTÜTZT WIRD
 * Byte-Modus mit Fehlerkorrektur der Stufe M (etwa 15 % Wiederherstellung),
 * Versionen 1 bis 10, also bis 213 Zeichen. Für Adressen wie
 * „http://192.168.68.157:8484/koppeln?code=K7M2QX" reicht das mit großem
 * Abstand — die sind selten länger als 60 Zeichen.
 *
 * AUFBAU (für alle, die es nachvollziehen wollen)
 *   1. Daten in Bits umwandeln (Modusanzeige, Länge, Nutzdaten, Füllbytes)
 *   2. Fehlerkorrekturbytes nach Reed-Solomon berechnen
 *   3. Daten- und Korrekturblöcke verschachteln
 *   4. Bits im Zickzack ins Raster schreiben
 *   5. Suchmuster, Ausrichtungsmuster und Zeitmuster setzen
 *   6. acht Masken durchprobieren und die mit der besten Bewertung nehmen
 */

/* ── Rechnen im Galois-Feld GF(256) ──────────────────────────────────────
 * Reed-Solomon rechnet nicht mit gewöhnlichen Zahlen, sondern in einem
 * endlichen Körper. Multiplikation wird dort zur Addition von Logarithmen,
 * deshalb werden beide Tabellen einmal vorberechnet.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;   // das Standardpolynom für QR-Codes
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * Erzeugerpolynom für n Korrekturbytes:  (x−α⁰)(x−α¹)…(x−αⁿ⁻¹)
 *
 * Die Koeffizienten stehen absteigend, poly[0] gehört also zum höchsten
 * Grad. Beim Multiplizieren mit (x + αⁱ) entstehen zwei Anteile:
 *
 *   x · poly    → der Koeffizient bleibt an seiner Stelle (Grad steigt)
 *   αⁱ · poly   → der Koeffizient rutscht eine Stelle nach rechts
 *
 * Diese beiden zu vertauschen ist der klassische Fehler an dieser Stelle:
 * Der Code sieht danach völlig normal aus und der Text lässt sich sogar
 * zurücklesen — nur die Fehlerkorrektur ist Unsinn, und ein echtes
 * Lesegerät verweigert ihn. Genau das ist hier beim ersten Versuch
 * passiert und wurde erst durch die Syndrom-Prüfung im Test sichtbar.
 */
function erzeugerPolynom(n) {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const neu = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      neu[j] ^= poly[j];                       // x · poly
      neu[j + 1] ^= gfMul(poly[j], EXP[i]);    // αⁱ · poly
    }
    poly = neu;
  }
  return poly;
}

/** Fehlerkorrekturbytes zu einem Datenblock. */
function korrekturBytes(daten, anzahl) {
  const poly = erzeugerPolynom(anzahl);
  const rest = new Array(daten.length + anzahl).fill(0);
  for (let i = 0; i < daten.length; i++) rest[i] = daten[i];
  for (let i = 0; i < daten.length; i++) {
    const f = rest[i];
    if (f === 0) continue;
    for (let j = 0; j < poly.length; j++) rest[i + j] ^= gfMul(poly[j], f);
  }
  return rest.slice(daten.length);
}

/* ── Kenndaten der Versionen (Fehlerkorrektur M) ─────────────────────────
 * Je Version: [Gesamtbytes, Korrekturbytes je Block, Blöcke Gruppe 1,
 *              Datenbytes je Block Gruppe 1, Blöcke Gruppe 2,
 *              Datenbytes je Block Gruppe 2]
 * Werte aus der Norm, Tabelle 9.
 */
const VERSIONEN = {
  1:  [26,   10, 1, 16,  0, 0],
  2:  [44,   16, 1, 28,  0, 0],
  3:  [70,   26, 1, 44,  0, 0],
  4:  [100,  18, 2, 32,  0, 0],
  5:  [134,  24, 2, 43,  0, 0],
  6:  [172,  16, 4, 27,  0, 0],
  7:  [196,  18, 4, 31,  0, 0],
  8:  [242,  22, 2, 38,  2, 39],
  9:  [292,  22, 3, 36,  2, 37],
  10: [346,  26, 4, 43,  1, 44],
};

/** Positionen der Ausrichtungsmuster je Version. */
const AUSRICHTUNG = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** Format-Bits für Stufe M, je Maske (bereits mit BCH-Korrektur). */
const FORMAT_M = [
  0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0,
];

/** Text nach UTF-8-Bytes. */
function utf8Bytes(text) {
  const s = String(text);
  const aus = [];
  for (let i = 0; i < s.length; i++) {
    let c = s.codePointAt(i);
    if (c > 0xffff) i++;
    if (c < 0x80) aus.push(c);
    else if (c < 0x800) aus.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) aus.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else aus.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return aus;
}

/** Kleinste Version, in die die Daten passen. */
function passendeVersion(byteZahl) {
  for (let v = 1; v <= 10; v++) {
    const [gesamt, ecJeBlock, b1, d1, b2, d2] = VERSIONEN[v];
    const datenBytes = b1 * d1 + b2 * d2;
    // 4 Bits Modus + 8 oder 16 Bits Länge
    const kopfBits = 4 + (v < 10 ? 8 : 16);
    if (byteZahl + Math.ceil(kopfBits / 8) <= datenBytes) return v;
  }
  return null;
}

/**
 * QR-Code erzeugen.
 *
 * @param {string} text
 * @returns {{groesse:number, punkte:boolean[][]}|null}
 *          punkte[zeile][spalte] — true bedeutet schwarz
 */
export function qrErzeugen(text) {
  const daten = utf8Bytes(text);
  const version = passendeVersion(daten.length);
  if (!version) return null;   // zu lang für Version 10

  const [, ecJeBlock, b1, d1, b2, d2] = VERSIONEN[version];
  const groesse = 17 + version * 4;

  /* ── 1) Bitfolge aufbauen ──────────────────────────────────────────── */
  const bits = [];
  const schreibe = (wert, laenge) => {
    for (let i = laenge - 1; i >= 0; i--) bits.push((wert >> i) & 1);
  };
  schreibe(0b0100, 4);                                  // Byte-Modus
  schreibe(daten.length, version < 10 ? 8 : 16);        // Länge
  for (const b of daten) schreibe(b, 8);

  const datenBytesGesamt = b1 * d1 + b2 * d2;
  const kapazitaet = datenBytesGesamt * 8;
  // Abschlusszeichen, höchstens vier Null-Bits
  for (let i = 0; i < 4 && bits.length < kapazitaet; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  // Auffüllen mit dem in der Norm festgelegten Wechselmuster
  const fueller = [0xec, 0x11];
  let f = 0;
  while (bits.length < kapazitaet) {
    schreibe(fueller[f++ % 2], 8);
  }

  const alleBytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    alleBytes.push(b);
  }

  /* ── 2) In Blöcke teilen und Korrekturbytes berechnen ──────────────── */
  const datenBloecke = [];
  const ecBloecke = [];
  let pos = 0;
  for (let i = 0; i < b1; i++) {
    const block = alleBytes.slice(pos, pos + d1);
    pos += d1;
    datenBloecke.push(block);
    ecBloecke.push(korrekturBytes(block, ecJeBlock));
  }
  for (let i = 0; i < b2; i++) {
    const block = alleBytes.slice(pos, pos + d2);
    pos += d2;
    datenBloecke.push(block);
    ecBloecke.push(korrekturBytes(block, ecJeBlock));
  }

  /* ── 3) Verschachteln ──────────────────────────────────────────────── */
  const endBytes = [];
  const maxDaten = Math.max(d1, d2);
  for (let i = 0; i < maxDaten; i++) {
    for (const block of datenBloecke) if (i < block.length) endBytes.push(block[i]);
  }
  for (let i = 0; i < ecJeBlock; i++) {
    for (const block of ecBloecke) endBytes.push(block[i]);
  }

  /* ── 4) Raster vorbereiten ─────────────────────────────────────────── */
  const raster = Array.from({ length: groesse }, () => new Array(groesse).fill(null));
  const belegt = Array.from({ length: groesse }, () => new Array(groesse).fill(false));

  const setzeFest = (z, s, wert) => {
    if (z < 0 || s < 0 || z >= groesse || s >= groesse) return;
    raster[z][s] = wert;
    belegt[z][s] = true;
  };

  // Suchmuster in den drei Ecken
  const suchmuster = (z0, s0) => {
    for (let z = -1; z <= 7; z++) {
      for (let s = -1; s <= 7; s++) {
        const drin = z >= 0 && z <= 6 && s >= 0 && s <= 6;
        const schwarz = drin && (
          z === 0 || z === 6 || s === 0 || s === 6 ||
          (z >= 2 && z <= 4 && s >= 2 && s <= 4)
        );
        setzeFest(z0 + z, s0 + s, schwarz);
      }
    }
  };
  suchmuster(0, 0);
  suchmuster(0, groesse - 7);
  suchmuster(groesse - 7, 0);

  // Zeitmuster
  for (let i = 8; i < groesse - 8; i++) {
    setzeFest(6, i, i % 2 === 0);
    setzeFest(i, 6, i % 2 === 0);
  }

  // Ausrichtungsmuster
  const mitten = AUSRICHTUNG[version];
  for (const z of mitten) {
    for (const s of mitten) {
      // nicht über die Suchmuster legen
      if ((z <= 8 && s <= 8) || (z <= 8 && s >= groesse - 9) || (z >= groesse - 9 && s <= 8)) continue;
      for (let dz = -2; dz <= 2; dz++) {
        for (let ds = -2; ds <= 2; ds++) {
          const schwarz = Math.max(Math.abs(dz), Math.abs(ds)) !== 1;
          setzeFest(z + dz, s + ds, schwarz);
        }
      }
    }
  }

  // Der immer schwarze Punkt
  setzeFest(groesse - 8, 8, true);

  // Plätze der Formatinformation freihalten
  for (let i = 0; i < 9; i++) {
    if (raster[8][i] === null) { belegt[8][i] = true; raster[8][i] = false; }
    if (raster[i][8] === null) { belegt[i][8] = true; raster[i][8] = false; }
  }
  for (let i = 0; i < 8; i++) {
    if (raster[8][groesse - 1 - i] === null) { belegt[8][groesse - 1 - i] = true; raster[8][groesse - 1 - i] = false; }
    if (raster[groesse - 1 - i][8] === null) { belegt[groesse - 1 - i][8] = true; raster[groesse - 1 - i][8] = false; }
  }

  /* ── 5) Daten im Zickzack einschreiben ─────────────────────────────── */
  let bitNr = 0;
  const gesamtBits = endBytes.length * 8;
  const holeBit = (n) => (n < gesamtBits ? (endBytes[n >> 3] >> (7 - (n & 7))) & 1 : 0);

  let aufwaerts = true;
  for (let spalte = groesse - 1; spalte > 0; spalte -= 2) {
    if (spalte === 6) spalte--;   // die Zeitmuster-Spalte wird übersprungen
    for (let i = 0; i < groesse; i++) {
      const zeile = aufwaerts ? groesse - 1 - i : i;
      for (let d = 0; d < 2; d++) {
        const s = spalte - d;
        if (belegt[zeile][s]) continue;
        raster[zeile][s] = holeBit(bitNr++) === 1;
        belegt[zeile][s] = true;
      }
    }
    aufwaerts = !aufwaerts;
  }

  /* ── 6) Masken durchprobieren ──────────────────────────────────────── */
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

  // Welche Felder gehören zu den Daten (dürfen maskiert werden)?
  const istDaten = Array.from({ length: groesse }, () => new Array(groesse).fill(true));
  {
    const merker = Array.from({ length: groesse }, () => new Array(groesse).fill(false));
    const merke = (z0, s0, h, b) => {
      for (let z = z0; z < z0 + h; z++)
        for (let s = s0; s < s0 + b; s++)
          if (z >= 0 && s >= 0 && z < groesse && s < groesse) merker[z][s] = true;
    };
    merke(0, 0, 9, 9);
    merke(0, groesse - 8, 9, 8);
    merke(groesse - 8, 0, 8, 9);
    for (let i = 0; i < groesse; i++) { merker[6][i] = true; merker[i][6] = true; }
    for (const z of mitten) for (const s of mitten) {
      if ((z <= 8 && s <= 8) || (z <= 8 && s >= groesse - 9) || (z >= groesse - 9 && s <= 8)) continue;
      merke(z - 2, s - 2, 5, 5);
    }
    for (let z = 0; z < groesse; z++)
      for (let s = 0; s < groesse; s++)
        istDaten[z][s] = !merker[z][s];
  }

  let besteMaske = 0;
  let besteBewertung = Infinity;
  let bestesRaster = null;

  for (let maske = 0; maske < 8; maske++) {
    const versuch = raster.map((zeile, z) =>
      zeile.map((wert, s) => (istDaten[z][s] && maskeGilt(maske, z, s) ? !wert : !!wert)),
    );
    // Formatinformation eintragen
    const format = FORMAT_M[maske];
    for (let i = 0; i < 15; i++) {
      const bit = ((format >> i) & 1) === 1;
      // senkrecht links oben und waagerecht
      if (i < 6) versuch[i][8] = bit;
      else if (i === 6) versuch[7][8] = bit;
      else if (i === 7) versuch[8][8] = bit;
      else if (i === 8) versuch[8][7] = bit;
      else versuch[8][14 - i] = bit;

      if (i < 8) versuch[8][groesse - 1 - i] = bit;
      else versuch[groesse - 15 + i][8] = bit;
    }
    versuch[groesse - 8][8] = true;

    const b = bewerte(versuch, groesse);
    if (b < besteBewertung) {
      besteBewertung = b;
      besteMaske = maske;
      bestesRaster = versuch;
    }
  }

  return { groesse, punkte: bestesRaster, version, maske: besteMaske };
}

/**
 * Bewertung nach der Norm: je niedriger, desto besser lesbar.
 * Bestraft werden lange gleichfarbige Reihen, gleichfarbige Blöcke,
 * Muster, die dem Suchmuster ähneln, und ein unausgewogenes
 * Schwarz-Weiß-Verhältnis.
 */
function bewerte(m, n) {
  let punkte = 0;

  // Regel 1: fünf oder mehr gleiche in Reihe
  for (let z = 0; z < n; z++) {
    let lauf = 1;
    for (let s = 1; s < n; s++) {
      if (m[z][s] === m[z][s - 1]) lauf++;
      else { if (lauf >= 5) punkte += 3 + (lauf - 5); lauf = 1; }
    }
    if (lauf >= 5) punkte += 3 + (lauf - 5);
  }
  for (let s = 0; s < n; s++) {
    let lauf = 1;
    for (let z = 1; z < n; z++) {
      if (m[z][s] === m[z - 1][s]) lauf++;
      else { if (lauf >= 5) punkte += 3 + (lauf - 5); lauf = 1; }
    }
    if (lauf >= 5) punkte += 3 + (lauf - 5);
  }

  // Regel 2: gleichfarbige 2×2-Blöcke
  for (let z = 0; z < n - 1; z++)
    for (let s = 0; s < n - 1; s++)
      if (m[z][s] === m[z][s + 1] && m[z][s] === m[z + 1][s] && m[z][s] === m[z + 1][s + 1])
        punkte += 3;

  // Regel 3: Muster, die dem Suchmuster ähneln
  const muster1 = [true, false, true, true, true, false, true, false, false, false, false];
  const muster2 = [false, false, false, false, true, false, true, true, true, false, true];
  const passt = (hole, start, muster) => muster.every((w, i) => hole(start + i) === w);
  for (let z = 0; z < n; z++)
    for (let s = 0; s <= n - 11; s++) {
      const hole = (i) => m[z][i];
      if (passt(hole, s, muster1) || passt(hole, s, muster2)) punkte += 40;
    }
  for (let s = 0; s < n; s++)
    for (let z = 0; z <= n - 11; z++) {
      const hole = (i) => m[i][s];
      if (passt(hole, z, muster1) || passt(hole, z, muster2)) punkte += 40;
    }

  // Regel 4: Verhältnis Schwarz zu Weiß
  let schwarz = 0;
  for (let z = 0; z < n; z++) for (let s = 0; s < n; s++) if (m[z][s]) schwarz++;
  const anteil = (schwarz * 100) / (n * n);
  punkte += Math.floor(Math.abs(anteil - 50) / 5) * 10;

  return punkte;
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  UNTERTITEL
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Der Server liefert Untertitel als WebVTT-Text (siehe server/src/spuren.js).
 * Diese Datei zerlegt ihn und sagt zu jedem Zeitpunkt, was gerade angezeigt
 * werden soll.
 *
 * WARUM SELBST ZEICHNEN STATT EINBRENNEN
 * ffmpeg könnte die Untertitel ins Bild rendern. Das erzwingt aber eine
 * Neukodierung des Videos (Last auf dem NAS), jedes Umschalten dauert
 * Sekunden, und Größe und Farbe wären festgelegt. Als Text kosten sie
 * praktisch nichts, schalten sofort um — und lassen sich einstellen, was
 * am Fernseher aus drei Metern Entfernung den Unterschied macht.
 *
 * ZUR SUCHE
 * Ein Film hat schnell 1500 Untertitel. Bei zwei Bildaktualisierungen pro
 * Sekunde alle durchzugehen wäre Verschwendung, deshalb wird binär gesucht
 * (halbieren statt durchlaufen) und die zuletzt gefundene Stelle gemerkt —
 * beim Abspielen ist der nächste Treffer fast immer derselbe oder der
 * direkt folgende.
 */

/** "00:01:02.500" oder "01:02.500" -> Sekunden */
export function vttZeit(text) {
  const m = String(text).trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!m) return null;
  const [, h, min, sek, ms] = m;
  return (
    (h ? parseInt(h, 10) * 3600 : 0) +
    parseInt(min, 10) * 60 +
    parseInt(sek, 10) +
    parseInt(ms.padEnd(3, "0"), 10) / 1000
  );
}

/**
 * WebVTT zerlegen.
 * @returns {{von:number, bis:number, text:string}[]} nach Startzeit sortiert
 */
export function vttLesen(roh) {
  if (!roh) return [];
  const zeilen = String(roh)
    .replace(/^﻿/, "")          // Byte-Order-Mark am Dateianfang
    .replace(/\r\n?/g, "\n")
    .split("\n");

  const stuecke = [];
  let i = 0;
  // Kopfzeile "WEBVTT" samt allem bis zur ersten Leerzeile überspringen
  if (/^WEBVTT/.test(zeilen[0] || "")) {
    while (i < zeilen.length && zeilen[i].trim() !== "") i++;
  }

  while (i < zeilen.length) {
    const zeile = zeilen[i];
    if (!zeile.includes("-->")) {
      // NOTE- und STYLE-Blöcke ganz überspringen
      if (/^(NOTE|STYLE|REGION)\b/.test(zeile.trim())) {
        while (i < zeilen.length && zeilen[i].trim() !== "") i++;
      }
      i++;
      continue;
    }
    const [linksRoh, rechtsRoh] = zeile.split("-->");
    const von = vttZeit(linksRoh);
    // rechts können Ausrichtungsangaben stehen: "00:00:04.000 line:90% align:middle"
    const bis = vttZeit(String(rechtsRoh).trim().split(/\s+/)[0]);
    i++;
    const text = [];
    while (i < zeilen.length && zeilen[i].trim() !== "") {
      text.push(zeilen[i]);
      i++;
    }
    if (von != null && bis != null && bis > von) {
      stuecke.push({ von, bis, text: saeubern(text.join("\n")) });
    }
  }
  stuecke.sort((a, b) => a.von - b.von);
  return stuecke;
}

/**
 * Auszeichnungen entfernen, die sich nicht sinnvoll darstellen lassen.
 * <i>, <b> und Sprecher-Marken wie <v Anna> kommen häufig vor; sie als
 * rohen Text stehen zu lassen wäre störender als sie wegzulassen.
 */
function saeubern(t) {
  return String(t)
    .replace(/<[^>]*>/g, "")
    .replace(/\{\\[^}]*\}/g, "")   // ASS-Reste wie {\an8}
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();
}

/**
 * Sucher, der sich die letzte Fundstelle merkt.
 *
 * @param {{von:number,bis:number,text:string}[]} stuecke
 */
export function erzeugeSucher(stuecke) {
  let letzter = 0;

  /** @returns {string|null} der Text zum Zeitpunkt, oder null */
  function beiZeit(t, versatz = 0) {
    const zeit = t - versatz;
    if (!stuecke.length) return null;

    // Zuerst dort nachsehen, wo zuletzt etwas war — beim Abspielen ist das
    // fast immer richtig und spart die Suche.
    for (let k = letzter; k < Math.min(letzter + 3, stuecke.length); k++) {
      const s = stuecke[k];
      if (zeit >= s.von && zeit < s.bis) { letzter = k; return s.text; }
      if (zeit < s.von) break;
    }

    // Sonst halbierend suchen: das letzte Stück finden, das vor `zeit` beginnt
    let links = 0, rechts = stuecke.length - 1, treffer = -1;
    while (links <= rechts) {
      const mitte = (links + rechts) >> 1;
      if (stuecke[mitte].von <= zeit) { treffer = mitte; links = mitte + 1; }
      else rechts = mitte - 1;
    }
    if (treffer < 0) return null;
    letzter = treffer;
    const s = stuecke[treffer];
    return zeit < s.bis ? s.text : null;
  }

  return { beiZeit, anzahl: stuecke.length };
}

/** Untertitel vom Server holen und aufbereiten. */
export async function untertitelHolen(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const roh = await res.text();
    const stuecke = vttLesen(roh);
    if (!stuecke.length) return null;
    return erzeugeSucher(stuecke);
  } catch {
    return null;
  }
}

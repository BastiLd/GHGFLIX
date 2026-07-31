/**
 * ══════════════════════════════════════════════════════════════════════════
 *  TON- UND UNTERTITELSPUREN
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Eine Filmdatei enthält meist mehr als eine Tonspur (deutsch, englisch,
 * Kommentar) und mehrere Untertitel. Bisher nahm der Server immer die erste
 * Tonspur und ignorierte Untertitel vollständig — bei einer Serie mit
 * englischer Erstspur lief also alles auf Englisch, ohne Umschaltmöglichkeit.
 *
 * Diese Datei kümmert sich um beides:
 *
 *   1. SPUREN FINDEN     ffprobe listet alles auf, was in der Datei steckt
 *   2. EXTERNE DATEIEN   film.de.srt neben film.mkv ist gängige Praxis
 *                        (Plex und Jellyfin machen das genauso)
 *   3. WEBVTT LIEFERN    Untertitel werden nach WebVTT umgewandelt und als
 *                        Text ausgeliefert, damit die App sie selbst zeichnen
 *                        kann — inklusive einstellbarer Größe und Farbe
 *
 * WARUM UNTERTITEL NICHT EINGEBRANNT WERDEN
 * ffmpeg kann Untertitel ins Bild rendern. Das hat aber drei Nachteile: Es
 * erzwingt eine Neukodierung des Videos (Last auf dem NAS), das Umschalten
 * dauert jedes Mal mehrere Sekunden, und Größe und Farbe sind festgelegt.
 * Als Text ausgeliefert kosten sie praktisch nichts, schalten sofort um und
 * lassen sich frei gestalten.
 *
 * Ausnahme sind BILD-Untertitel (PGS auf Blu-ray, VOBSUB auf DVD): Die
 * enthalten keinen Text, sondern Grafiken. Sie werden erkannt und als „nur
 * mit Einbrennen" gemeldet, damit die App sie nicht anbietet, statt eine
 * leere Anzeige zu erzeugen.
 */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

/** Untertitelformate, die Text enthalten (und damit nach WebVTT wandelbar sind). */
const TEXT_FORMATE = new Set([
  "subrip", "srt", "ass", "ssa", "webvtt", "vtt", "mov_text", "text", "subviewer", "microdvd",
]);
/** Bild-Untertitel: enthalten Grafiken, kein Text. */
const BILD_FORMATE = new Set(["hdmv_pgs_subtitle", "pgssub", "dvd_subtitle", "dvdsub", "xsub"]);

/** Dateiendungen externer Untertitel. */
const EXTERN_ENDUNGEN = [".srt", ".vtt", ".ass", ".ssa", ".sub"];

/* ── Sprachnamen ─────────────────────────────────────────────────────────
 * ffprobe liefert Kürzel nach ISO-639-2 ("ger", "eng"). Die sind für Nutzer
 * unbrauchbar, deshalb hier die im Heimgebrauch üblichen ausgeschrieben.
 */
const SPRACHEN = {
  ger: "Deutsch", deu: "Deutsch", de: "Deutsch",
  eng: "Englisch", en: "Englisch",
  fre: "Französisch", fra: "Französisch", fr: "Französisch",
  spa: "Spanisch", es: "Spanisch",
  ita: "Italienisch", it: "Italienisch",
  jpn: "Japanisch", ja: "Japanisch",
  kor: "Koreanisch", ko: "Koreanisch",
  chi: "Chinesisch", zho: "Chinesisch", zh: "Chinesisch",
  rus: "Russisch", ru: "Russisch",
  pol: "Polnisch", pl: "Polnisch",
  ned: "Niederländisch", nld: "Niederländisch", dut: "Niederländisch", nl: "Niederländisch",
  tur: "Türkisch", tr: "Türkisch",
  por: "Portugiesisch", pt: "Portugiesisch",
  ara: "Arabisch", ar: "Arabisch",
  cze: "Tschechisch", ces: "Tschechisch",
  hun: "Ungarisch", dan: "Dänisch", swe: "Schwedisch", nor: "Norwegisch",
  fin: "Finnisch", gre: "Griechisch", ell: "Griechisch", heb: "Hebräisch",
  hin: "Hindi", tha: "Thai", ukr: "Ukrainisch", vie: "Vietnamesisch",
  und: "unbekannt", mul: "mehrsprachig",
};

export function spracheName(kuerzel) {
  if (!kuerzel) return null;
  const k = String(kuerzel).toLowerCase().trim();
  return SPRACHEN[k] || k.toUpperCase();
}

/**
 * Einen gut lesbaren Namen für eine Spur bauen.
 * Aus lang="ger", title="Kommentar", channels=6 wird "Deutsch · Kommentar · 5.1"
 */
function spurName(s, art) {
  const teile = [];
  const sprache = spracheName(s.tags?.language);
  if (sprache) teile.push(sprache);
  if (s.tags?.title) teile.push(s.tags.title);
  if (art === "audio") {
    if (s.channels === 6) teile.push("5.1");
    else if (s.channels === 8) teile.push("7.1");
    else if (s.channels === 2) teile.push("Stereo");
    else if (s.channels === 1) teile.push("Mono");
    if (s.codec_name) teile.push(String(s.codec_name).toUpperCase());
  }
  if (s.disposition?.forced) teile.push("erzwungen");
  if (s.disposition?.hearing_impaired) teile.push("für Hörgeschädigte");
  return teile.length ? teile.join(" · ") : (art === "audio" ? "Tonspur" : "Untertitel");
}

/**
 * Alle Spuren einer Datei ermitteln.
 *
 * @returns {Promise<{audio: object[], sub: object[]}>}
 */
export function spurenLesen(pfad) {
  return new Promise((fertig) => {
    const p = spawn(FFPROBE, [
      "-v", "quiet", "-print_format", "json", "-show_streams", pfad,
    ]);
    let aus = "";
    p.stdout.on("data", (d) => (aus += d));
    p.on("error", () => fertig({ audio: [], sub: [] }));
    p.on("close", () => {
      try {
        const j = JSON.parse(aus);
        const alle = j.streams || [];
        const audio = alle
          .filter((s) => s.codec_type === "audio")
          .map((s, i) => ({
            nr: i,                       // fortlaufend je Art (für ffmpeg -map 0:a:N)
            id: `a${i}`,
            name: spurName(s, "audio"),
            sprache: s.tags?.language ?? null,
            codec: s.codec_name ?? null,
            kanaele: s.channels ?? null,
            standard: !!s.disposition?.default,
          }));
        const sub = alle
          .filter((s) => s.codec_type === "subtitle")
          .map((s, i) => {
            const codec = String(s.codec_name || "").toLowerCase();
            return {
              nr: i,
              id: `s${i}`,
              name: spurName(s, "sub"),
              sprache: s.tags?.language ?? null,
              codec,
              text: TEXT_FORMATE.has(codec),
              bild: BILD_FORMATE.has(codec),
              erzwungen: !!s.disposition?.forced,
              standard: !!s.disposition?.default,
              quelle: "eingebettet",
            };
          });
        fertig({ audio, sub });
      } catch {
        fertig({ audio: [], sub: [] });
      }
    });
  });
}

/**
 * Untertiteldateien neben dem Video finden.
 *
 * Üblich sind:
 *   Film.mkv  +  Film.srt
 *   Film.mkv  +  Film.de.srt / Film.ger.srt / Film.German.srt
 *   Film.mkv  +  Film.de.forced.srt
 * Auch ein Unterordner „Subs" wird berücksichtigt, wie ihn manche
 * Sammlungen anlegen.
 */
export function externeUntertitel(videoPfad) {
  const ordner = dirname(videoPfad);
  const stamm = basename(videoPfad, extname(videoPfad)).toLowerCase();
  const treffer = [];

  const durchsuche = (verzeichnis, tiefe = 0) => {
    let eintraege;
    try { eintraege = readdirSync(verzeichnis, { withFileTypes: true }); } catch { return; }
    for (const e of eintraege) {
      const voll = join(verzeichnis, e.name);
      if (e.isDirectory()) {
        // Nur einen Unterordner tief, und nur wenn er nach Untertiteln klingt
        if (tiefe === 0 && /^(subs?|subtitles?|untertitel)$/i.test(e.name)) durchsuche(voll, 1);
        continue;
      }
      const endung = extname(e.name).toLowerCase();
      if (!EXTERN_ENDUNGEN.includes(endung)) continue;
      const name = basename(e.name, endung).toLowerCase();
      // Im Unterordner passt jeder Name, daneben muss der Stamm übereinstimmen
      if (tiefe === 0 && !name.startsWith(stamm)) continue;

      // Sprache aus dem Namensrest lesen: "film.de.forced" -> de, forced
      const rest = tiefe === 0 ? name.slice(stamm.length).replace(/^[.\-_ ]+/, "") : name;
      const stuecke = rest.split(/[.\-_ ]+/).filter(Boolean);
      const erzwungen = stuecke.some((s) => /^(forced|forciert|erzwungen)$/i.test(s));
      const sdh = stuecke.some((s) => /^(sdh|cc|hi)$/i.test(s));
      const sprachStueck = stuecke.find((s) => s.length >= 2 && s.length <= 3 && SPRACHEN[s.toLowerCase()])
        || stuecke.find((s) => /^(german|deutsch|english|englisch)$/i.test(s));
      let sprache = sprachStueck ? sprachStueck.toLowerCase() : null;
      if (sprache === "german" || sprache === "deutsch") sprache = "ger";
      if (sprache === "english" || sprache === "englisch") sprache = "eng";

      const teile = [spracheName(sprache) || "Untertitel"];
      if (erzwungen) teile.push("erzwungen");
      if (sdh) teile.push("für Hörgeschädigte");
      teile.push("Datei");

      treffer.push({
        id: "d" + treffer.length,
        name: teile.join(" · "),
        sprache,
        codec: endung.slice(1),
        text: true,
        bild: false,
        erzwungen,
        quelle: "datei",
        datei: voll,
      });
    }
  };

  durchsuche(ordner);
  return treffer;
}

/* ══ Umwandlung nach WebVTT ═══════════════════════════════════════════════ */

/** Zeitangabe von SRT (00:01:02,500) nach WebVTT (00:01:02.500). */
const zeitVtt = (s) => s.replace(",", ".");

/**
 * SRT-Text nach WebVTT wandeln.
 *
 * Bewusst von Hand statt über ffmpeg: Der Aufruf eines Unterprozesses für
 * eine 60-KB-Textdatei ist Verschwendung, und ffmpeg verschluckt bei
 * fehlerhaften Zeitstempeln gern die halbe Datei, statt sie durchzureichen.
 */
export function srtNachVtt(text) {
  const zeilen = String(text).replace(/\r\n?/g, "\n").split("\n");
  const aus = ["WEBVTT", ""];
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    // reine Nummernzeile überspringen (SRT-Zähler)
    if (/^\d+$/.test(z.trim()) && /-->/.test(zeilen[i + 1] || "")) continue;
    if (z.includes("-->")) {
      aus.push(z.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, (_, a, b) => `${a}.${b}`).trim());
      continue;
    }
    aus.push(z);
  }
  return aus.join("\n");
}

/** Bereits WebVTT? Dann unverändert lassen. */
const istVtt = (t) => /^﻿?WEBVTT/.test(String(t).trimStart());

/**
 * Eine Untertiteldatei einlesen und als WebVTT zurückgeben.
 * ASS/SSA werden über ffmpeg gewandelt, weil deren Format zu eigen ist,
 * um es hier von Hand zu zerlegen.
 */
export async function dateiAlsVtt(pfad) {
  const endung = extname(pfad).toLowerCase();
  if (endung === ".ass" || endung === ".ssa") return await ffmpegNachVtt(["-i", pfad]);
  let roh;
  try { roh = readFileSync(pfad, "utf8"); } catch { return null; }
  if (istVtt(roh)) return roh;
  return srtNachVtt(roh);
}

/** Eine eingebettete Spur über ffmpeg nach WebVTT holen. */
export function eingebettetAlsVtt(videoPfad, nr) {
  return ffmpegNachVtt(["-i", videoPfad, "-map", `0:s:${nr}`]);
}

function ffmpegNachVtt(eingabeArgs) {
  return new Promise((fertig) => {
    const ff = spawn(FFMPEG, [
      "-hide_banner", "-loglevel", "error",
      ...eingabeArgs,
      "-f", "webvtt", "pipe:1",
    ]);
    let aus = "";
    let fehler = "";
    ff.stdout.on("data", (d) => (aus += d));
    ff.stderr.on("data", (d) => (fehler += d));
    ff.on("error", () => fertig(null));
    ff.on("close", (code) => {
      if (code !== 0 || !aus.trim()) {
        if (fehler.trim()) console.warn("[untertitel] ffmpeg:", fehler.trim().slice(-300));
        return fertig(null);
      }
      fertig(aus);
    });
    // Sicherheitsnetz: hängt ffmpeg an einer kaputten Datei, nach 25 s abbrechen
    setTimeout(() => { try { ff.kill("SIGKILL"); } catch {} }, 25000);
  });
}

/* ══ Alle Spuren einer Datei zusammenstellen ══════════════════════════════ */

/**
 * Ton- und Untertitelspuren einer Datei — eingebettet plus Dateien daneben.
 * Das Ergebnis geht unverändert an die Apps.
 */
export async function alleSpuren(videoPfad) {
  const { audio, sub } = await spurenLesen(videoPfad);
  const extern = externeUntertitel(videoPfad);
  // Externe Dateien bekommen fortlaufende Kennungen hinter den eingebetteten
  extern.forEach((e, i) => { e.id = "d" + i; });
  return {
    audio,
    sub: [...sub, ...extern],
  };
}

/** Merkt sich Spuren als JSON in der Datenbank, damit ffprobe nicht bei
 *  jedem Abspielen erneut laufen muss. */
export function spurenSpeichern(db, tabelle, id, spuren) {
  try {
    db.prepare(`UPDATE ${tabelle} SET tracks = ? WHERE id = ?`).run(JSON.stringify(spuren), id);
  } catch { /* Spalte fehlt (alte Datenbank) — dann eben jedes Mal neu lesen */ }
}

export function spurenLaden(row) {
  if (!row?.tracks) return null;
  try {
    const j = JSON.parse(row.tracks);
    return j && Array.isArray(j.audio) ? j : null;
  } catch { return null; }
}

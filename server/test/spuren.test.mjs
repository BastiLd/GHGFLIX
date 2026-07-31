/**
 * Tests für Ton- und Untertitelspuren.
 *
 * Wo möglich wird mit ECHTEN Dateien geprüft: Der Test legt eine kleine
 * Videodatei mit zwei Tonspuren und zwei Untertitelspuren an (per ffmpeg,
 * falls vorhanden) und lässt den Server sie erkennen. Ohne ffmpeg werden die
 * Teile geprüft, die reine Textverarbeitung sind — die Umwandlung nach
 * WebVTT und das Finden externer Untertiteldateien.
 *
 * Aufruf:
 *   cd server
 *   node test/spuren.test.mjs
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  alleSpuren, dateiAlsVtt, externeUntertitel, spracheName, spurenLesen, srtNachVtt,
} from "../src/spuren.js";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

const arbeit = join(tmpdir(), "ghgflix-spuren-test");
rmSync(arbeit, { recursive: true, force: true });
mkdirSync(arbeit, { recursive: true });

const hatFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
console.log(hatFfmpeg ? "\n(ffmpeg vorhanden — voller Test)" : "\n(kein ffmpeg — Textteile werden geprüft)");

/* ── Sprachnamen ───────────────────────────────────────────────────────── */
console.log("\n── Sprachkürzel werden ausgeschrieben ──────────────────────");
pruefe('"ger" wird zu Deutsch', spracheName("ger") === "Deutsch");
pruefe('"eng" wird zu Englisch', spracheName("eng") === "Englisch");
pruefe('"de" wird auch erkannt', spracheName("de") === "Deutsch");
pruefe("Unbekanntes bleibt lesbar", spracheName("xyz") === "XYZ");
pruefe("nichts bleibt nichts", spracheName(null) === null);

/* ── SRT nach WebVTT ───────────────────────────────────────────────────── */
console.log("\n── SRT wird nach WebVTT gewandelt ──────────────────────────");
{
  const srt = [
    "1",
    "00:00:01,000 --> 00:00:04,000",
    "Erster Satz.",
    "",
    "2",
    "00:01:02,500 --> 00:01:05,250",
    "Zweiter Satz,",
    "über zwei Zeilen.",
    "",
  ].join("\r\n");
  const vtt = srtNachVtt(srt);
  pruefe("beginnt mit WEBVTT", vtt.startsWith("WEBVTT"));
  pruefe("Komma wird zu Punkt", vtt.includes("00:00:01.000 --> 00:00:04.000"));
  pruefe("auch bei der zweiten Marke", vtt.includes("00:01:02.500 --> 00:01:05.250"));
  pruefe("die Zähler sind raus", !/^\s*1\s*$/m.test(vtt));
  pruefe("der Text bleibt erhalten", vtt.includes("Erster Satz.") && vtt.includes("über zwei Zeilen."));
  pruefe("Windows-Zeilenenden stören nicht", !vtt.includes("\r"));
}
{
  // Eine Datei, die schon WebVTT ist, darf nicht verdorben werden
  const vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHallo\n";
  const raus = srtNachVtt(vtt);
  pruefe("bereits sauberes WebVTT bleibt lesbar", raus.includes("00:00:01.000 --> 00:00:02.000"));
}

/* ── Externe Untertiteldateien finden ──────────────────────────────────── */
console.log("\n── Untertiteldateien neben dem Video ───────────────────────");
{
  const ordner = join(arbeit, "Filme", "Der Test (2020)");
  mkdirSync(ordner, { recursive: true });
  const video = join(ordner, "Der Test (2020).mkv");
  writeFileSync(video, "x");
  writeFileSync(join(ordner, "Der Test (2020).de.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHallo\n");
  writeFileSync(join(ordner, "Der Test (2020).eng.srt"), "1\n00:00:01,000 --> 00:00:02,000\nHello\n");
  writeFileSync(join(ordner, "Der Test (2020).de.forced.srt"), "1\n00:00:01,000 --> 00:00:02,000\nAlien\n");
  writeFileSync(join(ordner, "Ein anderer Film.de.srt"), "x");        // darf NICHT auftauchen
  writeFileSync(join(ordner, "notizen.txt"), "x");                     // ebenso wenig
  mkdirSync(join(ordner, "Subs"), { recursive: true });
  writeFileSync(join(ordner, "Subs", "3_German.srt"), "1\n00:00:01,000 --> 00:00:02,000\nAus dem Unterordner\n");

  const gefunden = externeUntertitel(video);
  const namen = gefunden.map((g) => g.name);
  console.log("     gefunden: " + namen.join(" | "));

  pruefe(`vier Untertitel gefunden (${gefunden.length})`, gefunden.length === 4);
  pruefe("die deutsche Spur ist dabei", gefunden.some((g) => g.sprache === "ger" && !g.erzwungen));
  pruefe("die englische Spur ist dabei", gefunden.some((g) => g.sprache === "eng"));
  pruefe("die erzwungene ist als solche erkannt", gefunden.some((g) => g.erzwungen));
  pruefe("der Unterordner Subs wird mitgenommen",
    gefunden.some((g) => g.datei.includes("Subs")));
  pruefe("ein fremder Film wird NICHT mitgenommen",
    !gefunden.some((g) => g.datei.includes("Ein anderer Film")));
  pruefe("eine txt-Datei wird ignoriert", !gefunden.some((g) => g.datei.endsWith(".txt")));
  pruefe("alle sind als Text-Untertitel markiert", gefunden.every((g) => g.text === true));
}

/* ── Datei einlesen und wandeln ────────────────────────────────────────── */
console.log("\n── Untertiteldatei wird als WebVTT geliefert ───────────────");
{
  const d = join(arbeit, "probe.srt");
  writeFileSync(d, "1\n00:00:03,140 --> 00:00:05,000\nGuten Abend.\n");
  const vtt = await dateiAlsVtt(d);
  pruefe("die Datei wird gelesen", !!vtt);
  pruefe("und ist gültiges WebVTT", vtt?.startsWith("WEBVTT"));
  pruefe("mit dem richtigen Text", vtt?.includes("Guten Abend."));
  pruefe("und umgerechneter Zeit", vtt?.includes("00:00:03.140"));
}

/* ── Echte Videodatei mit mehreren Spuren ──────────────────────────────── */
if (hatFfmpeg) {
  console.log("\n── Echte Datei mit 2 Tonspuren und 2 Untertiteln ───────────");
  const video = join(arbeit, "mehrspurig.mkv");
  const s1 = join(arbeit, "s1.srt");
  const s2 = join(arbeit, "s2.srt");
  writeFileSync(s1, "1\n00:00:00,500 --> 00:00:02,000\nDeutscher Untertitel\n");
  writeFileSync(s2, "1\n00:00:00,500 --> 00:00:02,000\nEnglish subtitle\n");

  const bau = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=3",
    "-i", s1, "-i", s2,
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-map", "3:s", "-map", "4:s",
    "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-c:s", "srt",
    "-metadata:s:a:0", "language=ger", "-metadata:s:a:0", "title=Hauptton",
    "-metadata:s:a:1", "language=eng",
    "-metadata:s:s:0", "language=ger",
    "-metadata:s:s:1", "language=eng",
    video,
  ], { encoding: "utf8" });

  if (bau.status !== 0 || !existsSync(video)) {
    console.log("     (Testdatei ließ sich nicht bauen — übersprungen)");
    if (bau.stderr) console.log("     " + String(bau.stderr).trim().split("\n").pop());
  } else {
    const spuren = await spurenLesen(video);
    console.log("     Ton:        " + spuren.audio.map((a) => a.name).join(" | "));
    console.log("     Untertitel: " + spuren.sub.map((s) => s.name).join(" | "));

    pruefe(`zwei Tonspuren erkannt (${spuren.audio.length})`, spuren.audio.length === 2);
    pruefe("die erste ist Deutsch", spuren.audio[0]?.name.includes("Deutsch"));
    pruefe("mit ihrem Titel", spuren.audio[0]?.name.includes("Hauptton"));
    pruefe("die zweite ist Englisch", spuren.audio[1]?.name.includes("Englisch"));
    pruefe("die Nummern sind fortlaufend ab 0",
      spuren.audio[0]?.nr === 0 && spuren.audio[1]?.nr === 1);

    pruefe(`zwei Untertitel erkannt (${spuren.sub.length})`, spuren.sub.length === 2);
    pruefe("beide sind Text (nicht Bild)", spuren.sub.every((s) => s.text && !s.bild));
    pruefe("Sprachen sind ausgeschrieben",
      spuren.sub[0]?.name.includes("Deutsch") && spuren.sub[1]?.name.includes("Englisch"));

    // Eingebettete Spur wirklich herausholen
    const { eingebettetAlsVtt } = await import("../src/spuren.js");
    const vtt = await eingebettetAlsVtt(video, 0);
    pruefe("eine eingebettete Spur lässt sich als WebVTT holen", !!vtt && vtt.startsWith("WEBVTT"));
    pruefe("mit dem richtigen Inhalt", !!vtt && vtt.includes("Deutscher Untertitel"));

    // Zusammenspiel: eingebettet + Datei daneben
    writeFileSync(join(arbeit, "mehrspurig.fre.srt"), "1\n00:00:01,000 --> 00:00:02,000\nBonsoir\n");
    const alles = await alleSpuren(video);
    pruefe(`eingebettete und externe zusammen (${alles.sub.length} Untertitel)`, alles.sub.length === 3);
    pruefe("die Datei daneben ist als solche gekennzeichnet",
      alles.sub.some((s) => s.quelle === "datei" && s.sprache === "fre"));
    pruefe("die eingebetteten sind weiterhin als eingebettet markiert",
      alles.sub.filter((s) => s.quelle === "eingebettet").length === 2);
    pruefe("alle Kennungen sind eindeutig",
      new Set(alles.sub.map((s) => s.id)).size === alles.sub.length);
  }
} else {
  console.log("\n(Der Teil mit echter Videodatei braucht ffmpeg — hier nicht vorhanden.)");
}

/* ── Datei ohne Spuren ─────────────────────────────────────────────────── */
console.log("\n── Randfälle ──────────────────────────────────────────────");
{
  const leer = await spurenLesen(join(arbeit, "gibt-es-nicht.mkv"));
  pruefe("eine fehlende Datei ergibt leere Listen",
    Array.isArray(leer.audio) && leer.audio.length === 0 && leer.sub.length === 0);
  const keine = externeUntertitel(join(arbeit, "leer", "nix.mkv"));
  pruefe("ein leerer Ordner ergibt keine Treffer", keine.length === 0);
  const kaputt = await dateiAlsVtt(join(arbeit, "gibt-es-nicht.srt"));
  pruefe("eine fehlende Untertiteldatei ergibt null", kaputt === null);
}

rmSync(arbeit, { recursive: true, force: true });
console.log("\n────────────────────────────────────────────────────────────");
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Spuren-Tests bestanden.`);

/**
 * Tests für die HLS-Ausgabe (Punkt 2 der Übergabe).
 *
 * WARUM ES DIESE DATEI GIBT
 * -------------------------
 * Gemeldet war: "Am iPhone bleibt das Bild schwarz." Ursache ist der endlose
 * fragmentierte MP4-Strom von /api/transcode — Android spielt ihn, Apples
 * AVFoundation nicht. Die Lösung ist HLS (server/src/hls.js).
 *
 * Ein Test, der nur prüft "die Route antwortet 200", wäre wertlos: genau so
 * ein Test hätte auch beim kaputten fragmentierten MP4 grün geleuchtet. Diese
 * Datei erzeugt deshalb mit ffmpeg ein echtes kleines Video, legt es als Film
 * in die Datenbank und holt sich danach über HTTP:
 *
 *   1. die Master-Playlist,
 *   2. die daraus verlinkte Häppchen-Liste,
 *   3. das erste Häppchen selbst — und prüft, dass es ein echtes MPEG-TS ist
 *      (Sync-Byte 0x47 alle 188 Byte). Genau das ist der Unterschied zwischen
 *      "der Server antwortet" und "das iPhone kann es abspielen".
 *
 * Ohne ffmpeg im Pfad werden die Wiedergabe-Prüfungen übersprungen (die
 * Erreichbarkeits- und Erkennungsprüfungen laufen trotzdem).
 *
 * Aufruf:
 *   cd server
 *   node test/hls.test.mjs
 */
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}
let uebersprungen = 0;
const ueberspringen = (was) => { uebersprungen++; console.log("  – " + was + " (übersprungen)"); };

/* ACHTUNG — Reihenfolge: db.js liest DATA_DIR beim Laden EINMAL aus der
   Umgebung. Wird irgendein src-Modul vor diesen Zeilen importiert, schreibt
   der Server in den echten Datenordner statt in den Wegwerf-Ordner. Deshalb
   stehen die Umgebungsvariablen ganz oben, vor jedem src-Import. */
const DATEN = mkdtempSync(join(tmpdir(), "ghgflix-hls-"));
const MEDIEN = join(DATEN, "medien");
const VIDEO = join(MEDIEN, "Testfilm (2026).mp4");
mkdirSync(MEDIEN, { recursive: true });

const PORT = await new Promise((resolve) => {
  const s = createServer();
  s.listen(0, "127.0.0.1", () => {
    const p = s.address().port;
    s.close(() => resolve(p));
  });
});
const PASSWORT = "hls-test-passwort";
process.env.PORT = String(PORT);
process.env.DATA_DIR = DATEN;
process.env.GHGFLIX_PASSWORD = PASSWORT;
process.env.BROWSE_ROOTS = DATEN;
process.env.SCAN_INTERVAL_SEC = "99999";
process.env.AUTO_SCAN = "off";

// ── Erkennung der Apple-Clients (reine Funktion, braucht keinen Server) ─────
console.log("\n── Wer bekommt HLS? ────────────────────────────────────────");
{
  const { istAppleClient } = await import("../src/hls.js");
  const ja = [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1",
    "AppleCoreMedia/1.0.0.21F79 (iPhone; U; CPU OS 17_5 like Mac OS X)",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  ];
  const nein = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Mozilla/5.0 (Linux; Android 11; BRAVIA) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "",
  ];
  pruefe("iPhone, iPad, AppleCoreMedia und Mac-Safari gelten als Apple", ja.every((u) => istAppleClient(u)));
  pruefe("Chrome (auch auf dem Mac) und Android gelten NICHT als Apple", nein.every((u) => !istAppleClient(u)));
}

// ── Testvideo bauen ─────────────────────────────────────────────────────────
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function ffmpegDa() {
  try {
    return spawnSync(FFMPEG, ["-version"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}
const mitFfmpeg = ffmpegDa();
if (mitFfmpeg) {
  // 6 Sekunden Testbild + Ton — lang genug für zwei Häppchen à 4 s bzw. eines
  // plus Rest, kurz genug, dass der Test in Sekunden durchläuft.
  const r = spawnSync(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=6",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-g", "48",
      "-c:a", "aac", "-shortest",
      VIDEO,
    ],
    { stdio: "inherit" },
  );
  if (r.status !== 0 || !existsSync(VIDEO)) {
    console.error("Testvideo konnte nicht erzeugt werden — Wiedergabe-Prüfungen entfallen.");
  }
}

// ── Server hochfahren ───────────────────────────────────────────────────────
// Der Import STARTET den Server (index.js ruft server.listen selbst auf).
await import("../src/index.js");

const basis = `http://127.0.0.1:${PORT}`;
const hole = (pfad, opts) => fetch(basis + pfad, opts);

let bereit = false;
for (let i = 0; i < 100; i++) {
  try {
    if ((await hole("/api/ping")).ok) { bereit = true; break; }
  } catch { /* noch nicht oben */ }
  await new Promise((r) => setTimeout(r, 100));
}
if (!bereit) {
  console.error("Server ist nicht hochgekommen — Test abgebrochen.");
  process.exit(1);
}

// Token besorgen
const token = (await (await hole("/api/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ password: PASSWORT }),
})).json()).token;

// Film direkt in die Datenbank legen — der Scanner ist hier nicht das Thema.
let filmId = null;
if (mitFfmpeg && existsSync(VIDEO)) {
  const db = new DatabaseSync(join(DATEN, "ghgflix.db"));
  db.prepare("INSERT INTO movies (title, path, added_at) VALUES (?,?,?)").run("Testfilm", VIDEO, Date.now());
  filmId = db.prepare("SELECT id FROM movies WHERE path=?").get(VIDEO).id;
  db.close();
}

// ── Erreichbarkeit und Schutz ───────────────────────────────────────────────
console.log("\n── Erreichbarkeit ──────────────────────────────────────────");
{
  const ohne = await hole("/api/hls/movie/1/master.m3u8");
  pruefe("HLS ohne Token wird abgewiesen", ohne.status === 401);

  const unbekannt = await hole(`/api/hls/movie/999999/master.m3u8?token=${token}`);
  pruefe("unbekannte ID gibt 404 (nicht 500)", unbekannt.status === 404);

  const tot = await hole(`/api/hls/s/deadbeef00/index.m3u8?token=${token}`);
  pruefe("abgelaufene Sitzung gibt 404 statt eines Absturzes", tot.status === 404);
}

console.log("\n── /api/play kennt den HLS-Weg ─────────────────────────────");
if (filmId) {
  const d = await (await hole(`/api/play/movie/${filmId}?token=${token}`)).json();
  pruefe("liefert eine hlsUrl", typeof d.hlsUrl === "string" && d.hlsUrl.includes("/api/hls/"));
  pruefe("die hlsUrl trägt das Token schon in sich", d.hlsUrl.includes("token="));

  const alsIphone = await (await hole(`/api/play/movie/${filmId}?token=${token}`, {
    headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) Version/17.5 Mobile Safari/604.1" },
  })).json();
  pruefe("beim iPhone steht hlsPflicht auf true", alsIphone.hlsPflicht === true);

  const alsChrome = await (await hole(`/api/play/movie/${filmId}?token=${token}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36" },
  })).json();
  pruefe("bei Chrome steht hlsPflicht auf false", alsChrome.hlsPflicht === false);
} else {
  ueberspringen("/api/play kennt den HLS-Weg");
}

// ── Der eigentliche Beweis: spielbare Häppchen ──────────────────────────────
console.log("\n── Kommt wirklich abspielbares HLS heraus? ─────────────────");
if (filmId) {
  const master = await hole(`/api/hls/movie/${filmId}/master.m3u8?token=${token}`);
  const mText = await master.text();
  pruefe("Master-Playlist wird ausgeliefert", master.status === 200);
  pruefe(
    "mit dem von Apple erwarteten Inhaltstyp",
    (master.headers.get("content-type") || "").includes("application/vnd.apple.mpegurl"),
  );
  pruefe("und beginnt mit #EXTM3U", mText.startsWith("#EXTM3U"));
  pruefe("und meldet den Startversatz im Header", master.headers.get("x-ghg-stream-start") === "0");

  const zeile = mText.split("\n").find((l) => l.startsWith("/api/hls/s/"));
  pruefe("verweist auf eine Sitzungs-Playlist", !!zeile);
  pruefe("und reicht das Token an die Sitzung weiter", !!zeile && zeile.includes("token="));

  const media = await hole(zeile);
  const medText = await media.text();
  pruefe("Häppchen-Liste wird ausgeliefert", media.status === 200);
  pruefe("und enthält mindestens ein Häppchen", /seg\d+\.ts/.test(medText));
  pruefe("und ist als EVENT-Playlist gekennzeichnet", medText.includes("#EXT-X-PLAYLIST-TYPE:EVENT"));
  pruefe("und trägt eine Häppchendauer", /#EXTINF:/.test(medText));

  const segZeile = medText.split("\n").find((l) => /^seg\d+\.ts/.test(l));
  const sid = zeile.split("/")[4];
  const seg = await hole(`/api/hls/s/${sid}/${segZeile}`);
  const bytes = new Uint8Array(await seg.arrayBuffer());
  pruefe("das erste Häppchen kommt an", seg.status === 200 && bytes.length > 0);
  pruefe("und wird als video/mp2t ausgeliefert", (seg.headers.get("content-type") || "").includes("video/mp2t"));
  /* Der harte Beweis: MPEG-TS besteht aus 188-Byte-Paketen, jedes beginnt mit
     0x47. Stimmt das, ist es echtes, abspielbares Transportstrom-Material —
     nicht bloß irgendeine Datei mit der richtigen Endung. */
  const tsOk =
    bytes.length >= 188 * 3 &&
    bytes[0] === 0x47 &&
    bytes[188] === 0x47 &&
    bytes[376] === 0x47;
  pruefe("und ist ein echter MPEG-Transportstrom (Sync-Byte 0x47 alle 188 Byte)", tsOk);

  // Zweiter Aufruf mit denselben Werten darf keine zweite Umwandlung starten.
  const nochmal = await hole(`/api/hls/movie/${filmId}/master.m3u8?token=${token}`);
  const zeile2 = (await nochmal.text()).split("\n").find((l) => l.startsWith("/api/hls/s/"));
  pruefe("gleicher Aufruf benutzt dieselbe Sitzung weiter", zeile2?.split("/")[4] === sid);

  // Spulen = neue Sitzung, sonst wäre der Versatz falsch.
  const gespult = await hole(`/api/hls/movie/${filmId}/master.m3u8?t=3&token=${token}`);
  const zeile3 = (await gespult.text()).split("\n").find((l) => l.startsWith("/api/hls/s/"));
  pruefe("Spulen legt eine eigene Sitzung an", zeile3?.split("/")[4] !== sid);
  pruefe("und meldet den neuen Startversatz", gespult.headers.get("x-ghg-stream-start") === "3");

  // Pfad-Ausbruch über den Häppchennamen darf nicht gehen.
  const boese = await hole(`/api/hls/s/${sid}/..%2F..%2Findex.m3u8?token=${token}`);
  pruefe("ein erfundener Häppchenname wird abgewiesen", boese.status === 400 || boese.status === 404);

  const { alleHlsBeenden, hlsSitzungsZahl } = await import("../src/hls.js");
  pruefe("es laufen Sitzungen", hlsSitzungsZahl() > 0);

  /* Mehrfaches Spulen darf nicht beliebig viele ffmpeg-Prozesse für DASSELBE
     Video hinterlassen — sonst wäre TRANSCODE_MAX nach vier-, fünfmal Spulen
     erreicht und die Wiedergabe bräche mit 503 ab. */
  for (const t of [1, 2, 4, 5]) {
    await hole(`/api/hls/movie/${filmId}/master.m3u8?t=${t}&token=${token}`);
  }
  pruefe("mehrfaches Spulen lässt höchstens 2 Sitzungen je Datei stehen", hlsSitzungsZahl() <= 2);

  // Die Häppchen gehören auf den eingehängten Datenträger, nicht in /tmp:
  // dort ist im Container oft kaum Platz.
  const { existsSync, readdirSync } = await import("node:fs");
  const hlsOrdner = join(DATEN, "hls-cache");
  pruefe("die Häppchen liegen unter DATA_DIR", existsSync(hlsOrdner) && readdirSync(hlsOrdner).length > 0);

  alleHlsBeenden();
  pruefe("alleHlsBeenden() räumt sie alle weg", hlsSitzungsZahl() === 0);
} else {
  ueberspringen("HLS-Wiedergabe (ffmpeg fehlt oder Testvideo scheiterte)");
}

console.log(`\n${gut} Prüfungen bestanden, ${fehler.length} fehlgeschlagen, ${uebersprungen} übersprungen.`);
if (fehler.length) {
  console.log("\nFehlgeschlagen:");
  fehler.forEach((f) => console.log("  - " + f));
}
try { rmSync(DATEN, { recursive: true, force: true }); } catch { /* egal */ }
process.exit(fehler.length ? 1 : 0);

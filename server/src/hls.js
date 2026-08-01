// ============================================================================
// HLS-Ausgabe für Apple-Geräte (Punkt 2 der Übergabe)
//
// WARUM es das überhaupt braucht:
// `serveTranscode()` in stream.js liefert einen ENDLOSEN, fragmentierten
// MP4-Strom (`-movflags frag_keyframe+empty_moov`, `-f mp4` nach `pipe:1`).
// Chrome und Android kommen damit zurecht: sie fangen einfach an zu spielen,
// obwohl die Datei keine Länge und keinen `moov`-Index am Anfang hat.
// AVFoundation — also jedes `<video>` unter iOS/iPadOS und auch der Player der
// Handy-App auf einem iPhone — verlangt vor der ersten Bildausgabe einen
// vollständigen Kopf. Bei einem Strom ohne Länge wartet es darauf ewig:
// die Wiedergabe startet nie, das Bild bleibt SCHWARZ. Genau der gemeldete
// Fehler.
//
// Apples eigener Weg dafür ist HLS: eine Textliste (.m3u8) mit kurzen
// MPEG-TS-Häppchen. Jedes Häppchen ist für sich abgeschlossen, das erste kann
// sofort abgespielt werden. Deshalb bekommen Apple-Clients hier eine eigene
// Adresse statt des fragmentierten MP4.
//
// Ablauf:
//   1. Client holt /api/hls/<art>/<id>/master.m3u8?t=…  → Sitzung wird angelegt,
//      ffmpeg beginnt in einen Temp-Ordner zu schreiben.
//   2. Master zeigt auf /api/hls/s/<sid>/index.m3u8 — die wächst, solange
//      ffmpeg läuft ("EVENT"-Playlist), und endet mit #EXT-X-ENDLIST.
//   3. Häppchen kommen über /api/hls/s/<sid>/segNNNNN.ts.
//
// Spulen: wie beim MP4-Weg wird eine NEUE Sitzung mit anderem `t` gestartet.
// Der Client kennt seinen Versatz also selbst — deshalb liefert die Sitzung ihn
// zusätzlich im Header `X-GHG-Stream-Start` mit.
// ============================================================================
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { DATA_DIR, settingOr } from "./db.js";
import { ffAnmelden, ffAbmelden, activeTranscodeCount, transcodeMax } from "./stream.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

/* Die Häppchen landen unter DATA_DIR, NICHT unter /tmp.
   WARUM: /tmp ist im Container die Schreibschicht des Abbilds und oft klein.
   DATA_DIR ist der eingehängte Datenträger mit echtem Platz. Mit HLS_DIR
   lässt sich das umstellen (z. B. auf eine SSD). */
const WURZEL = process.env.HLS_DIR || join(DATA_DIR, "hls-cache");

/** Häppchenlänge. 4 s ist Apples Empfehlung für schnellen Start. */
const SEGMENT_SEK = 4;

/** Sitzung ohne Zugriff so lange aufheben, dann ffmpeg beenden und aufräumen. */
const LEERLAUF_MS = 300_000;

/** Wie lange die erste Häppchen-Liste höchstens auf sich warten lassen darf. */
const WARTEN_MAX_MS = 30_000;

/* So viele Sitzungen dürfen gleichzeitig auf DIESELBE Datei zeigen.
   WARUM überhaupt eine Grenze: jedes Spulen legt eine neue Sitzung an (nur so
   stimmt der Zeitversatz). Ohne Grenze hätte man nach fünfmal Spulen fünf
   laufende ffmpeg-Prozesse für ein und dasselbe Video — und die Obergrenze
   TRANSCODE_MAX wäre sofort erreicht. Die am längsten unbenutzte fliegt raus. */
const MAX_JE_DATEI = 2;

const QUALITAET = {
  low: { height: 480, maxrate: "2000k" },
  medium: { height: 720, maxrate: "4000k" },
  high: { height: 1080, maxrate: "8000k" },
  original: null,
};

/* ── Welche ffmpeg-Schalter kennt die vorhandene Fassung? ──────────────────
   `-readrate` gibt es ab ffmpeg 6.0, `-readrate_initial_burst` ab 6.1. Kennt
   ffmpeg einen Schalter nicht, bricht es SOFORT ab — und das Ergebnis wäre
   wieder ein schwarzes Bild, also genau der Fehler, der hier behoben werden
   soll. Deshalb wird einmalig nachgesehen, statt eine Version zu raten.
   `ffmpeg -h full` listet alle Optionsnamen; der Aufruf kostet einmal ~100 ms
   und wird gemerkt. */
let koennen = null;
function ffmpegKann(schalter) {
  if (koennen === null) {
    koennen = new Set();
    try {
      // Die Ausgabe ist über 1 MB groß — deshalb maxBuffer hochsetzen, sonst
      // schneidet Node sie ab und die Erkennung liefert falsche Antworten.
      const r = spawnSync(FFMPEG, ["-hide_banner", "-h", "full"], {
        encoding: "utf8",
        timeout: 15_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const text = `${r.stdout || ""}${r.stderr || ""}`;
      // Die Einrückung der Optionsliste ist je nach ffmpeg-Fassung
      // unterschiedlich (mal zwei Leerzeichen, mal keines) — deshalb
      // beliebiger Leerraum davor.
      for (const m of text.matchAll(/^[ \t]*-([a-z][a-z_0-9]*)[ \t<]/gim)) koennen.add(m[1]);
    } catch {
      /* Findet ffmpeg nicht statt, bleibt die Menge leer — dann wird ohne
         Drossel gearbeitet wie bisher. */
    }
    if (!koennen.has("readrate")) {
      console.warn(
        "[hls] Dieses ffmpeg kennt -readrate nicht (älter als 6.0). Die Umwandlung läuft ungebremst — " +
          "das ist funktionsfähig, schreibt aber die ganze Datei auf die Platte, statt nur den geschauten Teil.",
      );
    }
  }
  return koennen.has(schalter);
}

/* Reste eines abgestürzten oder hart gestoppten Laufs wegräumen. Keine Sitzung
   überlebt einen Neustart — was hier noch liegt, ist ausschließlich Müll. Ohne
   diese Zeile wüchse der Ordner bei jedem unsauberen Stopp weiter. */
try {
  rmSync(WURZEL, { recursive: true, force: true });
} catch {
  /* Ordner nicht da oder gesperrt — dann ist nichts aufzuräumen */
}

/** sid → Sitzung */
const sitzungen = new Map();
/** Schlüssel aus (Datei, Startzeit, Qualität, Tonspur) → sid, damit ein
 *  Neuladen der Seite nicht jedes Mal einen neuen ffmpeg startet. */
const nachSchluessel = new Map();

const schluesselFuer = (row, o) => `${row.path}|${o.start}|${o.quality}|${o.audioIndex}`;

function aufraeumen(sid) {
  const s = sitzungen.get(sid);
  if (!s) return;
  sitzungen.delete(sid);
  if (nachSchluessel.get(s.schluessel) === sid) nachSchluessel.delete(s.schluessel);
  try {
    s.ff.kill("SIGKILL");
  } catch {}
  ffAbmelden(s.ff);
  try {
    rmSync(s.dir, { recursive: true, force: true });
  } catch {}
}

/* Aufräumer. Ohne ihn bliebe für jedes weggelegte iPhone ein ffmpeg-Prozess
   samt Temp-Ordner stehen — auf einem NAS ist das nach ein paar Tagen der
   volle Datenträger. */
let waechter = null;
function waechterStarten() {
  if (waechter) return;
  waechter = setInterval(() => {
    const jetzt = Date.now();
    for (const [sid, s] of sitzungen) {
      // Eine fertig umgewandelte Sitzung darf länger liegen bleiben: der Nutzer
      // schaut ja noch. Erst ohne Zugriff wird sie weggeräumt.
      if (jetzt - s.letzterZugriff > LEERLAUF_MS) aufraeumen(sid);
    }
    if (sitzungen.size === 0 && waechter) {
      clearInterval(waechter);
      waechter = null;
    }
  }, 15_000);
  // Der Aufräumer darf den Prozess nicht am Beenden hindern.
  waechter.unref?.();
}

/** Alle HLS-Sitzungen beenden (Container-Stopp, SRV-005). */
export function alleHlsBeenden() {
  for (const sid of [...sitzungen.keys()]) aufraeumen(sid);
}

export const hlsSitzungsZahl = () => sitzungen.size;

/**
 * Sitzung anlegen (oder eine passende wiederverwenden) und die sid liefern.
 * Wirft, wenn die Obergrenze für gleichzeitige Umwandlungen erreicht ist.
 */
export function sitzungStarten(row, { start = 0, quality = "original", audioIndex = 0 } = {}) {
  const opt = { start: Math.max(0, Math.round(start)), quality, audioIndex: Number(audioIndex) || 0 };
  const schluessel = schluesselFuer(row, opt);

  const vorhanden = nachSchluessel.get(schluessel);
  if (vorhanden && sitzungen.has(vorhanden)) {
    const s = sitzungen.get(vorhanden);
    s.letzterZugriff = Date.now();
    return s;
  }

  // Dieselbe Obergrenze wie beim MP4-Weg — beide zählen in dieselbe Liste.
  if (activeTranscodeCount() >= transcodeMax()) {
    const e = new Error(
      `Zu viele gleichzeitige Video-Umwandlungen (max. ${transcodeMax()}). Kurz warten — oder TRANSCODE_MAX erhöhen.`,
    );
    e.code = 503;
    throw e;
  }

  /* Vor dem Start aufräumen: zu viele Sitzungen auf dieselbe Datei entstehen
     durch mehrfaches Spulen. Die am längsten unbenutzte fliegt raus, damit
     nicht mehrere ffmpeg-Prozesse für ein Video nebeneinander laufen. */
  const gleicheDatei = [...sitzungen.values()]
    .filter((s) => s.pfad === row.path)
    .sort((a, b) => a.letzterZugriff - b.letzterZugriff);
  while (gleicheDatei.length >= MAX_JE_DATEI) aufraeumen(gleicheDatei.shift().sid);

  const sid = randomBytes(9).toString("hex");
  const dir = join(WURZEL, sid);
  mkdirSync(dir, { recursive: true });

  const q = QUALITAET[opt.quality] ?? null;

  /* Dieselbe Überlegung wie in stream.js (AV-01/AV-02): beim Spulen darf das
     Bild NICHT nur kopiert werden, sonst beginnt es beim vorherigen Keyframe
     und der Ton ist versetzt. Nur beim Start bei 0 wird kopiert. */
  const genauesSpulen = settingOr("transcode_accurate_seek", "TRANSCODE_ACCURATE_SEEK", "on") !== "off";
  const bildKopieren = row.vcodec === "h264" && !q && (opt.start <= 0 || !genauesSpulen);

  const args = ["-hide_banner", "-loglevel", "warning", "-fflags", "+genpts"];
  if (opt.start > 0) args.push("-ss", String(opt.start));

  /* ── Drossel ────────────────────────────────────────────────────────────
     Der MP4-Weg in stream.js bremst sich von selbst: ffmpeg schreibt in eine
     Pipe zum Client, und wenn der nicht schnell genug abnimmt, blockiert der
     Schreibvorgang. HLS schreibt dagegen auf die PLATTE — ohne Bremse würde
     ffmpeg eine 45-Minuten-Folge in einem Rutsch durchrechnen und dabei
     mehrere Gigabyte ablegen, obwohl der Nutzer vielleicht nach zwei Minuten
     abbricht.

     `-readrate 1.5` liest die Quelle mit dem 1,5-fachen der Abspielzeit —
     also immer ein gutes Stück Vorlauf für den Puffer, aber nie die ganze
     Datei auf einmal. `-readrate_initial_burst 30` gibt die ersten 30
     Sekunden ungebremst frei, damit die Wiedergabe sofort startet.
     Beide sind INPUT-Optionen und müssen vor -i stehen. */
  if (ffmpegKann("readrate")) {
    args.push("-readrate", "1.5");
    if (ffmpegKann("readrate_initial_burst")) args.push("-readrate_initial_burst", "30");
  }

  args.push("-i", row.path, "-map", "0:v:0", "-map", `0:a:${opt.audioIndex}?`);

  if (bildKopieren) {
    args.push("-c:v", "copy");
  } else {
    // baseline/main/high je nach Gerät: "high" auf Level 4.1 spielt jedes
    // iPhone ab dem 5s. Explizit gesetzt, weil AVFoundation bei exotischen
    // Profilen wieder nur ein schwarzes Bild zeigt statt einer Fehlermeldung.
    args.push(
      "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
      "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
    );
    if (q) args.push("-vf", `scale=-2:min(${q.height}\\,ih)`, "-maxrate", q.maxrate, "-bufsize", q.maxrate);
    // Keyframes genau auf den Häppchengrenzen — sonst schneidet ffmpeg
    // ungleichmäßig und iOS ruckelt beim Übergang.
    args.push("-force_key_frames", `expr:gte(t,n_forced*${SEGMENT_SEK})`);
  }

  const tonKopieren = row.acodec === "aac" && bildKopieren;
  if (tonKopieren) {
    args.push("-c:a", "copy");
  } else {
    args.push("-c:a", "aac", "-ac", "2", "-b:a", "160k");
    args.push("-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0");
  }

  args.push(
    "-avoid_negative_ts", "make_zero",
    "-max_muxing_queue_size", "2048",
    "-f", "hls",
    "-hls_time", String(SEGMENT_SEK),
    "-hls_playlist_type", "event",
    "-hls_list_size", "0",
    "-hls_flags", "independent_segments+temp_file",
    "-hls_segment_type", "mpegts",
    "-hls_segment_filename", join(dir, "seg%05d.ts"),
    join(dir, "index.m3u8"),
  );

  const ff = spawn(FFMPEG, args);
  ffAnmelden(ff);

  const s = {
    sid,
    dir,
    ff,
    schluessel,
    pfad: row.path,
    start: opt.start,
    quality: opt.quality,
    audioIndex: opt.audioIndex,
    breite: row.width ?? null,
    hoehe: row.height ?? null,
    fertig: false,
    letzterZugriff: Date.now(),
    fehler: "",
  };
  sitzungen.set(sid, s);
  nachSchluessel.set(schluessel, sid);
  waechterStarten();

  let errBuf = "";
  ff.stderr.on("data", (d) => {
    errBuf = (errBuf + d.toString()).slice(-4096);
  });
  ff.on("close", (code) => {
    s.fertig = true;
    s.ff.exitCode = code;
    ffAbmelden(ff);
    if (code !== 0 && code !== null && errBuf.trim()) {
      s.fehler = errBuf.trim().slice(-500);
      console.error(`[hls] ffmpeg exit ${code} bei "${row.path}" (t=${opt.start}): ${s.fehler}`);
    }
  });
  ff.on("error", (e) => {
    s.fertig = true;
    s.fehler = String(e.message || e);
    ffAbmelden(ff);
    console.error(`[hls] ffmpeg konnte nicht starten: ${s.fehler}`);
  });

  return s;
}

/** Master-Playlist — eine einzige Variante, zeigt auf die Häppchen-Liste. */
export function masterPlaylist(s, tokenParam = "") {
  const bandbreite = s.hoehe && s.hoehe >= 1080 ? 8_000_000 : s.hoehe && s.hoehe >= 720 ? 4_000_000 : 2_000_000;
  const aufloesung = s.breite && s.hoehe ? `,RESOLUTION=${s.breite}x${s.hoehe}` : "";
  return (
    "#EXTM3U\n" +
    "#EXT-X-VERSION:3\n" +
    `#EXT-X-STREAM-INF:BANDWIDTH=${bandbreite}${aufloesung},CODECS="avc1.640029,mp4a.40.2"\n` +
    `/api/hls/s/${s.sid}/index.m3u8${tokenParam}\n`
  );
}

/**
 * Die von ffmpeg geschriebene Häppchen-Liste holen — mit Warten, bis das erste
 * Häppchen wirklich da ist.
 *
 * WARUM das Warten: ffmpeg schreibt index.m3u8 erst, wenn das erste Häppchen
 * fertig ist. Ohne das Warten bekäme der Client sofort ein 404 und iOS bricht
 * dann endgültig ab statt es erneut zu versuchen.
 *
 * Die Häppchen-Adressen werden umgeschrieben, damit das Token mitgeht — sonst
 * antwortet der Server bei gesetztem GHGFLIX_PASSWORD auf jedes Häppchen mit 401.
 */
export async function haeppchenListe(s, tokenParam = "") {
  const datei = join(s.dir, "index.m3u8");
  const bis = Date.now() + WARTEN_MAX_MS;
  while (Date.now() < bis) {
    if (existsSync(datei)) {
      const roh = readFileSync(datei, "utf8");
      if (/^seg\d+\.ts/m.test(roh)) {
        return roh.replace(/^(seg\d+\.ts)$/gm, (_m, name) => `${name}${tokenParam}`);
      }
    }
    if (s.fertig && s.ff.exitCode !== 0 && s.ff.exitCode !== null) {
      throw new Error("Die Umwandlung ist fehlgeschlagen" + (s.fehler ? `: ${s.fehler}` : ""));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Die Umwandlung braucht ungewöhnlich lange — bitte erneut versuchen");
}

/** Sitzung nachschlagen und den Zugriffszeitpunkt auffrischen. */
export function sitzung(sid) {
  const s = sitzungen.get(sid);
  if (s) s.letzterZugriff = Date.now();
  return s ?? null;
}

/** Ein Häppchen ausliefern. */
export function haeppchenSenden(res, s, name) {
  // Nur die von ffmpeg erzeugten Namen zulassen — kein Pfad-Ausbruch.
  if (!/^seg\d+\.ts$/.test(name)) {
    res.writeHead(400).end("ungueltiger Name");
    return;
  }
  const datei = join(s.dir, name);
  let st;
  try {
    st = statSync(datei);
  } catch {
    res.writeHead(404).end("Haeppchen nicht da");
    return;
  }
  res.writeHead(200, {
    "Content-Type": "video/mp2t",
    "Content-Length": st.size,
    // Häppchen ändern sich nie, dürfen aber auch nicht ewig liegen bleiben —
    // die Sitzung wird ja aufgeräumt.
    "Cache-Control": "private, max-age=300",
  });
  createReadStream(datei).pipe(res);
}

/**
 * Erkennt ein Apple-Gerät am User-Agent.
 *
 * Bewusst großzügig: iPhone/iPad/iPod, Mac-Safari und der Apple-eigene
 * `AppleCoreMedia`-Lader (den schickt AVFoundation, wenn ein `<video>` die
 * Daten holt — genau der Fall, in dem das fragmentierte MP4 versagt).
 */
export function istAppleClient(userAgent = "") {
  const ua = String(userAgent);
  if (/AppleCoreMedia|iPhone|iPad|iPod/i.test(ua)) return true;
  // Safari auf dem Mac: "Safari" ja, aber Chrome/Edge geben sich auch als
  // Safari aus — die tragen zusätzlich "Chrome"/"Chromium"/"Edg".
  return /Macintosh/i.test(ua) && /Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua);
}

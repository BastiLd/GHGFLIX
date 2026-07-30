// ============================================================================
// Vorschaubilder für die Zeitleiste ("wenn ich mit der Maus drüberfahre")
//
// Zwei Verfahren, absichtlich kombiniert:
//
// 1. EINZELBILD  (sofort verfügbar, ein ffmpeg-Aufruf pro Position)
//    Genau wie bisher — aber jetzt mit Pfadprüfung, Parallelitäts-Limit,
//    einstellbarer Breite und automatischem Aufräumen des Caches.
//
// 2. TRICKPLAY-SPRITE  (wie Plex "trickplay" / Jellyfin "Trickplay")
//    Ein einziges großes JPEG enthält alle Vorschaubilder eines Videos in einem
//    Raster. Der Browser lädt es EINMAL; danach kostet jede Position beim
//    Drüberfahren null Netzwerk — die Vorschau springt sofort mit, auch am
//    Fernseher und am Handy. Erzeugt wird es im Hintergrund (max. 1 gleichzeitig,
//    damit das NAS nicht in die Knie geht).
//
// Beide Ergebnisse landen unter DATA_DIR und überleben Neustarts.
// ============================================================================
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, openDb, settingOr } from "./db.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

export const THUMB_DIR = join(DATA_DIR, "thumb-cache");
export const TRICK_DIR = join(DATA_DIR, "trickplay");
// Aus dem Video geschnittene FOLGENBILDER liegen bewusst NICHT im
// Einzelbild-Cache: der wird nach Größe aufgeräumt, und ein weggeräumtes
// Folgenbild wäre dauerhaft weg (die Datenbank merkt sich, dass es schon
// erzeugt wurde). Sie sind klein, dauerhaft und wenige — eigener Ordner.
export const STILL_DIR = join(DATA_DIR, "stills");

/**
 * Stabiler Hash für Dateipfade. Bewusst 64 Bit (zwei unabhängige 32-Bit-Läufe):
 * mit dem alten 32-Bit-djb2 wurden bei einigen tausend Dateien Kollisionen
 * wahrscheinlich — dann zeigt eine Datei das Vorschaubild einer anderen.
 */
export function hashStr(s) {
  const str = String(s);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1 + c) >>> 0;
    h2 = ((h2 << 5) + h2 + (c ^ (i + 1))) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

/** Dauerhaftes Folgenbild (wird NICHT vom Cache-Aufräumer angefasst). */
export function makeStill(path, t, width = 480) {
  const w = Math.min(1280, Math.max(160, Math.round(width) || 480));
  mkdirSync(STILL_DIR, { recursive: true });
  const file = join(STILL_DIR, `${hashStr(path)}_${w}.jpg`);
  if (existsSync(file)) return Promise.resolve(file);
  return thumbLimit(async () => {
    if (existsSync(file)) return file;
    const r = await runFfmpeg(
      [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", String(Math.max(0, t)),
        "-i", path,
        "-frames:v", "1", "-an", "-sn", "-dn",
        "-vf", `scale=${w}:-2`,
        "-q:v", "4", "-y", file,
      ],
      25_000,
    );
    if (!r.ok && !existsSync(file)) return null;
    return existsSync(file) ? file : null;
  });
}

// ── Parallelitäts-Bremse ────────────────────────────────────────────────────
// Ohne Limit startet schnelles Scrubben Dutzende ffmpeg-Prozesse gleichzeitig
// und legt schwache NAS-CPUs lahm.
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--;
        next();
      });
  };
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

const thumbLimit = makeLimiter(Math.max(1, parseInt(process.env.THUMB_CONCURRENCY || "2", 10) || 2));
const trickLimit = makeLimiter(1); // Sprite-Bau ist teuer → immer nur eines

/** ffmpeg mit Zeitlimit ausführen; true bei Erfolg. */
function runFfmpeg(args, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const ff = spawn(FFMPEG, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    ff.stderr.on("data", (d) => (err = (err + d).slice(-1000)));
    const timer = setTimeout(() => {
      if (!done) {
        try {
          ff.kill("SIGKILL");
        } catch {
          /* schon tot */
        }
      }
    }, timeoutMs);
    ff.on("error", () => {
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, err: "ffmpeg nicht gefunden" });
    });
    ff.on("close", (code) => {
      done = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, err });
    });
  });
}

// ── 1) Einzelbilder ─────────────────────────────────────────────────────────

/** Cachedatei für (Pfad, Sekunde, Breite). */
export function thumbFile(path, t, width = 320) {
  return join(THUMB_DIR, `${hashStr(path)}_${Math.round(t)}_${width}.jpg`);
}

/**
 * Ein Vorschaubild erzeugen (oder aus dem Cache liefern).
 * @param {number} width Zielbreite in Pixeln — kommt aus der Einstellung
 *                       "Vorschaubild-Größe", damit große Kacheln auch wirklich
 *                       scharf sind statt hochskaliert.
 */
export function makeThumb(path, t, width = 320) {
  const w = Math.min(960, Math.max(80, Math.round(width) || 320));
  mkdirSync(THUMB_DIR, { recursive: true });
  const file = thumbFile(path, t, w);
  if (existsSync(file)) return Promise.resolve(file);
  return thumbLimit(async () => {
    if (existsSync(file)) return file; // in der Warteschlange fertig geworden
    const r = await runFfmpeg(
      [
        "-hide_banner", "-loglevel", "error", "-nostdin",
        "-ss", String(Math.max(0, t)),
        "-i", path,
        "-frames:v", "1", "-an", "-sn", "-dn",
        "-vf", `scale=${w}:-2`,
        "-q:v", "5", "-y", file,
      ],
      20_000,
    );
    if (!r.ok && !existsSync(file)) return null;
    return existsSync(file) ? file : null;
  });
}

// ── 2) Trickplay-Sprites ────────────────────────────────────────────────────

const trickRow = (path) => openDb().prepare("SELECT * FROM trickplay WHERE path = ?").get(path) ?? null;

/** Fertiges Sprite-Blatt zu einem Video, sonst null. */
export function trickplayInfo(path) {
  const row = trickRow(path);
  if (!row) return null;
  const file = join(TRICK_DIR, row.file);
  if (!existsSync(file)) {
    try {
      openDb().prepare("DELETE FROM trickplay WHERE path = ?").run(path);
    } catch {
      /* egal */
    }
    return null;
  }
  return {
    interval: row.interval,
    tileWidth: row.tile_w,
    tileHeight: row.tile_h,
    cols: row.cols,
    rows: row.rows,
    count: row.count,
    file: row.file,
  };
}

const building = new Set();

/**
 * Sprite-Blatt bauen (idempotent, im Hintergrund aufrufbar).
 * Ein Blatt deckt das ganze Video ab; die Rasterbreite wird so gewählt, dass
 * das JPEG nicht über ~16000 px breit/hoch wird (Browser-Limit).
 */
export async function buildTrickplay(path, duration, opts = {}) {
  if (!duration || duration < 60) return null; // für Kurzclips lohnt es nicht
  const existing = trickplayInfo(path);
  if (existing) return existing;
  if (building.has(path)) return null;

  const interval = Math.max(
    2,
    parseInt(opts.interval ?? settingOr("trickplay_interval", "TRICKPLAY_INTERVAL", "10"), 10) || 10,
  );
  const tileW = Math.min(480, Math.max(96, parseInt(opts.tileWidth ?? settingOr("trickplay_width", "TRICKPLAY_WIDTH", "240"), 10) || 240));
  const count = Math.min(2000, Math.ceil(duration / interval));
  if (count < 4) return null;
  const cols = Math.min(10, count);
  const rows = Math.ceil(count / cols);
  // grobe Höhenschätzung (16:9) nur zur Begrenzung der Bildgröße
  if (cols * tileW > 16000 || rows * (tileW * 9) / 16 > 16000) return null;

  building.add(path);
  try {
    mkdirSync(TRICK_DIR, { recursive: true });
    const name = `${hashStr(path)}_${interval}_${tileW}.jpg`;
    const out = join(TRICK_DIR, name);
    const started = Date.now();
    const r = await trickLimit(() =>
      runFfmpeg(
        [
          "-hide_banner", "-loglevel", "error", "-nostdin",
          "-i", path,
          "-an", "-sn", "-dn",
          "-vf", `fps=1/${interval},scale=${tileW}:-2,tile=${cols}x${rows}`,
          "-frames:v", "1", "-q:v", "6", "-y", out,
        ],
        // großzügig: eine Stunde Film braucht auf schwacher NAS-CPU einige Minuten
        Math.min(45 * 60_000, Math.max(120_000, duration * 250)),
      ),
    );
    if (!r.ok || !existsSync(out)) {
      if (r.err) console.warn(`[trickplay] fehlgeschlagen für "${path}": ${r.err.trim().split("\n").pop()}`);
      return null;
    }
    const tileH = Math.round((tileW * 9) / 16 / 2) * 2; // ffmpeg rundet auf gerade Zahlen
    openDb()
      .prepare(
        `INSERT INTO trickplay (path, interval, tile_w, tile_h, cols, rows, count, sheets, file, created_at)
         VALUES (?,?,?,?,?,?,?,1,?,?)
         ON CONFLICT(path) DO UPDATE SET interval=excluded.interval, tile_w=excluded.tile_w, tile_h=excluded.tile_h,
           cols=excluded.cols, rows=excluded.rows, count=excluded.count, file=excluded.file, created_at=excluded.created_at`,
      )
      .run(path, interval, tileW, tileH, cols, rows, count, name, Date.now());
    console.log(`[trickplay] ${count} Bilder in ${((Date.now() - started) / 1000).toFixed(0)} s → ${name}`);
    return trickplayInfo(path);
  } finally {
    building.delete(path);
  }
}

/** Nicht blockierend anstoßen (beim Start einer Wiedergabe). */
export function ensureTrickplay(path, duration) {
  if (settingOr("trickplay", "TRICKPLAY", "on") === "off") return;
  if (trickplayInfo(path) || building.has(path)) return;
  void buildTrickplay(path, duration).catch(() => {});
}

// ── Cache-Pflege ────────────────────────────────────────────────────────────

export function dirSize(dir) {
  let total = 0;
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile()) total += statSync(p).size;
      else if (e.isDirectory()) total += dirSize(p);
    }
  } catch {
    /* Ordner fehlt */
  }
  return total;
}

/**
 * Einzelbild-Cache begrenzen (Standard 512 MB): älteste Dateien zuerst löschen.
 * Sprite-Blätter sind davon ausgenommen — die sind klein und wertvoll.
 */
export function pruneThumbCache(maxBytes = null) {
  const limit = maxBytes ?? Math.max(64, parseInt(settingOr("thumb_cache_mb", "THUMB_CACHE_MB", "512"), 10) || 512) * 1024 * 1024;
  let files;
  try {
    files = readdirSync(THUMB_DIR, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => {
        const p = join(THUMB_DIR, e.name);
        const st = statSync(p);
        return { p, size: st.size, at: st.mtimeMs };
      });
  } catch {
    return 0;
  }
  let total = files.reduce((s, f) => s + f.size, 0);
  if (total <= limit) return 0;
  files.sort((a, b) => a.at - b.at);
  let freed = 0;
  for (const f of files) {
    if (total <= limit) break;
    try {
      unlinkSync(f.p);
      total -= f.size;
      freed += f.size;
    } catch {
      /* schon weg */
    }
  }
  if (freed > 0) console.log(`[thumbs] Cache aufgeräumt: ${(freed / 1024 / 1024).toFixed(0)} MB freigegeben`);
  return freed;
}

/**
 * Alles löschen (Einstellungen → "Vorschau-Cache leeren"). Auch die erzeugten
 * Folgenbilder — dann aber die Merker in der Datenbank zurücksetzen, damit sie
 * beim nächsten Scan sauber neu entstehen.
 */
export function clearThumbCache() {
  const size = dirSize(THUMB_DIR) + dirSize(TRICK_DIR) + dirSize(STILL_DIR);
  rmSync(THUMB_DIR, { recursive: true, force: true });
  rmSync(TRICK_DIR, { recursive: true, force: true });
  rmSync(STILL_DIR, { recursive: true, force: true });
  try {
    const db = openDb();
    db.exec("DELETE FROM trickplay");
    db.exec("UPDATE episodes SET local_still=NULL, still_generated=0 WHERE still_generated=1");
  } catch {
    /* Tabelle evtl. noch nicht da */
  }
  return size;
}

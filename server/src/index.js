// GHGFlix Server — a small Plex/Jellyfin-style media server with zero npm
// dependencies. HTTP + routing on node:http, storage on node:sqlite,
// video via ffmpeg. Designed for ZimaOS/Docker (see ../Dockerfile).
import { createServer } from "node:http";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { join, normalize, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb, getSetting, setSetting, settingOr, listLibraries, addLibrary, removeLibrary } from "./db.js";
import { scanLibrary, scanState, removeLibraryContent, detectLibraries, BROWSE_ROOTS, primaryRoot, isSystemDir } from "./scanner.js";
import { canDirectPlay, ffprobe, killAllTranscodes, serveFile, serveTranscode } from "./stream.js";
import { alleHlsBeenden, haeppchenListe, haeppchenSenden, istAppleClient, masterPlaylist, sitzung, sitzungStarten } from "./hls.js";
import { alleSpuren, dateiAlsVtt, eingebettetAlsVtt, spurenLaden, spurenSpeichern } from "./spuren.js";
import { kopplungsSeite, loeseKopplungEin, pruefeKopplung, starteKopplung } from "./koppeln.js";
import { cachedImage, tmdbEnabled } from "./tmdb.js";
import * as supabase from "./supabase.js";
import { handleInvoke } from "./invoke.js";
import * as serienfilme from "./serienfilme.js";
import * as kanaele from "./kanaele.js";
import { makeThumb, trickplayInfo, ensureTrickplay, pruneThumbCache, TRICK_DIR } from "./thumbs.js";
import { isLocalRef, localRefPath, imageMime } from "./artwork.js";
import { isImage } from "./parser.js";
import { spawn } from "node:child_process";

const PORT = parseInt(process.env.PORT || "8484", 10);
const SERVER_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
// webapp/ = the REAL desktop UI built for the browser (vite build:web);
// web/    = legacy fallback (icon, manifest) for files not in the build
const WEBAPP_DIR = join(SERVER_ROOT, "webapp");
const LEGACY_DIR = join(SERVER_ROOT, "web");
const WEB_DIR = existsSync(join(WEBAPP_DIR, "index.html")) ? WEBAPP_DIR : LEGACY_DIR;
const VERSION = "2.8.0";

const db = openDb();

// ARCH-16: stable per-installation ID (random UUID, created once). Clients use
// it to key their sync cursors (S-017) so switching between addresses
// (LAN/Domain/Tailscale) of the SAME server doesn't create duplicate cursors.
if (!getSetting("server_id")) setSetting("server_id", randomBytes(16).toString("hex"));
const SERVER_ID = getSetting("server_id");

// ── auth ────────────────────────────────────────────────────────────────────
// Optional: set GHGFLIX_PASSWORD (env or setting). Tokens survive restarts.
// SEC-003: tokens expire after 180 days (verlorene/verkaufte Geräte behalten
// keinen ewig gültigen Zugang). Altes Format (Array aus Strings) wird migriert.
const password = () => settingOr("password", "GHGFLIX_PASSWORD", "");
const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const tokens = new Map(); // token → createdAt (ms)
try {
  for (const t of JSON.parse(getSetting("auth_tokens") || "[]")) {
    if (Array.isArray(t)) tokens.set(String(t[0]), Number(t[1]) || Date.now());
    else tokens.set(String(t), Date.now());
  }
} catch {}
const saveTokens = () => setSetting("auth_tokens", JSON.stringify([...tokens.entries()].slice(-50)));

function authed(req, url) {
  if (!password()) return true;
  const h = req.headers.authorization || "";
  const t = h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token") || "";
  const born = tokens.get(t);
  if (born == null) return false;
  if (Date.now() - born > TOKEN_TTL_MS) {
    tokens.delete(t);
    saveTokens();
    return false;
  }
  return true;
}

// SEC-008/SRV-007: Brute-Force-Schutz für /api/login — nach 8 Fehlversuchen
// von derselben IP 5 Minuten Sperre.
const loginFails = new Map(); // ip → { n, until }

// ── helpers ─────────────────────────────────────────────────────────────────
const json = (res, data, status = 200) => {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
};
/**
 * Anfrage-Inhalt einlesen.
 *
 * Versteht JSON (so sprechen die Apps) und Formulardaten im Format
 * application/x-www-form-urlencoded. Letzteres braucht die Kopplungsseite,
 * die das Handy nach dem Scannen des QR-Codes öffnet: Ein schlichtes
 * HTML-Formular funktioniert auf jedem Browser, auch ohne JavaScript —
 * und genau das ist dort gewollt.
 */
const readBody = (req) =>
  new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (d) => {
      buf += d;
      if (buf.length > 10_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      if (!buf) return resolve({});
      const art = String(req.headers["content-type"] || "");
      if (art.includes("x-www-form-urlencoded")) {
        const aus = {};
        for (const [k, v] of new URLSearchParams(buf)) aus[k] = v;
        return resolve(aus);
      }
      try {
        resolve(JSON.parse(buf));
      } catch {
        // Kein JSON, aber vielleicht doch ein Formular ohne passenden Kopf
        if (buf.includes("=")) {
          const aus = {};
          for (const [k, v] of new URLSearchParams(buf)) aus[k] = v;
          return resolve(aus);
        }
        reject(new Error("invalid json"));
      }
    });
  });

const mediaRow = (type, id) =>
  db.prepare(`SELECT * FROM ${type === "movie" ? "movies" : "episodes"} WHERE id = ?`).get(id);

/** Rohes Bearer-/Query-Token der Anfrage (für Bild-URLs ohne Header). */
function bearerToken(req, url) {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : url.searchParams.get("token") || "";
}

/**
 * SICHERHEIT: Nur Dateien, die wirklich in der Bibliothek stehen, dürfen als
 * Vorschau/Standbild verarbeitet werden. Vorher nahm /api/thumbfile JEDEN Pfad
 * entgegen — ein angemeldeter Nutzer hätte Einzelbilder beliebiger Dateien des
 * Containers ziehen können.
 */
function isLibraryFile(path) {
  if (!path) return false;
  return !!(
    db.prepare("SELECT 1 FROM movies WHERE path = ?").get(path) ||
    db.prepare("SELECT 1 FROM episodes WHERE path = ?").get(path) ||
    db.prepare("SELECT 1 FROM episode_files WHERE path = ?").get(path)
  );
}

/**
 * Ordner-Browser: nur innerhalb der konfigurierten Wurzeln (BROWSE_ROOTS) bzw.
 * unterhalb bereits eingetragener Bibliotheken navigieren.
 */
function withinBrowseRoots(target) {
  const norm = (s) => normalize(String(s)).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  const t = norm(target);
  const roots = [...BROWSE_ROOTS, ...listLibraries().map((l) => l.path), primaryRoot()].map(norm);
  return roots.some((r) => r === "/" || t === r || t.startsWith(r + "/"));
}

/** Lokale Bilddatei: muss eine Bildendung haben UND unter einer Bibliothek
 *  bzw. im Daten-Ordner (erzeugte Standbilder) liegen. */
function isAllowedImage(file) {
  if (!isImage(file)) return false;
  if (!existsSync(file)) return false;
  const norm = (s) => s.replace(/\\/g, "/").replace(/\/+$/, "");
  const roots = [...listLibraries().map((l) => l.path), process.env.DATA_DIR || "/data"];
  return roots.some((r) => norm(file).startsWith(norm(r) + "/"));
}

/**
 * Wo liegt die Handy-/TV-App (APK)? Zuerst im DATEN-Ordner (überlebt jedes
 * Server-Update, dort legt der Nutzer sie über ZimaOS → Files ab), sonst die
 * im Image mitgelieferte. Gibt null zurück, wenn keine vorhanden ist.
 */
/**
 * Version der hinterlegten App-Datei.
 *
 * Die Versionsnummer steckt zwar in der APK selbst, liegt dort aber im
 * binären Android-Manifest — sie herauszulesen wäre unverhältnismäßig
 * aufwendig. Stattdessen legt das Upload-Skript sie als kleine Textdatei
 * daneben. Fehlt sie (Datei von Hand kopiert), meldet der Server null und
 * die Apps bieten das Update schlicht ohne Versionsvergleich an.
 */
function apkVersion() {
  const datei = apkPath();
  if (!datei) return null;
  try {
    const v = readFileSync(datei + ".version", "utf8").trim();
    return /^[\d.]+$/.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Pruefsumme der hinterlegten App-Datei (SHA-256).
 *
 * WOZU: Am Fernseher meldet Android bei einer unvollstaendig geladenen Datei
 * nur "Problem beim Parsen des Pakets" und nennt keinen Grund. Mit einer
 * veroeffentlichten Pruefsumme laesst sich in zehn Sekunden feststellen, ob
 * ueberhaupt dieselbe Datei angekommen ist — statt im Dunkeln zu suchen.
 *
 * Die Summe wird beim Hochladen einmal berechnet und daneben abgelegt. Fehlt
 * sie (Datei von Hand kopiert), wird sie beim ersten Abruf nachgeholt: bei
 * 60 MB dauert das den Bruchteil einer Sekunde, danach steht sie in der Datei.
 */
function apkHash() {
  const datei = apkPath();
  if (!datei) return null;
  try {
    const h = readFileSync(datei + ".sha256", "utf8").trim();
    if (/^[0-9a-f]{64}$/.test(h)) return h;
  } catch { /* noch nicht berechnet — unten nachholen */ }
  try {
    const h = createHash("sha256").update(readFileSync(datei)).digest("hex");
    try { writeFileSync(datei + ".sha256", h); } catch { /* nur ein Zwischenspeicher */ }
    return h;
  } catch {
    return null;
  }
}

function apkPath() {
  const candidates = [
    join(process.env.DATA_DIR || "/data", "apk", "GHGFlix.apk"),
    join(process.env.DATA_DIR || "/data", "apk", "ghgflix.apk"),
    join(SERVER_ROOT, "apk", "GHGFlix.apk"),
  ];
  for (const f of candidates) {
    try {
      if (statSync(f).isFile()) return f;
    } catch {
      /* nicht da */
    }
  }
  // beliebige .apk im Daten-Ordner akzeptieren (falls anders benannt)
  try {
    const dir = join(process.env.DATA_DIR || "/data", "apk");
    const hit = readdirSync(dir).find((f) => f.toLowerCase().endsWith(".apk"));
    if (hit) return join(dir, hit);
  } catch {
    /* Ordner fehlt */
  }
  return null;
}

/**
 * Bilder für die EINFACHE API (Handy-App, TV-Browser): lokale Dateien
 * (poster.jpg/fanart.jpg neben dem Film) bzw. aus dem Video erzeugte
 * Standbilder haben Vorrang vor TMDb — sonst blieben dort Kacheln leer,
 * obwohl der Server längst ein Bild hat.
 */
function withArt(row) {
  if (!row) return row;
  const local = (v) => (v ? (isLocalRef(v) ? v : "local:" + v) : null);
  return {
    ...row,
    poster: local(row.local_poster) ?? row.poster ?? null,
    backdrop: local(row.local_backdrop) ?? row.backdrop ?? null,
    still: row.still ?? local(row.local_still) ?? null,
  };
}

/** progress rows in TMDb coordinates (the cross-device sync format). */
function progressAsTmdb(profileId, since = 0) {
  return db
    .prepare(
      `SELECT pr.media_type, pr.position, pr.duration, pr.watched, pr.updated_at,
              COALESCE(m.tmdb_id, s.tmdb_id) tmdb_id,
              COALESCE(e.season, -1) season, COALESCE(e.episode, -1) episode
       FROM progress pr
       LEFT JOIN movies m ON pr.media_type='movie' AND m.id = pr.ref_id
       LEFT JOIN episodes e ON pr.media_type='episode' AND e.id = pr.ref_id
       LEFT JOIN shows s ON s.id = e.show_id
       WHERE pr.profile_id = ? AND pr.updated_at > ? AND COALESCE(m.tmdb_id, s.tmdb_id) IS NOT NULL`,
    )
    .all(profileId, since);
}

async function upsertTmdbProgress(profileId, rows) {
  let applied = 0;
  for (const r of rows) {
    if (!r || !r.tmdbId || !["movie", "episode"].includes(r.mediaType)) continue;
    db.prepare(
      `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
         position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
       WHERE excluded.updated_at > pending_progress.updated_at`,
    ).run(
      profileId,
      r.mediaType,
      r.tmdbId,
      r.season ?? -1,
      r.episode ?? -1,
      r.position ?? 0,
      r.duration ?? 0,
      r.watched ? 1 : 0,
      r.updatedAt ?? Date.now(),
    );
    applied++;
  }
  // resolve immediately for known media — awaited so the HTTP response only
  // returns once the rows are actually visible in `progress` (S-011: the old
  // fire-and-forget version raced against the client's next pull)
  const { applyPendingProgress } = await import("./scanner.js");
  applyPendingProgress(db);
  return applied;
}

// ── static web UI ───────────────────────────────────────────────────────────
const STATIC_MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};
function serveStatic(res, urlPath) {
  let rel = urlPath === "/" ? "/index.html" : urlPath;
  let file = normalize(join(WEB_DIR, rel));
  if ((!file.startsWith(WEB_DIR) || !existsSync(file) || !statSync(file).isFile()) && WEB_DIR !== LEGACY_DIR) {
    const legacy = normalize(join(LEGACY_DIR, rel));
    if (legacy.startsWith(LEGACY_DIR) && existsSync(legacy) && statSync(legacy).isFile()) file = legacy;
  }
  if ((!file.startsWith(WEB_DIR) && !file.startsWith(LEGACY_DIR)) || !existsSync(file) || !statSync(file).isFile()) {
    // SPA-Rückfall
    const index = join(WEB_DIR, "index.html");
    if (!existsSync(index)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Weboberfläche nicht gefunden (webapp/index.html fehlt im Image)");
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    const st = createReadStream(index);
    st.on("error", () => res.end());
    st.pipe(res);
    return;
  }
  res.writeHead(200, {
    "Content-Type": STATIC_MIME[extname(file)] || "application/octet-stream",
    "Cache-Control": rel === "/index.html" ? "no-cache" : "public, max-age=3600",
  });
  createReadStream(file).pipe(res);
}

// ── request handling ────────────────────────────────────────────────────────
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  res.setHeader("Access-Control-Allow-Origin", "*"); // desktop app + Expo dev
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  // SRV-034: Basis-Sicherheitsheader für die Web-Oberfläche
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  /* URSACHE VON "Fehler 153" IN DER YOUTUBE-EINBETTUNG — nicht zurückdrehen:
     Hier stand `no-referrer`. Damit schickt der Browser beim Laden des
     YouTube-<iframe> KEINEN Referer-Header. YouTube verweigert die
     Einbettung dann mit "Fehler 153 – Fehler bei der Konfiguration des
     Videoplayers", weil es nicht feststellen kann, wer da einbettet.

     `strict-origin-when-cross-origin` ist der heutige Browser-Standard:
     fremde Seiten bekommen NUR den Ursprung (kein Pfad, keine Parameter,
     also auch kein Token), und bei einem Rückschritt von https auf http gar
     nichts. Der Datenschutz-Gewinn von `no-referrer` gegenüber dieser
     Einstellung ist minimal — der Preis war ein kaputter Trailer. */
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  if (req.method === "OPTIONS") return res.writeHead(204).end();

  // ── App-Verteilung: Installationsseite + APK-Download ──────────────────────
  // Bewusst OHNE Anmeldung erreichbar: am Fernseher tippt man die Adresse in
  // die "Downloader"-App ein, die kein Login-Formular anzeigen kann.
  if (p === "/app" || p === "/install") {
    const file = join(LEGACY_DIR, "install.html");
    if (!existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
    return createReadStream(file).pipe(res);
  }
  if (p === "/apk" || p === "/GHGFlix.apk" || p === "/ghgflix.apk") {
    const file = apkPath();
    if (!file) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Noch keine App-Datei hinterlegt. Anleitung: " + "/app");
    }
    const st = statSync(file);
    res.writeHead(200, {
      "Content-Type": "application/vnd.android.package-archive",
      "Content-Length": st.size,
      "Content-Disposition": 'attachment; filename="GHGFlix.apk"',
      "Cache-Control": "no-cache",
    });
    return createReadStream(file).pipe(res);
  }
  if (p === "/api/apk/status") {
    const file = apkPath();
    if (!file) return json(res, { available: false, canUpload: !!password() });
    const st = statSync(file);
    return json(res, {
      available: true,
      version: apkVersion(),
      sizeMb: (st.size / 1024 / 1024).toFixed(1),
      bytes: st.size,
      sha256: apkHash(),
      modified: new Date(st.mtimeMs).toLocaleDateString("de-DE"),
      url: "/apk",
      canUpload: !!password(),
    });
  }
  /* ── Kopplung: Zugang ohne Tippen am Fernseher ───────────────────────
     Der Fernseher holt sich einen Code, zeigt ihn als QR-Code, das Handy
     scannt ihn und gibt das Passwort ein. Details in src/koppeln.js.
     Diese drei Endpunkte liegen bewusst VOR der Token-Pruefung — sie sind
     ja gerade dafuer da, ein Token zu bekommen.

     ACHTUNG: Diese drei Blöcke steckten bis 07/2026 versehentlich INNERHALB
     des /api/apk-Blocks. Eine Anfrage kann nie gleichzeitig /api/apk UND
     /api/pair/start sein — die Kopplung war dadurch über HTTP nie
     erreichbar, obwohl koppeln.js für sich getestet war und die Funktion
     als fertig gemeldet wurde. Nicht wieder hineinschieben:
     test/routen.test.mjs prüft genau diese Erreichbarkeit. */
  if (p === "/api/pair/start" && req.method === "POST") {
    if (!password()) return json(res, { error: "Ohne Server-Passwort ist keine Kopplung noetig." }, 400);
    const body = await readBody(req).catch(() => ({}));
    const vorgang = starteKopplung(body?.geraet || "Fernseher");
    if (!vorgang) return json(res, { error: "Kein Code frei — kurz warten." }, 503);
    return json(res, vorgang);
  }

  if (p === "/api/pair/check") {
    const ergebnis = pruefeKopplung(url.searchParams.get("code"));
    return json(res, ergebnis);
  }

  /* Die Seite, die das Handy nach dem Scannen oeffnet. */
  if (p === "/koppeln") {
    if (req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const code = String(body.code || "").toUpperCase().trim();
      const pw = String(body.passwort ?? body.password ?? "");
      const html = (o) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(kopplungsSeite(o));
      };
      if (!password()) return html({ code, meldung: "Dieser Server hat kein Passwort — der Fernseher kommt auch so hinein." });
      if (pw !== password()) return html({ code, meldung: "Falsches Passwort." });
      const t = randomBytes(24).toString("hex");
      tokens.set(t, Date.now());
      saveTokens();
      if (!loeseKopplungEin(code, t)) {
        return html({ code, meldung: "Dieser Code ist abgelaufen. Am Fernseher einen neuen anzeigen lassen." });
      }
      console.log(`[koppeln] Fernseher freigeschaltet (Code ${code})`);
      return html({ fertig: true });
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(kopplungsSeite({ code: String(url.searchParams.get("code") || "").toUpperCase() }));
  }

  // App-Datei vom PC hochladen — spart das Herumschieben im Datei-Manager.
  // NUR mit gesetztem Server-Passwort UND gültigem Token: ohne Passwort wäre
  // das ein offenes Tor, um eine Datei auf dem NAS abzulegen.
  if (p === "/api/apk" && req.method === "POST") {
    if (!password()) {
      return json(res, { error: "Hochladen nur mit gesetztem Server-Passwort (GHGFLIX_PASSWORD)." }, 403);
    }
    if (!authed(req, url)) return json(res, { error: "unauthorized" }, 401);
    const dir = join(process.env.DATA_DIR || "/data", "apk");
    const target = join(dir, "GHGFlix.apk");
    const tmp = target + ".teil";
    try {
      mkdirSync(dir, { recursive: true });
    } catch (e) {
      return json(res, { error: "Ordner nicht anlegbar: " + String(e.message || e) }, 500);
    }
    return new Promise((resolve) => {
      let bytes = 0;
      let magicOk = null;
      const out = createWriteStream(tmp);
      const abbruch = (msg, code = 400) => {
        try {
          out.destroy();
          rmSync(tmp, { force: true });
        } catch { /* egal */ }
        req.destroy();
        json(res, { error: msg }, code);
        resolve();
      };
      req.on("data", (chunk) => {
        // Eine APK ist ein ZIP: die ersten beiden Bytes sind "PK".
        if (magicOk === null && chunk.length >= 2) {
          magicOk = chunk[0] === 0x50 && chunk[1] === 0x4b;
          if (!magicOk) return abbruch("Das ist keine APK-Datei (ZIP-Kennung fehlt).");
        }
        bytes += chunk.length;
        if (bytes > 500 * 1024 * 1024) return abbruch("Datei zu groß (max. 500 MB).", 413);
      });
      req.on("error", () => abbruch("Übertragung abgebrochen.", 400));
      req.pipe(out);
      out.on("finish", () => {
        if (bytes < 1024) return abbruch("Datei ist leer.");
        try {
          renameSync(tmp, target);
        } catch (e) {
          return abbruch("Speichern fehlgeschlagen: " + String(e.message || e), 500);
        }
        /* Versionsnummer daneben ablegen, damit die Apps vergleichen koennen,
           ob sich das Herunterladen ueberhaupt lohnt. Sie kommt vom
           Upload-Skript als ?version=3.1.0 mit. */
        const version = String(url.searchParams.get("version") || "").trim();
        try {
          if (/^[\d.]+$/.test(version)) writeFileSync(target + ".version", version);
          else rmSync(target + ".version", { force: true });
        } catch { /* nicht schlimm - dann eben ohne Versionsvergleich */ }

        /* Pruefsumme neu berechnen und daneben legen. Wichtig: die ALTE Summe
           muss vorher weg, sonst gehoert sie zur vorigen Datei und wuerde
           faelschlich einen Uebertragungsfehler melden. */
        try {
          rmSync(target + ".sha256", { force: true });
          writeFileSync(target + ".sha256", createHash("sha256").update(readFileSync(target)).digest("hex"));
        } catch { /* dann wird sie beim ersten Abruf nachgeholt */ }

        console.log(`[apk] neue App-Datei abgelegt (${(bytes / 1024 / 1024).toFixed(1)} MB${version ? ", Version " + version : ""})`);
        json(res, { ok: true, version: version || null, sizeMb: (bytes / 1024 / 1024).toFixed(1), url: "/apk" });
        resolve();
      });
    });
  }

  if (!p.startsWith("/api/")) return serveStatic(res, p);

  // open endpoints (needed for auto-discovery + login)
  if (p === "/api/ping") {
    return json(res, {
      ok: true,
      app: "ghgflix-server",
      version: VERSION,
      name: getSetting("server_name") || "GHGFlix",
      id: SERVER_ID, // ARCH-16 (stable installation ID for cursor keys, S-017)
      auth: !!password(),
      time: Date.now(),
    });
  }
  if (p === "/api/login" && req.method === "POST") {
    const ip = req.socket.remoteAddress || "?";
    const rl = loginFails.get(ip);
    if (rl && rl.until > Date.now()) {
      return json(res, { error: "Zu viele Fehlversuche — bitte 5 Minuten warten" }, 429);
    }
    const body = await readBody(req);
    if (!password()) return json(res, { token: null, auth: false });
    if (body.password !== password()) {
      const f = { n: (rl?.n ?? 0) + 1, until: 0 };
      if (f.n >= 8) {
        f.until = Date.now() + 5 * 60_000;
        f.n = 0;
      }
      loginFails.set(ip, f);
      return json(res, { error: "Falsches Passwort" }, 401);
    }
    loginFails.delete(ip);
    const t = randomBytes(24).toString("hex");
    tokens.set(t, Date.now());
    saveTokens();
    return json(res, { token: t });
  }

  if (!authed(req, url)) return json(res, { error: "unauthorized" }, 401);

  const profileId = parseInt(url.searchParams.get("profile") || "1", 10);

  // ── library ──
  if (p === "/api/library") {
    // CASE WHEN e.season > 0: Specials (Staffel 0) sind keine eigene Staffel.
    // Siehe Erklaerung in invoke.js/showOut.
    const shows = db.prepare("SELECT s.*, COUNT(DISTINCT CASE WHEN e.season > 0 THEN e.season END) seasons, COUNT(e.id) episodes FROM shows s LEFT JOIN episodes e ON e.show_id=s.id GROUP BY s.id ORDER BY s.title").all();
    const movies = db.prepare("SELECT * FROM movies ORDER BY title").all();
    return json(res, { shows: shows.map(withArt), movies: movies.map(withArt) });
  }
  let m;
  if ((m = p.match(/^\/api\/shows\/(\d+)$/))) {
    const show = db.prepare("SELECT * FROM shows WHERE id = ?").get(+m[1]);
    if (!show) return json(res, { error: "not found" }, 404);
    const eps = db.prepare("SELECT * FROM episodes WHERE show_id = ? ORDER BY season, episode").all(show.id);
    const seasons = [];
    for (const e of eps) {
      let s = seasons.find((x) => x.season === e.season);
      if (!s) seasons.push((s = { season: e.season, episodes: [] }));
      s.episodes.push(withArt(e));
    }
    // Punkt 3: Kinofilme dieser Serie — die Handy-App zeigt sie als eigenen
    // Reiter neben den Staffeln und den Specials.
    const movies = serienfilme.fuerSerie(show, eps).map(withArt);
    return json(res, { show: withArt(show), seasons, movies });
  }
  if ((m = p.match(/^\/api\/movies\/(\d+)$/))) {
    const movie = db.prepare("SELECT * FROM movies WHERE id = ?").get(+m[1]);
    return movie ? json(res, withArt(movie)) : json(res, { error: "not found" }, 404);
  }

  // ── profiles ──
  if (p === "/api/profiles" && req.method === "GET") {
    return json(res, db.prepare("SELECT id, name, avatar FROM profiles ORDER BY id").all());
  }
  if (p === "/api/profiles" && req.method === "POST") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name) return json(res, { error: "name fehlt" }, 400);
    try {
      const info = db.prepare("INSERT INTO profiles (name, avatar, created_at) VALUES (?,?,?)").run(name, body.avatar ?? null, Date.now());
      return json(res, { id: Number(info.lastInsertRowid), name });
    } catch {
      return json(res, { error: "Profil existiert bereits" }, 409);
    }
  }

  // ── progress ──
  if (p === "/api/progress" && req.method === "GET") {
    return json(res, db.prepare("SELECT media_type mediaType, ref_id refId, position, duration, watched, updated_at updatedAt FROM progress WHERE profile_id = ?").all(profileId));
  }
  if (p === "/api/progress" && req.method === "POST") {
    const b = await readBody(req);
    if (!["movie", "episode"].includes(b.mediaType) || !b.refId) return json(res, { error: "bad payload" }, 400);
    db.prepare(
      `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
    ).run(profileId, b.mediaType, b.refId, b.position ?? 0, b.duration ?? 0, b.watched ? 1 : 0, Date.now());
    return json(res, { ok: true });
  }
  if (p === "/api/continue") {
    const rows = db
      .prepare(
        `SELECT pr.media_type mediaType, pr.ref_id refId, pr.position, pr.duration, pr.updated_at updatedAt,
                COALESCE(mv.title, sh.title) title, e.season, e.episode, e.title epTitle,
                COALESCE(mv.poster, sh.poster) poster, e.show_id showId, mv.backdrop mBackdrop, sh.backdrop sBackdrop, e.still still,
                COALESCE(mv.local_poster, sh.local_poster) local_poster,
                COALESCE(mv.local_backdrop, sh.local_backdrop) local_backdrop, e.local_still local_still
         FROM progress pr
         LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
         LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
         LEFT JOIN shows sh ON sh.id=e.show_id
         WHERE pr.profile_id=? AND pr.watched=0 AND pr.position > 30 AND pr.duration > 0
           AND COALESCE(mv.id, e.id) IS NOT NULL
         ORDER BY pr.updated_at DESC LIMIT 20`,
      )
      .all(profileId);
    return json(res, rows.map(withArt));
  }
  // "Zuletzt gesehen" — most recent progress rows (watched or in-progress)
  if (p === "/api/history") {
    const rows = db
      .prepare(
        `SELECT pr.media_type mediaType, pr.ref_id refId, pr.updated_at updatedAt,
                COALESCE(mv.title, sh.title) title, e.season, e.episode,
                COALESCE(mv.poster, sh.poster) poster, e.show_id showId, e.still still,
                mv.backdrop mBackdrop, sh.backdrop sBackdrop,
                COALESCE(mv.local_poster, sh.local_poster) local_poster,
                COALESCE(mv.local_backdrop, sh.local_backdrop) local_backdrop, e.local_still local_still
         FROM progress pr
         LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
         LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
         LEFT JOIN shows sh ON sh.id=e.show_id
         WHERE pr.profile_id=? AND COALESCE(mv.id, e.id) IS NOT NULL
         ORDER BY pr.updated_at DESC LIMIT 20`,
      )
      .all(profileId);
    return json(res, rows.map(withArt));
  }

  // ── favorites / Meine Liste ──
  if (p === "/api/favorites" && req.method === "GET") {
    return json(res, db.prepare("SELECT media_type mediaType, ref_id refId, added_at addedAt FROM favorites WHERE profile_id = ? ORDER BY added_at DESC").all(profileId));
  }
  if (p === "/api/favorites" && req.method === "POST") {
    const b = await readBody(req);
    if (!["movie", "show"].includes(b.mediaType) || !b.refId) return json(res, { error: "bad payload" }, 400);
    const existing = db.prepare("SELECT 1 FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").get(profileId, b.mediaType, b.refId);
    if (existing) {
      db.prepare("DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").run(profileId, b.mediaType, b.refId);
      return json(res, { favorite: false });
    }
    db.prepare("INSERT INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(profileId, b.mediaType, b.refId, Date.now());
    return json(res, { favorite: true });
  }
  // mark a whole movie/show (or single episode) watched / unwatched
  if (p === "/api/watched" && req.method === "POST") {
    const b = await readBody(req);
    const now = Date.now();
    const setOne = (mediaType, refId, dur) =>
      db.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,0,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      ).run(profileId, mediaType, refId, dur ?? 0, b.watched ? 1 : 0, now);
    if (b.mediaType === "movie") setOne("movie", b.refId, 0);
    else if (b.mediaType === "episode") setOne("episode", b.refId, 0);
    else if (b.mediaType === "show") {
      for (const e of db.prepare("SELECT id, duration FROM episodes WHERE show_id = ?").all(b.refId)) setOne("episode", e.id, e.duration);
    } else if (b.mediaType === "season") {
      for (const e of db.prepare("SELECT id, duration FROM episodes WHERE show_id = ? AND season = ?").all(b.refId, b.season)) setOne("episode", e.id, e.duration);
    } else return json(res, { error: "bad payload" }, 400);
    return json(res, { ok: true });
  }

  // ── sync (desktop app + phone, TMDb-keyed) ──
  if (p === "/api/sync/progress" && req.method === "GET") {
    const since = parseInt(url.searchParams.get("since") || "0", 10);
    return json(res, { now: Date.now(), rows: progressAsTmdb(profileId, since) });
  }
  if (p === "/api/sync/progress" && req.method === "POST") {
    const b = await readBody(req);
    const applied = await upsertTmdbProgress(profileId, Array.isArray(b.rows) ? b.rows : []);
    return json(res, { ok: true, applied });
  }

  // ── playback ──
  if ((m = p.match(/^\/api\/play\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return json(res, { error: "not found" }, 404);
    if (!row.vcodec) {
      const info = await ffprobe(row.path);
      if (info) Object.assign(row, info);
    }
    const token = url.searchParams.get("token");
    const tq = token ? `&token=${token}` : "";
    const direct = canDirectPlay(row);
    // Sprite-Blatt für die Vorschau schon mal im Hintergrund bauen lassen
    if (row.duration) ensureTrickplay(row.path, row.duration);

    /* Ton- und Untertitelspuren. Beim ersten Mal werden sie ermittelt und
       gespeichert; danach kommen sie ohne ffprobe aus der Datenbank. Findet
       sich nichts (Datei geloescht, ffprobe fehlt), bleiben die Listen leer
       und die Apps zeigen die Auswahl schlicht nicht an. */
    let spuren = spurenLaden(row);
    if (!spuren) {
      spuren = await alleSpuren(row.path);
      const tabelle = m[1] === "movie" ? "movies" : "episodes";
      spurenSpeichern(db, tabelle, row.id, spuren);
    }
    return json(res, {
      duration: row.duration,
      direct,
      vcodec: row.vcodec,
      acodec: row.acodec,
      width: row.width,
      height: row.height,
      aspect: row.aspect ?? (row.width && row.height ? row.width / row.height : null),
      directUrl: `/api/stream/${m[1]}/${row.id}?x=1${tq}`,
      transcodeUrl: `/api/transcode/${m[1]}/${row.id}?x=1${tq}`,
      /* Punkt 2: Apple-Geräte können das fragmentierte MP4 von
         /api/transcode nicht abspielen (schwarzes Bild). Für sie gibt es
         denselben Inhalt als HLS. `hlsPflicht` sagt dem Client, dass er
         diesen Weg nehmen MUSS — der Server erkennt das Gerät am User-Agent,
         der Client kann es aber auch selbst entscheiden. */
      hlsUrl: `/api/hls/${m[1]}/${row.id}/master.m3u8?x=1${tq}`,
      hlsPflicht: istAppleClient(req.headers["user-agent"]),
      trickplayUrl: trickplayInfo(row.path) ? `/api/trickplay?path=${encodeURIComponent(row.path)}${tq}` : null,
      trickplay: trickplayInfo(row.path),
      audioStreams: row.audioStreams ?? [],
      // Ton- und Untertitelspuren, aufbereitet fuer die Apps. Beim ersten
      // Abspielen einer Datei kostet das einen ffprobe-Aufruf, danach kommt
      // es aus der Datenbank.
      spuren,
      untertitelUrl: `/api/untertitel/${m[1]}/${row.id}?x=1${tq}`,
    });
  }
  /* ── Untertitel als WebVTT ───────────────────────────────────────────
     Die Apps zeichnen Untertitel selbst, statt sie ins Bild einbrennen zu
     lassen. Das hat drei Vorteile: kein erneutes Kodieren des Videos (Last
     auf dem NAS), sofortiges Umschalten, und Groesse sowie Farbe bleiben
     einstellbar. Geliefert wird deshalb reiner Text im WebVTT-Format.

     ?track=s0  eingebettete Spur Nummer 0
     ?track=d1  Untertiteldatei Nummer 1 neben dem Video            */
  if ((m = p.match(/^\/api\/untertitel\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return json(res, { error: "not found" }, 404);
    const kennung = String(url.searchParams.get("track") || "");

    let spuren = spurenLaden(row);
    if (!spuren) {
      spuren = await alleSpuren(row.path);
      spurenSpeichern(db, m[1] === "movie" ? "movies" : "episodes", row.id, spuren);
    }
    const spur = (spuren.sub || []).find((x) => x.id === kennung);
    if (!spur) return json(res, { error: "Diese Untertitelspur gibt es nicht" }, 404);
    if (spur.bild) {
      return json(res, { error: "Bild-Untertitel (PGS/VOBSUB) enthalten keinen Text" }, 415);
    }

    const vtt = spur.quelle === "datei"
      ? await dateiAlsVtt(spur.datei)
      : await eingebettetAlsVtt(row.path, spur.nr);

    if (!vtt) return json(res, { error: "Untertitel konnten nicht gelesen werden" }, 500);
    res.writeHead(200, {
      "Content-Type": "text/vtt; charset=utf-8",
      // Untertitel aendern sich nicht — einen Tag zwischenspeichern lassen
      "Cache-Control": "public, max-age=86400",
    });
    return res.end(vtt);
  }

  if ((m = p.match(/^\/api\/stream\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    return serveFile(req, res, row.path);
  }
  if ((m = p.match(/^\/api\/transcode\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    return serveTranscode(req, res, row, {
      start: parseFloat(url.searchParams.get("t") || "0") || 0,
      quality: url.searchParams.get("q") || "original",
      audioIndex: parseInt(url.searchParams.get("a") || "0", 10) || 0,
    });
  }
  /* ── HLS für Apple-Geräte (Punkt 2) ──────────────────────────────────
     Warum überhaupt: siehe Kopf von src/hls.js. Kurz — iOS spielt das
     fragmentierte MP4 von /api/transcode nicht ab, das Bild bleibt schwarz. */
  if ((m = p.match(/^\/api\/hls\/(movie|episode)\/(\d+)\/master\.m3u8$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    if (!row.vcodec) {
      const info = await ffprobe(row.path);
      if (info) Object.assign(row, info);
    }
    const token = url.searchParams.get("token");
    const tq = token ? `?token=${encodeURIComponent(token)}` : "";
    let s;
    try {
      s = sitzungStarten(row, {
        start: parseFloat(url.searchParams.get("t") || "0") || 0,
        quality: url.searchParams.get("q") || "original",
        audioIndex: parseInt(url.searchParams.get("a") || "0", 10) || 0,
      });
    } catch (e) {
      res.writeHead(e.code === 503 ? 503 : 500, {
        "Content-Type": "application/json; charset=utf-8",
        ...(e.code === 503 ? { "Retry-After": "10" } : {}),
      });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
    res.writeHead(200, {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Cache-Control": "no-store",
      // wie beim MP4-Weg: der Client kennt damit den Versatz des Datenstroms
      "X-GHG-Stream-Start": String(s.start),
    });
    return res.end(masterPlaylist(s, tq));
  }
  if ((m = p.match(/^\/api\/hls\/s\/([a-f0-9]+)\/index\.m3u8$/))) {
    const s = sitzung(m[1]);
    if (!s) return res.writeHead(404).end("Sitzung abgelaufen");
    const token = url.searchParams.get("token");
    const tq = token ? `?token=${encodeURIComponent(token)}` : "";
    try {
      const liste = await haeppchenListe(s, tq);
      res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" });
      return res.end(liste);
    } catch (e) {
      res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify({ error: String(e.message || e) }));
    }
  }
  if ((m = p.match(/^\/api\/hls\/s\/([a-f0-9]+)\/([^/]+)$/))) {
    const s = sitzung(m[1]);
    if (!s) return res.writeHead(404).end("Sitzung abgelaufen");
    return haeppchenSenden(res, s, m[2]);
  }

  if ((m = p.match(/^\/api\/thumb\/(movie|episode)\/(\d+)$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    const at = row.duration ? Math.min(row.duration * 0.25, 420) : 300;
    // über den Plattencache statt bei jedem Aufruf erneut ffmpeg zu starten
    const file = await makeThumb(row.path, Math.round(at), 480);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" });
    return createReadStream(file).pipe(res);
  }

  // ── desktop-app command surface (the web UI runs the SAME React app as the
  //    Windows app; src/lib/backend.ts routes every Tauri invoke() here) ──
  if ((m = p.match(/^\/api\/invoke\/([a-z0-9_]+)$/)) && req.method === "POST") {
    const args = await readBody(req);
    try {
      // Token durchreichen, damit Kommandos Bild-URLs bauen können, die ein
      // <img>-Tag auch bei gesetztem Passwort laden darf (kann keine Header).
      args.__token = bearerToken(req, url);
      const result = await handleInvoke(m[1], args);
      return json(res, { result: result === undefined ? null : result });
    } catch (e) {
      return json(res, { error: String(e?.message || e) }, 400);
    }
  }
  // Einzelbild für die Zeitleisten-Vorschau (erzeugt + gecacht)
  if (p === "/api/thumbfile") {
    const path = url.searchParams.get("path") || "";
    if (!isLibraryFile(path)) return json(res, { error: "unbekannte Datei" }, 403);
    const t = parseInt(url.searchParams.get("t") || "0", 10) || 0;
    const w = Math.min(960, Math.max(80, parseInt(url.searchParams.get("w") || "320", 10) || 320));
    const file = await makeThumb(path, t, w);
    if (!file) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=604800" });
    return createReadStream(file).pipe(res);
  }
  // Sprite-Blatt (Trickplay): EIN Bild mit allen Vorschaupositionen
  if (p === "/api/trickplay") {
    const path = url.searchParams.get("path") || "";
    if (!isLibraryFile(path)) return json(res, { error: "unbekannte Datei" }, 403);
    const info = trickplayInfo(path);
    if (!info) return res.writeHead(404).end();
    const file = join(TRICK_DIR, info.file);
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=2592000, immutable" });
    return createReadStream(file).pipe(res);
  }
  // embedded text subtitles → WebVTT (browsers can only render VTT)
  if ((m = p.match(/^\/api\/subs\/(movie|episode)\/(\d+)\/(\d+)\.vtt$/))) {
    const row = mediaRow(m[1], +m[2]);
    if (!row) return res.writeHead(404).end();
    const ff = spawn(process.env.FFMPEG_PATH || "ffmpeg", [
      "-hide_banner", "-loglevel", "error",
      "-i", row.path, "-map", `0:s:${+m[3]}?`, "-f", "webvtt", "pipe:1",
    ]);
    res.writeHead(200, { "Content-Type": "text/vtt; charset=utf-8", "Cache-Control": "public, max-age=86400" });
    ff.stdout.pipe(res);
    ff.on("error", () => res.end());
    req.on("close", () => { try { ff.kill("SIGKILL"); } catch {} });
    return;
  }

  // ── Bilder (TMDb-Proxy mit Cache + lokale Dateien wie bei Plex/Jellyfin) ──
  if (p === "/api/img") {
    const raw = url.searchParams.get("path") || "";
    // "local:<Pfad>" = Bilddatei, die neben dem Film/der Serie auf der Platte
    // liegt (poster.jpg, fanart.jpg, aus dem Video geschnittenes Standbild …)
    if (isLocalRef(raw)) {
      const file = localRefPath(raw);
      if (!file || !isAllowedImage(file)) return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": imageMime(file), "Cache-Control": "public, max-age=604800" });
      return createReadStream(file).pipe(res);
    }
    const stream = await cachedImage(raw, url.searchParams.get("size") || "w342");
    if (!stream) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=2592000" });
    return stream.pipe(res);
  }

  // ── libraries (Einstellungen → Bibliotheken: beliebig viele Ordner/Platten) ──
  if (p === "/api/libraries" && req.method === "GET") {
    return json(res, listLibraries());
  }
  if (p === "/api/libraries" && req.method === "POST") {
    const b = await readBody(req);
    const path = String(b.path || "").trim();
    const kind = b.kind === "movie" ? "movie" : "show";
    if (!path) return json(res, { error: "Pfad fehlt" }, 400);
    if (!existsSync(path) || !statSync(path).isDirectory()) {
      return json(res, { error: "Dieser Ordner ist im Server-Container nicht sichtbar. Ist die Festplatte im docker-compose gemountet?" }, 400);
    }
    const lib = addLibrary(path, kind, b.name || null);
    void scanLibrary();
    return json(res, lib);
  }
  if ((m = p.match(/^\/api\/libraries\/(\d+)$/)) && req.method === "DELETE") {
    const lib = removeLibrary(+m[1]);
    if (lib) removeLibraryContent(lib.path, lib.kind);
    return json(res, { ok: true });
  }
  // Browse the container-visible filesystem so folders can be picked by
  // clicking instead of typing paths blind — mirrors the desktop app's
  // folder picker. With the whole host mounted at /host, this lets the user
  // navigate their ENTIRE ZimaOS and find media wherever it really lives.
  // System folders (proc, sys, AppData, …) are hidden.
  if (p === "/api/browse") {
    const root = primaryRoot();
    let target = url.searchParams.get("path");
    if (!target || target === "roots") target = root; // start at the real root
    // SICHERHEIT: nur innerhalb der erlaubten Wurzeln stöbern. Vorher wurde
    // JEDER absolute Pfad ausgeliefert (z. B. ?path=/etc).
    if (!withinBrowseRoots(target)) return json(res, { error: "Pfad außerhalb der erlaubten Ordner" }, 403);
    let entries;
    try {
      entries = readdirSync(target, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !isSystemDir(e.name))
        .map((e) => ({ name: e.name, path: join(target, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name, "de"));
    } catch (e) {
      return json(res, { error: "Ordner nicht lesbar: " + String(e.message || e) }, 400);
    }
    // never navigate above the browse root
    const atRoot = normalize(target) === normalize(root);
    const parent = atRoot ? null : normalize(join(target, ".."));
    return json(res, { path: target, root, parent, entries });
  }
  // Auto-detect media library folders across all mounted drives.
  if (p === "/api/detect") {
    return json(res, { found: detectLibraries() });
  }

  // ── scan ──
  if (p === "/api/scan" && req.method === "POST") {
    void scanLibrary();
    return json(res, { started: true });
  }
  if (p === "/api/scan/status") return json(res, { ...scanState, tmdb: tmdbEnabled() });

  // ── settings (server-side) ──
  // SEC-002: the service-role key is NEVER echoed back — only `supabase_key_set`,
  // mirroring the existing tmdb_key_set pattern.
  if (p === "/api/settings" && req.method === "GET") {
    return json(res, {
      server_name: getSetting("server_name") || "GHGFlix",
      tmdb_key_set: tmdbEnabled(),
      password_set: !!password(),
      supabase_configured: supabase.supabaseConfigured(),
      supabase_url: settingOr("supabase_url", "SUPABASE_URL", ""),
      supabase_key_set: !!settingOr("supabase_key", "SUPABASE_SERVICE_KEY", ""),
      supabase_user_id: settingOr("supabase_user_id", "SUPABASE_USER_ID", ""),
      supabase_push: getSetting("supabase_push") !== "off",
      supabase_pull: getSetting("supabase_pull") !== "off",
      supabase_status: supabase.supabaseStatus(),
    });
  }
  if (p === "/api/settings" && req.method === "POST") {
    const b = await readBody(req);
    const allowed = ["server_name", "tmdb_key", "tmdb_lang", "password", "supabase_url", "supabase_key", "supabase_user_id", "supabase_push", "supabase_pull"];
    for (const k of allowed) {
      if (!(k in b)) continue;
      // S-021: an empty value DELETES the row so a docker-compose env var
      // (SUPABASE_SERVICE_KEY, …) becomes visible again instead of being
      // masked by an empty-string setting.
      if (String(b[k]) === "") db.prepare("DELETE FROM settings WHERE key = ?").run(k);
      else setSetting(k, String(b[k]));
    }
    return json(res, { ok: true });
  }
  // SEC-004: "Alle Geräte abmelden" — invalidiert JEDES gespeicherte Token
  // (verlorenes Handy / verkaufter TV-Stick), ohne das Passwort zu ändern.
  if (p === "/api/logout_all" && req.method === "POST") {
    tokens.clear();
    saveTokens();
    return json(res, { ok: true });
  }
  if (p === "/api/supabase/import" && req.method === "POST") {
    try {
      const r = await supabase.importFromSupabase();
      return json(res, { ok: true, ...r });
    } catch (e) {
      return json(res, { error: String(e.message || e) }, 400);
    }
  }

  return json(res, { error: "not found" }, 404);
}

const server = createServer((req, res) => {
  handle(req, res).catch((e) => {
    console.error("[http]", req.url, e);
    if (!res.headersSent) json(res, { error: "server error" }, 500);
    else res.end();
  });
});
server.listen(PORT, () => {
  console.log(`GHGFlix Server v${VERSION} → http://0.0.0.0:${PORT}`);
});

// SRV-005: graceful shutdown — laufende ffmpeg-Prozesse sauber beenden, bevor
// Docker den Container stoppt (Update mitten in einer Wiedergabe).
const shutdown = (sig) => {
  console.log(`[server] ${sig} — fahre herunter`);
  try {
    server.close();
  } catch {}
  alleHlsBeenden(); // beendet die HLS-ffmpegs und räumt deren Temp-Ordner weg
  killAllTranscodes();
  setTimeout(() => process.exit(0), 400).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// initial scan + periodic rescan (default: every 30 min) + Supabase loop
void scanLibrary();
const every = Math.max(300, parseInt(process.env.SCAN_INTERVAL_SEC || "1800", 10)) * 1000;
setInterval(() => void scanLibrary(), every).unref();
supabase.startSupabaseLoop();

/* ── Kanäle & Feeds (Punkt 5) ──────────────────────────────────────────────
   Abonnierte YouTube-Kanäle und Blogs regelmäßig abholen. Der Server macht
   das, damit die Benachrichtigung auch dann ankommt, wenn gerade niemand die
   Oberfläche offen hat — beim nächsten Öffnen steht die Zahl da.
   Standard 30 Minuten; YouTubes Atom-Feed hat kein Kontingent, öfter wäre
   trotzdem nur unnötiger Verkehr. */
const feedTakt = Math.max(300, parseInt(process.env.FEED_INTERVAL_SEC || "1800", 10)) * 1000;
const feedsAbholen = () =>
  void kanaele
    .abholen()
    .then((neu) => {
      if (neu.length > 0) console.log(`[feeds] ${neu.length} neue Beiträge`);
    })
    .catch((e) => console.warn("[feeds]", String(e)));
// Erster Abruf 20 s nach dem Start — nicht sofort, damit der Boot nicht auf
// externe Server wartet.
setTimeout(feedsAbholen, 20_000).unref();
setInterval(feedsAbholen, feedTakt).unref();

// S-030: pending_progress nicht unbegrenzt wachsen lassen — Einträge, die nach
// 180 Tagen immer noch keinem Medium zugeordnet werden konnten (Medien, die es
// auf diesem Server schlicht nicht gibt), täglich aufräumen.
setInterval(() => {
  try {
    const r = db.prepare("DELETE FROM pending_progress WHERE updated_at < ?").run(Date.now() - 180 * 24 * 3600 * 1000);
    if (r.changes > 0) console.log(`[cleanup] ${r.changes} alte pending_progress-Einträge entfernt`);
  } catch {}
}, 24 * 3600 * 1000).unref();

// Vorschaubild-Cache begrenzen (Standard 512 MB, THUMB_CACHE_MB). Ohne das
// wuchs thumb-cache/ unbegrenzt — auf einem NAS mit kleiner Systemplatte ein
// echtes Problem. Einmal kurz nach dem Start, danach stündlich.
setTimeout(() => pruneThumbCache(), 60_000).unref();
setInterval(() => pruneThumbCache(), 3600_000).unref();

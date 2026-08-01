// ============================================================================
// GHGFlix Server — Bibliotheks-Scanner
//
// Nachbau der Desktop-Logik aus `src-tauri/src/scanner.rs`, damit Server und
// Windows-App EXAKT dieselbe Bibliothek sehen:
//
//   1. INDIZIEREN   rekursiv laufen, Dateien erkennen, Serien über einen
//                   stabilen Schlüssel gruppieren (alle Staffeln = eine Serie),
//                   Sample-/Trailer-Schnipsel überspringen, manuelle
//                   Platzierungen ("diese Datei ist S02E05") immer anwenden.
//   2. ZUORDNEN     gemerkte manuelle Zuordnungen zuerst, dann TMDb-Suche mit
//                   Rückfallebenen und Treffer-Bewertung (nicht mehr blind das
//                   erste Suchergebnis).
//   3. BILDER       lokale poster.jpg/fanart.jpg (Plex/Jellyfin) vor TMDb,
//                   fehlende Folgenbilder per ffmpeg aus dem Video schneiden.
//   4. TECHNIK      Auflösung/Codecs lesen (Direct-Play-Entscheidung).
//   5. AUFRÄUMEN    verschwundene Dateien entfernen — aber NIEMALS von einer
//                   gerade nicht erreichbaren Platte.
// ============================================================================
import { readdirSync, statSync } from "node:fs";
import { join, basename, dirname, relative, sep } from "node:path";
import {
  openDb, listLibraries, showIdForKey, setShowKeyIfAbsent, keysForShow, moveShowKeys, identityOverride,
  rememberIdentityKey, placementFor, getSetting, setSetting,
} from "./db.js";
import {
  isVideo, isJunkClip, isExtrasDir, fileStem, parseEpisode, parseSeasonFromDir, isPureSeasonDir,
  parseTitleYear, cleanShowTitle, showKey, movieKey, episodeTitleFromFile, providerId,
  isJunkTitle, isSiteDir, isGenericDir, stripDomainSuffix,
} from "./parser.js";
import { ffprobe } from "./stream.js";
import * as tmdb from "./tmdb.js";
import { findLocalArtwork, findSeasonArtwork, readNfo, asLocalRef, isLocalRef } from "./artwork.js";
import { makeStill } from "./thumbs.js";

export const scanState = {
  running: false, lastRun: 0, lastResult: "", shows: 0, movies: 0, episodes: 0,
  // Live-Fortschritt für die Oberfläche (Scan-Banner + Maskottchen)
  stage: "", message: "", current: 0, total: 0,
};

const setStage = (stage, message, current = 0, total = 0) => {
  scanState.stage = stage;
  scanState.message = message;
  scanState.current = current;
  scanState.total = total;
};

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

// Die Wurzeln, von denen aus der Ordner-Browser und die automatische Erkennung
// starten. Ist das gesamte Host-Dateisystem read-only unter /host eingebunden
// (empfohlen, siehe docker-compose), findet der Nutzer ALLES.
export const BROWSE_ROOTS = (process.env.BROWSE_ROOTS || "/host,/media,/DATA,/mnt")
  .split(/[;,]/)
  .map((s) => s.trim())
  .filter(Boolean);

// System-/Rauschordner, die weder angezeigt noch gescannt werden.
const SKIP_DIRS = new Set([
  "proc", "sys", "dev", "run", "boot", "tmp", "var", "etc", "usr", "bin", "sbin",
  "lib", "lib64", "opt", "root", "srv", "snap", "lost+found", "node_modules",
  "@eaDir", "$RECYCLE.BIN", "System Volume Information", "AppData", "appdata",
  ".git", ".cache", ".Trash", "#recycle", "BDMV", "CERTIFICATE", "VIDEO_TS", "AUDIO_TS",
]);
const skip = (name) => SKIP_DIRS.has(name) || name.startsWith(".");
export const isSystemDir = skip;

export function primaryRoot() {
  for (const r of BROWSE_ROOTS) {
    try {
      if (statSync(r).isDirectory()) return r;
    } catch {
      /* nicht eingebunden */
    }
  }
  return "/";
}

// ── Bibliotheks-Erkennung ───────────────────────────────────────────────────

const MOVIE_WORDS = /\b(movies?|filme?|film|cinema|kino|spielfilme?)\b/i;
const SHOW_WORDS = /\b(series|serien?|tv[- ]?shows?|shows?|tv|staffeln?|episodes?|folgen)\b/i;

/** Sieht dieser Ordner (eine Ebene tiefer) nach Folgen aus? */
function looksLikeShowRoot(dir) {
  for (const e of listDir(dir).slice(0, 40)) {
    if (!e.isDirectory()) continue;
    const sub = join(dir, e.name);
    for (const f of listDir(sub).slice(0, 30)) {
      if (f.isFile() && isVideo(f.name) && parseEpisode(fileStem(f.name), e.name)) return true;
      if (f.isDirectory() && isPureSeasonDir(f.name)) return true;
    }
  }
  return false;
}

/** Liegen hier direkt Filme (oder "Film (Jahr)"-Ordner)? */
function looksLikeMovieRoot(dir, minHits = 2) {
  let hits = 0;
  for (const e of listDir(dir).slice(0, 60)) {
    if (e.isFile() && isVideo(e.name) && !isJunkClip(fileStem(e.name))) hits++;
    else if (e.isDirectory() && /\((19|20)\d{2}\)/.test(e.name)) hits++;
    if (hits >= minHits) return true;
  }
  return false;
}

/** Medienordner über alle eingehängten Platten erraten. */
export function detectLibraries() {
  const existing = new Set(listLibraries().map((l) => l.path.replace(/\\/g, "/").replace(/\/+$/, "")));
  const found = [];
  const seen = new Set();
  const add = (path, kind) => {
    const norm = path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (seen.has(norm) || existing.has(norm)) return;
    if ([...seen].some((p) => norm.startsWith(p + "/"))) return;
    seen.add(norm);
    found.push({ path: norm, kind, name: norm.split("/").pop() || norm });
  };

  let visited = 0;
  const walk = (dir, depth) => {
    if (depth > 5 || visited > 4000) return;
    for (const e of listDir(dir)) {
      if (!e.isDirectory() || skip(e.name)) continue;
      visited++;
      const p = join(dir, e.name);
      if (MOVIE_WORDS.test(e.name) && looksLikeMovieRoot(p, 1)) add(p, "movie");
      else if (SHOW_WORDS.test(e.name) && looksLikeShowRoot(p)) add(p, "show");
      else if (looksLikeShowRoot(p)) add(p, "show");
      else if (looksLikeMovieRoot(p, 2)) add(p, "movie");
      else walk(p, depth + 1);
    }
  };
  const roots = BROWSE_ROOTS.filter((r, i, a) => a.indexOf(r) === i);
  for (const root of roots) {
    try {
      if (!statSync(root).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(root, 0);
  }
  return found;
}

// ── rekursiver Datei-Walk (Ersatz für WalkDir) ──────────────────────────────

const MIN_VIDEO_BYTES = Math.max(0, parseInt(process.env.MIN_VIDEO_MB || "1", 10) || 1) * 1024 * 1024;

/* Im Auswahl-Fenster abgelehnte Dateien (Punkt 1 der Übergabe).
   Bewusst hier direkt aus den Einstellungen gelesen statt aus ordnerwahl.js
   importiert — sonst würden sich die beiden Module gegenseitig importieren.
   Ohne diese Prüfung wäre jede Ablehnung beim nächsten Scan wieder aufgehoben. */
function ignorierteDateien() {
  try {
    const arr = JSON.parse(getSetting("ignored_files") || "[]");
    return new Set(
      (Array.isArray(arr) ? arr : []).map((p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()),
    );
  } catch {
    return new Set();
  }
}

/* Dateien, die der Nutzer per "Ist ein Film" aus einer Serie herausgelöst hat
   (Punkt 3, Nachbesserung). Sie stehen bereits in der movies-Tabelle — ohne
   diese Liste würde der nächste Scan sie als Serienfolge wieder aufnehmen. */
function filmUeberschreibungen() {
  try {
    const arr = JSON.parse(getSetting("movie_override_files") || "[]");
    return new Set(
      (Array.isArray(arr) ? arr : []).map((p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()),
    );
  } catch {
    return new Set();
  }
}

function* walkVideos(root, maxDepth = 8) {
  const ignoriert = ignorierteDateien();
  const filmUeb = filmUeberschreibungen();
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    for (const e of listDir(dir)) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= maxDepth || skip(e.name) || isExtrasDir(e.name)) continue;
        stack.push({ dir: p, depth: depth + 1 });
      } else if (e.isFile() && isVideo(e.name)) {
        const stem = fileStem(e.name);
        if (isJunkClip(stem)) continue;
        const norm = p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
        if (ignoriert.size && ignoriert.has(norm)) continue;
        if (filmUeb.size && filmUeb.has(norm)) continue;
        // Winzige Dateien sind fast immer Reste/Werbeschnipsel. Bewusst NIEDRIG
        // (1 MB), damit kurze Zeichentrickfolgen oder 240p-Rips nicht verschwinden.
        try {
          if (statSync(p).size < MIN_VIDEO_BYTES) continue;
        } catch {
          continue;
        }
        yield { path: p, name: e.name, stem, dir };
      }
    }
  }
}

/**
 * Der Ordnername, unter dem eine Serie gruppiert wird — Port von
 * show_source_name(): normalerweise die erste Ebene unter der Bibliothek
 * ("root/Serie/Staffel 1/datei"). Ist diese erste Ebene aber SELBST nur ein
 * Staffelordner (der Nutzer hat den Serienordner direkt als Bibliothek
 * hinzugefügt), zählt der Name der Bibliothek selbst.
 */
function showSourceName(root, filePath) {
  const rel = relative(root, filePath);
  const comps = rel.split(sep).filter(Boolean);
  if (comps.length >= 2) {
    let first = comps[0];

    /* Nichtssagender Ordnername („Downloads", „Videos", „Neuer Ordner")?
       Dann steht der echte Titel eine Ebene HÖHER — also im Namen der
       Bibliothek selbst bzw. deren Elternordner.

       Gemessen am 01.08.2026:
         Websites Download\miraculous to\Downloads\Staffel 1\101 - ….mp4
       Als Bibliothek war „…\miraculous to" eingetragen, damit hieß die Serie
       „Downloads" — 90 Folgen, von TMDb nie zu finden. Mit dieser Prüfung
       heißt sie „miraculous to" → nach stripDomainSuffix „miraculous". */
    if (isGenericDir(first)) {
      let kandidat = basename(root);
      let hoch = root;
      // Auch der Bibliotheksname selbst kann nichtssagend sein — dann weiter
      // hoch, aber höchstens drei Ebenen (sonst landet man bei „Users").
      for (let i = 0; i < 3 && (isGenericDir(kandidat) || !kandidat); i++) {
        const eltern = dirname(hoch);
        if (!eltern || eltern === hoch) break;
        hoch = eltern;
        kandidat = basename(hoch);
      }
      if (kandidat && !isGenericDir(kandidat)) return stripDomainSuffix(kandidat);
      // Nichts Brauchbares gefunden: lieber der Dateiname als „Downloads".
      return fileStem(basename(filePath));
    }

    if (isPureSeasonDir(first)) {
      const rn = basename(root);
      if (rn) return isGenericDir(rn) ? fileStem(basename(filePath)) : stripDomainSuffix(rn);
    }
    // Sammelordner einer Release-Seite ("www.UIndex.org") ist KEINE Serie —
    // die echte Serie steht eine Ebene tiefer. Ohne das wurde aus so einem
    // Ordner der Titel "org" und damit die falsche TMDb-Serie "OrG!".
    if (isSiteDir(first) && comps.length >= 3 && !isPureSeasonDir(comps[1])) {
      return comps[1];
    }
    if (isSiteDir(first)) {
      // nur noch die Datei übrig — deren Name trägt den echten Titel
      return fileStem(basename(filePath));
    }
    return stripDomainSuffix(first);
  }
  const rn = basename(root);
  if (rn && !isSiteDir(rn) && !isGenericDir(rn)) return stripDomainSuffix(rn);
  return fileStem(basename(filePath));
}

// ── Indizieren: Filme ───────────────────────────────────────────────────────

function indexMovies(db, root, now) {
  const insert = db.prepare(
    "INSERT INTO movies (title, year, path, added_at) VALUES (?,?,?,?) ON CONFLICT(path) DO NOTHING",
  );
  const known = db.prepare("SELECT id FROM movies WHERE path = ?");
  let n = 0;
  for (const f of walkVideos(root)) {
    if (known.get(f.path)) {
      n++;
      continue;
    }
    // "Film (2019)/film.mkv": der ORDNERNAME ist meist sauberer als der
    // Dateiname — genau wie bei Plex/Jellyfin bevorzugen wir ihn, sobald er
    // eine Jahreszahl trägt.
    const folderName = basename(f.dir);
    const fromFolder = f.dir !== root ? parseTitleYear(folderName) : null;
    const fromFile = parseTitleYear(f.stem);
    const pick = fromFolder?.year ? fromFolder : fromFile.title.length >= 2 ? fromFile : (fromFolder ?? fromFile);
    insert.run(pick.title || f.stem, pick.year ?? null, f.path, now);
    n++;
    scanState.current = n;
    if (n % 25 === 0) scanState.message = `Filme indiziert: ${n}`;
  }
  return n;
}

// ── Indizieren: Serien ──────────────────────────────────────────────────────

/** Serie zu einem Key finden oder anlegen. */
function findOrCreateShow(db, key, title, year, folder, now) {
  if (key) {
    const id = showIdForKey(key);
    if (id) {
      const row = db.prepare("SELECT id FROM shows WHERE id = ?").get(id);
      if (row) {
        if (folder) db.prepare("UPDATE shows SET folder = COALESCE(folder, ?) WHERE id = ?").run(folder, id);
        return id;
      }
      db.prepare("DELETE FROM show_keys WHERE key = ?").run(key); // verwaist
    }
  }
  // Zweitchance: gleiche Bezeichnung bereits vorhanden (Altbestand ohne Key)
  const byTitle = db.prepare("SELECT id FROM shows WHERE title = ?").get(title);
  if (byTitle) {
    setShowKeyIfAbsent(key, byTitle.id);
    if (folder) db.prepare("UPDATE shows SET folder = COALESCE(folder, ?) WHERE id = ?").run(folder, byTitle.id);
    return byTitle.id;
  }
  const info = db
    .prepare("INSERT INTO shows (title, year, added_at, folder, show_key) VALUES (?,?,?,?,?)")
    .run(title, year ?? null, now, folder ?? null, key || null);
  const id = Number(info.lastInsertRowid);
  setShowKeyIfAbsent(key, id);
  return id;
}

/** Serie zu einer TMDb-ID finden oder anlegen (für Platzierungen). */
function findOrCreateShowForTmdb(db, tmdbId, fallbackTitle, now) {
  const hit = db.prepare("SELECT id FROM shows WHERE tmdb_id = ?").get(tmdbId);
  if (hit) return hit.id;
  const info = db
    .prepare("INSERT INTO shows (title, tmdb_id, added_at, identified) VALUES (?,?,?,1)")
    .run(fallbackTitle || "…", tmdbId, now);
  return Number(info.lastInsertRowid);
}

/**
 * Folge anlegen/finden. Mehrere Dateien derselben Folge (verschiedene
 * Qualitäten) landen in `episode_files`; `episodes.path` zeigt auf die beste.
 */
function upsertEpisode(db, showId, season, episode, path, epTitle, episodeEnd, now) {
  const existing = db
    .prepare("SELECT id, path FROM episodes WHERE show_id=? AND season=? AND episode=?")
    .get(showId, season, episode);
  if (existing) {
    db.prepare("INSERT OR IGNORE INTO episode_files (episode_id, path, added_at) VALUES (?,?,?)").run(existing.id, path, now);
    return existing.id;
  }
  // Datei war vorher einer anderen Folge zugeordnet? Dann umhängen statt doppeln.
  const byPath = db.prepare("SELECT id FROM episodes WHERE path = ?").get(path);
  if (byPath) {
    db.prepare("UPDATE episodes SET show_id=?, season=?, episode=? WHERE id=?").run(showId, season, episode, byPath.id);
    return byPath.id;
  }
  const info = db
    .prepare("INSERT INTO episodes (show_id, season, episode, title, path, added_at, episode_end) VALUES (?,?,?,?,?,?,?)")
    .run(showId, season, episode, epTitle ?? null, path, now, episodeEnd ?? null);
  const id = Number(info.lastInsertRowid);
  db.prepare("INSERT OR IGNORE INTO episode_files (episode_id, path, added_at) VALUES (?,?,?)").run(id, path, now);
  return id;
}

function indexShows(db, root, now) {
  let n = 0;
  for (const f of walkVideos(root)) {
    let sourceName = showSourceName(root, f.path);
    // LETZTE SICHERUNG gegen Müll-Titel: Ergibt der Ordner keinen brauchbaren
    // Namen (Release-Seite, nur Ziffern, nur eine Domain-Endung), zählt der
    // Dateiname — dort steht bei Szene-Releases immer der echte Serientitel.
    if (isJunkTitle(cleanShowTitle(sourceName))) {
      const fromFile = cleanShowTitle(f.stem);
      if (!isJunkTitle(fromFile)) sourceName = f.stem;
    }
    const key = showKey(sourceName);

    // 1) Pro-Datei-Platzierung schlägt ALLES und wird bei jedem Scan erneuert.
    const pl = placementFor(f.path);
    if (pl) {
      const target = findOrCreateShowForTmdb(db, pl.show_tmdb, cleanShowTitle(sourceName), now);
      upsertEpisode(db, target, pl.season, pl.episode, f.path, episodeTitleFromFile(f.stem), null, now);
      n++;
      continue;
    }

    // 2) Schon indiziert? Dann Zuordnung/Nummerierung NICHT anfassen — manuelle
    //    Korrekturen sollen den Rescan überleben. Nur den Gruppen-Key festigen.
    const knownFile = db.prepare("SELECT episode_id FROM episode_files WHERE path = ?").get(f.path);
    const knownEp = knownFile
      ? db.prepare("SELECT show_id FROM episodes WHERE id = ?").get(knownFile.episode_id)
      : db.prepare("SELECT show_id FROM episodes WHERE path = ?").get(f.path);
    if (knownEp) {
      if (key) setShowKeyIfAbsent(key, knownEp.show_id);
      n++;
      continue;
    }

    // 3) Neue Datei → Position bestimmen
    const parentDir = basename(f.dir);
    const parsed = parseEpisode(f.stem, parentDir);
    let season = parsed?.season ?? null;
    let episode = parsed?.episode ?? null;
    if (season == null || episode == null) {
      // Zweite Chance über den Staffelordner (…/Staffel 2/irgendwas.mkv)
      const hint = parseSeasonFromDir(parentDir);
      if (hint != null && parsed?.episode != null) season = hint;
      else continue; // nicht erkennbar → wird übersprungen (wie am Desktop)
    }

    const title = cleanShowTitle(sourceName);
    const { year } = parseTitleYear(sourceName);
    const showId = findOrCreateShow(db, key, title || sourceName, year, showFolderOf(root, f.path), now);
    upsertEpisode(db, showId, season, episode, f.path, episodeTitleFromFile(f.stem), parsed?.episodeEnd ?? null, now);
    n++;
    scanState.current = n;
    if (n % 25 === 0) scanState.message = `Folgen indiziert: ${n}`;
  }
  return n;
}

/** Absoluter Ordner der Serie (root/Serie), für lokale Bilder + .nfo. */
function showFolderOf(root, filePath) {
  const rel = relative(root, filePath);
  const comps = rel.split(sep).filter(Boolean);
  if (comps.length >= 2 && !isPureSeasonDir(comps[0])) return join(root, comps[0]);
  return root;
}

// ── Aufräumen ───────────────────────────────────────────────────────────────

/**
 * Pfad vereinheitlichen: Backslashes zu Schrägstrichen, Schrägstrich am Ende
 * weg. Unter Windows zusätzlich klein geschrieben, weil dort "C:\Filme" und
 * "c:\filme" derselbe Ordner sind.
 *
 * WICHTIG: Jeder Pfadvergleich in dieser Datei MUSS hierüber laufen. Genau
 * hier lag ein stiller Datenverlust-Fehler: Die Sicherung in pruneMissing()
 * verglich einen VEREINHEITLICHTEN Bibliothekspfad per SQL-LIKE gegen die ROH
 * gespeicherten Dateipfade. Unter Linux fällt das nicht auf (dort ändert das
 * Vereinheitlichen nichts), unter Windows fand der Vergleich nie etwas — die
 * Sicherung griff dort also gar nicht und ein leerer Mount hätte die
 * Bibliothek gelöscht. Eine Sicherung gegen Datenverlust darf nicht vom
 * Betriebssystem abhängen.
 */
const pfadNorm = (s) => {
  const n = String(s || "").replace(/\\/g, "/").replace(/\/+$/, "");
  return process.platform === "win32" ? n.toLowerCase() : n;
};

/** Liegt `pfad` innerhalb von `wurzel`? (Mit Trennzeichen, damit "/media/tv"
 *  nicht auch "/media/tv-alt" einschließt.) */
const liegtUnter = (pfad, wurzel) => {
  const p = pfadNorm(pfad);
  const w = pfadNorm(wurzel);
  return p === w || p.startsWith(w + "/");
};

/**
 * Zeilen entfernen, deren Datei verschwunden ist — offline Platten ausgenommen.
 *
 * ZWEITE SICHERUNG (wichtig in Docker): Ein Bind-Mount auf einen Host-Pfad, den
 * es nicht (mehr) gibt, erzeugt im Container ein EXISTIERENDES, aber LEERES
 * Verzeichnis. Ohne diesen Schutz würde ein einziger solcher Scan die komplette
 * Bibliothek aus der Datenbank löschen. Deshalb: eine Bibliothek, die vorher
 * Einträge hatte und jetzt kein einziges Video mehr liefert, gilt als
 * „nicht erreichbar“ statt als „leer“.
 */
function pruneMissing(db, foundPerLibrary = new Map()) {
  const libs = listLibraries();
  // Einmal laden statt pro Bibliothek — und in JS vergleichen, damit für beide
  // Seiten dieselbe Vereinheitlichung gilt (siehe pfadNorm).
  const alleFilmPfade = db.prepare("SELECT path FROM movies").all().map((r) => r.path);
  const alleFolgenPfade = db.prepare("SELECT path FROM episodes").all().map((r) => r.path);
  const offlineRoots = libs
    .filter((l) => {
      try {
        if (!statSync(l.path).isDirectory()) return true;
      } catch {
        return true;
      }
      // existiert, lieferte aber nichts — hatten wir vorher etwas davon?
      if ((foundPerLibrary.get(l.path) ?? 0) > 0) return false;
      const quelle = l.kind === "movie" ? alleFilmPfade : alleFolgenPfade;
      const had = quelle.filter((p) => liegtUnter(p, l.path)).length;
      if (had > 0) {
        console.warn(
          `[scan] ACHTUNG: "${l.path}" ist eingebunden, enthält aber keine Videos mehr (vorher ${had}). ` +
            `Sieht nach einem ins Leere zeigenden Docker-Mount aus — die Einträge bleiben zur Sicherheit erhalten.`,
        );
        return true;
      }
      return false;
    })
    .map((l) => l.path);

  // Vergleich MIT Trennzeichen, sonst würde "/media/tv" auch "/media/tv-alt"
  // schützen — steckt in liegtUnter(), damit hier und bei der Sicherung oben
  // garantiert dieselbe Regel gilt.
  const isOffline = (p) => offlineRoots.some((r) => liegtUnter(p, r));
  const gone = (p) => {
    try {
      statSync(p);
      return false;
    } catch {
      return true;
    }
  };

  if (offlineRoots.length) {
    console.warn(`[scan] ${offlineRoots.length} Bibliothek(en) nicht erreichbar — deren Einträge bleiben erhalten`);
  }

  for (const r of db.prepare("SELECT id, path FROM movies").all()) {
    if (!isOffline(r.path) && gone(r.path)) db.prepare("DELETE FROM movies WHERE id = ?").run(r.id);
  }
  for (const r of db.prepare("SELECT id, episode_id, path FROM episode_files").all()) {
    if (!isOffline(r.path) && gone(r.path)) db.prepare("DELETE FROM episode_files WHERE id = ?").run(r.id);
  }
  for (const r of db.prepare("SELECT id, path FROM episodes").all()) {
    if (isOffline(r.path)) continue;
    const alt = db.prepare("SELECT path FROM episode_files WHERE episode_id = ? ORDER BY COALESCE(height,0) DESC LIMIT 1").get(r.id);
    if (gone(r.path)) {
      if (alt && !gone(alt.path)) db.prepare("UPDATE episodes SET path = ? WHERE id = ?").run(alt.path, r.id);
      else db.prepare("DELETE FROM episodes WHERE id = ?").run(r.id);
    }
  }
  db.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
  db.exec("DELETE FROM show_keys WHERE show_id NOT IN (SELECT id FROM shows)");
}

/** Serien, die auf derselben TMDb-ID gelandet sind, zusammenführen. */
function mergeShowsByTmdb(db) {
  const dupes = db
    .prepare("SELECT tmdb_id FROM shows WHERE tmdb_id IS NOT NULL GROUP BY tmdb_id HAVING COUNT(*) > 1")
    .all();
  for (const { tmdb_id } of dupes) {
    const rows = db.prepare("SELECT id FROM shows WHERE tmdb_id = ? ORDER BY id").all(tmdb_id);
    const survivor = rows[0].id;
    for (const r of rows.slice(1)) {
      db.prepare("UPDATE episodes SET show_id=? WHERE show_id=?").run(survivor, r.id);
      db.prepare("UPDATE OR IGNORE favorites SET ref_id=? WHERE media_type='show' AND ref_id=?").run(survivor, r.id);
      // Reste, die wegen des UNIQUE-Schlüssels nicht umgehängt werden konnten
      // (beide Serien standen im selben Profil auf „Meine Liste“), aufräumen.
      db.prepare("DELETE FROM favorites WHERE media_type='show' AND ref_id=?").run(r.id);
      moveShowKeys(r.id, survivor);
      db.prepare("DELETE FROM shows WHERE id=?").run(r.id);
    }
    // doppelte Folgen derselben Staffel/Nummer zu Dateivarianten zusammenlegen
    const eps = db
      .prepare("SELECT id, season, episode, path FROM episodes WHERE show_id=? ORDER BY season, episode, id")
      .all(survivor);
    const seen = new Map();
    for (const e of eps) {
      const k = `${e.season}:${e.episode}`;
      const first = seen.get(k);
      if (first == null) {
        seen.set(k, e.id);
        continue;
      }
      db.prepare("UPDATE OR IGNORE episode_files SET episode_id=? WHERE episode_id=?").run(first, e.id);
      db.prepare("DELETE FROM episodes WHERE id=?").run(e.id);
    }
  }
}

// ── Zuordnen (TMDb) ─────────────────────────────────────────────────────────

/** Gemerkte Zuordnung für eine Filmdatei (über den stabilen Namens-Key). */
function movieOverride(path) {
  const key = movieKey(fileStem(basename(path)));
  return identityOverride("movie", key);
}

/** Gemerkte Zuordnung für eine Serie (über einen ihrer Gruppen-Keys). */
function showOverride(showId) {
  for (const key of keysForShow(showId)) {
    const t = identityOverride("tv", key);
    if (t) return t;
  }
  return null;
}

async function applyMovieMatch(db, movieId, tmdbId, identified) {
  const meta = await tmdb.movieMeta(tmdbId);
  if (!meta) return false;
  db.prepare(
    `UPDATE movies SET tmdb_id=?, title=COALESCE(?, title), overview=?, tagline=?, poster=?, backdrop=?,
       genres=?, rating=?, year=COALESCE(?, year), runtime_min=?, cert=?, identified=? WHERE id=?`,
  ).run(
    tmdbId, meta.title, meta.overview, meta.tagline, meta.posterPath, meta.backdropPath,
    JSON.stringify(meta.genres), meta.rating, meta.year, meta.runtime, meta.cert, identified ? 1 : 0, movieId,
  );
  return true;
}

async function applyShowMatch(db, showId, tmdbId, identified) {
  const meta = await tmdb.showMeta(tmdbId);
  if (!meta) return false;
  db.prepare(
    `UPDATE shows SET tmdb_id=?, title=COALESCE(?, title), overview=?, tagline=?, poster=?, backdrop=?,
       genres=?, rating=?, year=COALESCE(?, year), last_year=?, status=?, runtime=?, cert=?, identified=? WHERE id=?`,
  ).run(
    tmdbId, meta.title, meta.overview, meta.tagline, meta.posterPath, meta.backdropPath,
    JSON.stringify(meta.genres), meta.rating, meta.year, meta.lastYear, meta.status, meta.runtime,
    meta.cert, identified ? 1 : 0, showId,
  );
  // Staffelposter von TMDb übernehmen (sofern nicht lokal überschrieben)
  for (const s of meta.seasons) {
    if (!s.posterPath) continue;
    const cur = db.prepare("SELECT path FROM season_art WHERE show_id=? AND season=?").get(showId, s.season);
    if (cur && isLocalRef(cur.path)) continue;
    db.prepare(
      "INSERT INTO season_art (show_id, season, path) VALUES (?,?,?) ON CONFLICT(show_id,season) DO UPDATE SET path=excluded.path",
    ).run(showId, s.season, s.posterPath);
  }
  await refreshEpisodeMeta(db, showId, tmdbId);
  return true;
}

/** Folgentitel/-bilder je Staffel nachladen (nur fehlende). */
async function refreshEpisodeMeta(db, showId, tmdbId, force = false) {
  const seasons = db.prepare("SELECT DISTINCT season FROM episodes WHERE show_id=? ORDER BY season").all(showId);
  for (const { season } of seasons) {
    const missing = db
      .prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=? AND season=? AND (still IS NULL OR overview IS NULL OR title IS NULL)")
      .get(showId, season).c;
    if (!force && !missing) continue;
    const eps = await tmdb.seasonEpisodeList(tmdbId, season);
    if (!eps.length) continue;
    const up = db.prepare(
      `UPDATE episodes SET title=COALESCE(?, title), overview=COALESCE(?, overview),
         still=CASE WHEN still IS NULL OR still NOT LIKE 'local:%' THEN COALESCE(?, still) ELSE still END,
         air_date=COALESCE(?, air_date), runtime=COALESCE(?, runtime)
       WHERE show_id=? AND season=? AND episode=?`,
    );
    for (const e of eps) {
      up.run(e.title, e.overview, e.stillPath, e.airDate, e.runtime, showId, season, e.episode);
    }
  }
}

/**
 * Einmalige Migration: früher gemerkte Zuordnungen hingen am ORDNERPFAD
 * (identity_map). Die werden jetzt zusätzlich als stabiler Namens-Key
 * abgelegt, damit sie ein Umbenennen und „Bibliothek neu aufbauen“ überleben.
 */
/**
 * Müll-Schlüssel wegwerfen. Beim alten Fehlverhalten konnte „org" (aus einem
 * Sammelordner wie „www.UIndex.org") als Serien- oder Merk-Schlüssel landen.
 * Bliebe der stehen, käme die falsche Zuordnung nach jedem Scan zurück.
 */
function cleanJunkKeys(db) {
  let n = 0;
  for (const r of db.prepare("SELECT key FROM show_keys").all()) {
    if (isJunkTitle(r.key)) {
      db.prepare("DELETE FROM show_keys WHERE key = ?").run(r.key);
      n++;
    }
  }
  for (const r of db.prepare("SELECT key, kind FROM identity_keys").all()) {
    if (isJunkTitle(r.key)) {
      db.prepare("DELETE FROM identity_keys WHERE key = ? AND kind = ?").run(r.key, r.kind);
      n++;
    }
  }
  // Serien, deren Titel selbst Müll ist und die (noch) keine Folgen haben
  db.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
  if (n > 0) console.log(`[scan] ${n} unbrauchbare Schlüssel entfernt (z. B. aus Release-Seiten-Ordnern)`);
}

function migrateIdentityMap(db) {
  cleanJunkKeys(db);
  if (getSetting("identity_map_migrated") === "1") return;
  let n = 0;
  for (const r of db.prepare("SELECT folder, kind, tmdb_id FROM identity_map").all()) {
    if (!r.folder || !r.tmdb_id) continue;
    if (r.kind === "show") {
      const k = showKey(basename(r.folder));
      // Müll-Schlüssel (Release-Seiten-Ordner) NICHT übernehmen — genau daraus
      // entstand die falsche Zuordnung „OrG! (Come & Play)".
      if (!isJunkTitle(k)) {
        rememberIdentityKey("tv", k, r.tmdb_id);
        n++;
      }
    } else {
      // Film: der Key hängt am DATEInamen — über die bekannten Dateien im Ordner
      const prefix = r.folder.replace(/\\/g, "/").replace(/\/+$/, "") + "/";
      for (const m of db.prepare("SELECT path FROM movies WHERE path LIKE ?").all(prefix + "%")) {
        rememberIdentityKey("movie", movieKey(fileStem(basename(m.path))), r.tmdb_id);
        n++;
      }
    }
  }
  if (n > 0) console.log(`[scan] ${n} gemerkte Zuordnungen auf stabile Schlüssel übernommen`);
  setSetting("identity_map_migrated", "1");
}

async function matchAll(db) {
  migrateIdentityMap(db);
  if (!tmdb.tmdbEnabled()) {
    setStage("warn", "Kein TMDb-Schlüssel — Metadaten übersprungen");
    console.warn("[scan] kein TMDb-Key gesetzt: keine Poster/Beschreibungen");
    return;
  }
  const autoMatch = getSetting("auto_match") !== "off";

  // ── Filme ──
  const movies = db.prepare("SELECT id, path, title, year FROM movies WHERE tmdb_id IS NULL").all();
  for (let i = 0; i < movies.length; i++) {
    const m = movies[i];
    setStage("match", `Film: ${m.title}`, i + 1, movies.length);
    // .nfo neben der Datei gewinnt (Jellyfin/Kodi-Konvention)
    const nfo = readNfo(m.path);
    const fromTag = providerId(basename(m.path)) ?? providerId(basename(dirname(m.path)));
    const forced = movieOverride(m.path) ?? nfo?.tmdbId ?? (fromTag?.kind === "tmdb" ? fromTag.id : null);
    if (forced) {
      await applyMovieMatch(db, m.id, forced, true).catch(() => {});
      continue;
    }
    if (!autoMatch) continue;
    const id = await tmdb.bestMovieMatch(tmdb.searchQuery(m.title), m.year ?? null);
    if (id) await applyMovieMatch(db, m.id, id, false).catch(() => {});
  }

  // ── Serien ──
  const shows = db.prepare("SELECT id, title, year, folder FROM shows WHERE tmdb_id IS NULL").all();
  for (let i = 0; i < shows.length; i++) {
    const s = shows[i];
    setStage("match", `Serie: ${s.title}`, i + 1, shows.length);
    const nfo = s.folder ? readNfo(join(s.folder, "tvshow.nfo")) : null;
    const fromTag = s.folder ? providerId(basename(s.folder)) : null;
    const forced = showOverride(s.id) ?? nfo?.tmdbId ?? (fromTag?.kind === "tmdb" ? fromTag.id : null);
    if (forced) {
      await applyShowMatch(db, s.id, forced, true).catch(() => {});
      continue;
    }
    if (!autoMatch) continue;
    const localEps = db.prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=?").get(s.id).c;
    const id = await tmdb.bestTvMatch(tmdb.searchQuery(s.title), s.year ?? null, localEps);
    if (id) await applyShowMatch(db, s.id, id, false).catch(() => {});
  }

  // ── Nachzügler: zugeordnet, aber ohne Poster (z. B. früherer Offline-Scan).
  //    Der Merker verhindert, dass Titel OHNE Poster bei TMDb (die gibt es)
  //    bei JEDEM Scan aufs Neue abgefragt werden.
  const tried = new Set(JSON.parse(getSetting("art_retry_done") || "[]"));
  let triedChanged = false;
  for (const s of db.prepare("SELECT id, tmdb_id, identified FROM shows WHERE tmdb_id IS NOT NULL AND poster IS NULL").all()) {
    if (tried.has(`s${s.id}`)) continue;
    setStage("match", "Bilder werden nachgeladen …");
    await applyShowMatch(db, s.id, s.tmdb_id, !!s.identified).catch(() => {});
    tried.add(`s${s.id}`);
    triedChanged = true;
  }
  for (const m of db.prepare("SELECT id, tmdb_id, identified FROM movies WHERE tmdb_id IS NOT NULL AND poster IS NULL").all()) {
    if (tried.has(`m${m.id}`)) continue;
    setStage("match", "Bilder werden nachgeladen …");
    await applyMovieMatch(db, m.id, m.tmdb_id, !!m.identified).catch(() => {});
    tried.add(`m${m.id}`);
    triedChanged = true;
  }

  // ── Neue Staffeln/Folgen bereits zugeordneter Serien ──
  for (const s of db.prepare("SELECT id, tmdb_id, title FROM shows WHERE tmdb_id IS NOT NULL").all()) {
    // NUR anhand des Titels entscheiden: ein fehlendes Standbild ist bei TMDb
    // normal und würde sonst jede halbe Stunde die komplette Staffelliste
    // erneut ziehen (Rate-Limit-Risiko bei großen Bibliotheken).
    const missing = db.prepare("SELECT COUNT(*) c FROM episodes WHERE show_id=? AND title IS NULL").get(s.id).c;
    if (!missing) continue;
    setStage("match", `Neue Folgen: ${s.title}`);
    await refreshEpisodeMeta(db, s.id, s.tmdb_id).catch(() => {});
  }

  if (triedChanged) setSetting("art_retry_done", JSON.stringify([...tried].slice(-5000)));
  mergeShowsByTmdb(db);
}

// ── Bilder: lokale Dateien + erzeugte Standbilder ───────────────────────────

/**
 * Lokale Bilddateien einlesen (Plex/Jellyfin). Sie gewinnen gegen TMDb, weil
 * der Nutzer sie bewusst hingelegt hat.
 */
function applyLocalArtwork(db) {
  setStage("art", "Lokale Bilder werden gesucht …");
  // Immer BEIDE Richtungen schreiben: gefunden → setzen, nicht mehr da → auf
  // NULL zurück. Sonst zeigt die Datenbank nach dem Löschen einer poster.jpg
  // weiter auf eine verschwundene Datei und die Kachel bleibt leer, obwohl es
  // ein TMDb-Poster gäbe.
  const stillOk = (p) => {
    if (!p) return false;
    try {
      return statSync(p).isFile();
    } catch {
      return false;
    }
  };

  for (const m of db.prepare("SELECT id, path, local_poster, local_backdrop FROM movies").all()) {
    const art = findLocalArtwork(dirname(m.path), fileStem(basename(m.path)));
    const poster = art.poster ?? (stillOk(m.local_poster) ? m.local_poster : null);
    const backdrop = art.backdrop ?? (stillOk(m.local_backdrop) ? m.local_backdrop : null);
    db.prepare("UPDATE movies SET local_poster=?, local_backdrop=?, logo=COALESCE(?, logo) WHERE id=?").run(
      poster, backdrop, art.logo ? asLocalRef(art.logo) : null, m.id,
    );
  }
  for (const s of db.prepare("SELECT id, folder, local_poster, local_backdrop FROM shows WHERE folder IS NOT NULL").all()) {
    const art = findLocalArtwork(s.folder, null);
    const poster = art.poster ?? (stillOk(s.local_poster) ? s.local_poster : null);
    const backdrop = art.backdrop ?? (stillOk(s.local_backdrop) ? s.local_backdrop : null);
    db.prepare("UPDATE shows SET local_poster=?, local_backdrop=?, logo=COALESCE(?, logo) WHERE id=?").run(
      poster, backdrop, art.logo ? asLocalRef(art.logo) : null, s.id,
    );
    for (const [season, file] of findSeasonArtwork(s.folder)) {
      db.prepare(
        "INSERT INTO season_art (show_id, season, path) VALUES (?,?,?) ON CONFLICT(show_id,season) DO UPDATE SET path=excluded.path",
      ).run(s.id, season, asLocalRef(file));
    }
  }
  // Folgenbilder, die als Datei danebenliegen ("… S01E01-thumb.jpg"). Selbst
  // erzeugte Standbilder (still_generated=1) werden dabei nicht überschrieben.
  for (const e of db.prepare("SELECT id, path FROM episodes WHERE still_generated = 0").all()) {
    const art = findLocalArtwork(dirname(e.path), fileStem(basename(e.path)));
    if (art.thumb) db.prepare("UPDATE episodes SET local_still=? WHERE id=?").run(art.thumb, e.id);
  }
}

/**
 * Fehlende Folgenbilder aus dem Video schneiden (wie Jellyfin). Bewusst
 * begrenzt, damit ein Erst-Scan nicht stundenlang die CPU blockiert.
 *
 * Läuft NACH dem Auslesen der Videodaten — sonst ist die Laufzeit noch
 * unbekannt und es würde stur bei Sekunde 300 geschnitten (bei kürzeren
 * Folgen kommt dabei gar nichts heraus).
 */
async function generateMissingStills(db, limit = 60) {
  if (getSetting("generate_stills") === "off") return;
  const rows = db
    .prepare(
      `SELECT id, path, duration FROM episodes
       WHERE still IS NULL AND local_still IS NULL AND still_generated = 0 LIMIT ?`,
    )
    .all(limit);
  if (!rows.length) return;
  setStage("art", "Folgenbilder werden erzeugt …", 0, rows.length);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    scanState.current = i + 1;
    // 25 % der Laufzeit (max. 7 min) trifft fast immer eine aussagekräftige Szene
    const at = r.duration ? Math.min(r.duration * 0.25, 420) : 60;
    const file = await makeStill(r.path, at, 480);
    if (file) {
      db.prepare("UPDATE episodes SET local_still=?, still_generated=1 WHERE id=?").run(file, r.id);
    } else {
      // Fehlschlag NICHT als "erledigt" merken — sonst bliebe die Folge für
      // immer ohne Bild. Beim nächsten Scan wird es erneut versucht.
      db.prepare("UPDATE episodes SET still_generated=0 WHERE id=?").run(r.id);
    }
  }
}

// ── Technik: Auflösung/Codecs ───────────────────────────────────────────────

async function probeMissing(db, limit = 400) {
  const rows = [
    ...db.prepare("SELECT 'movie' t, id, path FROM movies WHERE duration IS NULL OR width IS NULL LIMIT ?").all(limit),
    ...db.prepare("SELECT 'episode' t, id, path FROM episodes WHERE duration IS NULL OR width IS NULL LIMIT ?").all(limit),
  ];
  // Zweitdateien (Qualitätsvarianten) IMMER mitprüfen — auch wenn oben nichts
  // offen ist. Vorher stand hier ein vorzeitiges return, wodurch nachträglich
  // hinzugefügte 4K-Fassungen nie vermessen und nie zur Hauptdatei wurden.
  const variants = db.prepare("SELECT id, path FROM episode_files WHERE width IS NULL LIMIT ?").all(limit);
  if (rows.length || variants.length) {
    setStage("probe", "Video-Infos werden gelesen …", 0, rows.length + variants.length);
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    scanState.current = i + 1;
    const info = await ffprobe(r.path);
    if (!info) continue;
    const table = r.t === "movie" ? "movies" : "episodes";
    const aspect = info.width && info.height ? info.width / info.height : null;
    db.prepare(
      `UPDATE ${table} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=?, aspect=? WHERE id=?`,
    ).run(info.duration, info.vcodec, info.acodec, info.container, info.width, info.height, aspect, r.id);
  }
  for (let i = 0; i < variants.length; i++) {
    const f = variants[i];
    scanState.current = rows.length + i + 1;
    const info = await ffprobe(f.path);
    if (!info) continue;
    db.prepare(
      "UPDATE episode_files SET width=?, height=?, duration=?, vcodec=?, acodec=?, container=? WHERE id=?",
    ).run(info.width, info.height, info.duration, info.vcodec, info.acodec, info.container, f.id);
  }
  // Beste Datei als Hauptdatei der Folge setzen — nur für Folgen, die wirklich
  // mehrere Dateien haben (spart bei großen Bibliotheken tausende Abfragen).
  const multi = db
    .prepare("SELECT episode_id FROM episode_files GROUP BY episode_id HAVING COUNT(*) > 1")
    .all();
  for (const { episode_id } of multi) {
    const e = db.prepare("SELECT id, path FROM episodes WHERE id=?").get(episode_id);
    if (!e) continue;
    const best = db
      .prepare("SELECT path FROM episode_files WHERE episode_id=? ORDER BY COALESCE(height,0) DESC, id ASC LIMIT 1")
      .get(e.id);
    if (best && best.path !== e.path) db.prepare("UPDATE episodes SET path=? WHERE id=?").run(best.path, e.id);
  }
}

// ── Fortschritt, der für noch unbekannte Medien ankam ───────────────────────

export function applyPendingProgress(db) {
  const rows = db.prepare("SELECT * FROM pending_progress").all();
  for (const p of rows) {
    let refId = null;
    if (p.media_type === "movie") {
      refId = db.prepare("SELECT id FROM movies WHERE tmdb_id = ?").get(p.tmdb_id)?.id ?? null;
    } else {
      refId =
        db
          .prepare(
            "SELECT e.id FROM episodes e JOIN shows s ON s.id=e.show_id WHERE s.tmdb_id=? AND e.season=? AND e.episode=?",
          )
          .get(p.tmdb_id, p.season, p.episode)?.id ?? null;
    }
    if (refId == null) continue;
    db.prepare(
      `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET
         position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
       WHERE excluded.updated_at > progress.updated_at`,
    ).run(p.profile_id, p.media_type, refId, p.position, p.duration, p.watched, p.updated_at);
    db.prepare(
      "DELETE FROM pending_progress WHERE profile_id=? AND media_type=? AND tmdb_id=? AND season=? AND episode=?",
    ).run(p.profile_id, p.media_type, p.tmdb_id, p.season, p.episode);
  }
}

/** Eine Bibliothek wurde entfernt — die daraus gescannten Einträge löschen. */
export function removeLibraryContent(libPath, kind) {
  const db = openDb();
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const prefix = norm(libPath) + "/";
  if (kind === "movie") {
    const del = db.prepare("DELETE FROM movies WHERE id = ?");
    for (const r of db.prepare("SELECT id, path FROM movies").all()) if (norm(r.path).startsWith(prefix)) del.run(r.id);
  } else {
    for (const r of db.prepare("SELECT id, path FROM episode_files").all()) {
      if (norm(r.path).startsWith(prefix)) db.prepare("DELETE FROM episode_files WHERE id = ?").run(r.id);
    }
    const del = db.prepare("DELETE FROM episodes WHERE id = ?");
    for (const r of db.prepare("SELECT id, path FROM episodes").all()) if (norm(r.path).startsWith(prefix)) del.run(r.id);
    db.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
    db.exec("DELETE FROM show_keys WHERE show_id NOT IN (SELECT id FROM shows)");
  }
}

/** Manuelle Zuordnung merken (wird bei jedem Scan wieder angewandt). */
export function rememberShowIdentity(db, showId, tmdbId) {
  for (const key of keysForShow(showId)) rememberIdentityKey("tv", key, tmdbId);
  const row = db.prepare("SELECT title FROM shows WHERE id=?").get(showId);
  if (row?.title) rememberIdentityKey("tv", showKey(row.title), tmdbId);
}

export function rememberMovieIdentity(db, moviePath, tmdbId) {
  rememberIdentityKey("movie", movieKey(fileStem(basename(moviePath))), tmdbId);
}

// ── Scan-Lauf ───────────────────────────────────────────────────────────────

let rerunRequested = false;

export async function scanLibrary() {
  if (scanState.running) {
    rerunRequested = true;
    return;
  }
  scanState.running = true;
  setStage("start", "Scan gestartet …");
  const db = openDb();
  const now = Date.now();
  const t0 = Date.now();
  try {
    // 1) Indizieren
    const foundPerLibrary = new Map();
    for (const lib of listLibraries()) {
      try {
        if (!statSync(lib.path).isDirectory()) {
          console.warn(`[scan] Bibliothek nicht erreichbar: ${lib.path}`);
          continue;
        }
      } catch {
        console.warn(`[scan] Bibliothek nicht erreichbar: ${lib.path}`);
        continue;
      }
      setStage("index", `Durchsuche ${lib.path}`);
      const n = lib.kind === "movie" ? indexMovies(db, lib.path, now) : indexShows(db, lib.path, now);
      foundPerLibrary.set(lib.path, n);
    }

    // 2) Aufräumen (vor dem Zuordnen, damit keine Karteileichen abgefragt werden)
    setStage("index", "Dateien indiziert");
    pruneMissing(db, foundPerLibrary);

    // 3) TMDb
    await matchAll(db);

    // 4) Technik (Laufzeit/Auflösung) — MUSS vor dem Bildschnitt laufen,
    //    weil die Schnittposition aus der Laufzeit berechnet wird
    await probeMissing(db);

    // 5) Bilder
    applyLocalArtwork(db);
    await generateMissingStills(db);

    // 6) Fortschritt neu verknüpfen
    applyPendingProgress(db);

    scanState.shows = db.prepare("SELECT COUNT(*) c FROM shows").get().c;
    scanState.episodes = db.prepare("SELECT COUNT(*) c FROM episodes").get().c;
    scanState.movies = db.prepare("SELECT COUNT(*) c FROM movies").get().c;
    scanState.lastResult = "ok";
    console.log(
      `[scan] fertig in ${((Date.now() - t0) / 1000).toFixed(1)} s — ${scanState.shows} Serien / ${scanState.episodes} Folgen / ${scanState.movies} Filme`,
    );
  } catch (e) {
    scanState.lastResult = String(e);
    console.error("[scan] fehlgeschlagen:", e);
  } finally {
    scanState.lastRun = Date.now();
    scanState.running = false;
    setStage("", "");
    if (rerunRequested) {
      rerunRequested = false;
      void scanLibrary();
    }
  }
}

/** Vollständige Metadaten-Auffrischung (Einstellungen → "Metadaten neu laden"). */
export async function refreshAllMetadata() {
  const db = openDb();
  scanState.running = true;
  try {
    const shows = db.prepare("SELECT id, tmdb_id, identified, title FROM shows WHERE tmdb_id IS NOT NULL").all();
    for (let i = 0; i < shows.length; i++) {
      setStage("match", `Serie: ${shows[i].title}`, i + 1, shows.length);
      await applyShowMatch(db, shows[i].id, shows[i].tmdb_id, !!shows[i].identified).catch(() => {});
      await refreshEpisodeMeta(db, shows[i].id, shows[i].tmdb_id, true).catch(() => {});
    }
    const movies = db.prepare("SELECT id, tmdb_id, identified, title FROM movies WHERE tmdb_id IS NOT NULL").all();
    for (let i = 0; i < movies.length; i++) {
      setStage("match", `Film: ${movies[i].title}`, i + 1, movies.length);
      await applyMovieMatch(db, movies[i].id, movies[i].tmdb_id, !!movies[i].identified).catch(() => {});
    }
    applyLocalArtwork(db);
  } finally {
    scanState.running = false;
    setStage("", "");
  }
}

export { applyShowMatch, applyMovieMatch, refreshEpisodeMeta };

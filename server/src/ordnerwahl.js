// Auswahl-Fenster für Ordner (Punkt 1 der Übergabe) — Server-Seite.
//
// 1:1-Gegenstück zu src-tauri/src/ordnerwahl.rs, damit die unveränderte
// Desktop-Oberfläche auch im Browser funktioniert. Der Nutzer gibt einen Ordner
// an, wir durchsuchen ihn rekursiv nach Videos und liefern jeden Fund einzeln
// zurück. Bestätigte Funde kommen in die Bibliothek, abgelehnte in die
// Ignorierliste.
//
// WARUM eine Ignorierliste und nicht einfach „nicht anhaken": der Scanner läuft
// später von selbst wieder. Ohne gemerkte Ablehnung wäre jeder abgelehnte Fund
// beim nächsten Scan sofort wieder da.
import { readdirSync, statSync } from "node:fs";
import { join, dirname, basename, normalize } from "node:path";
import { getSetting, setSetting, listLibraries, addLibrary, openDb } from "./db.js";
import { isVideo, isJunkClip, fileStem, parseEpisode, parseTitleYear, cleanShowTitle, isPureSeasonDir } from "./parser.js";
import { BROWSE_ROOTS, isSystemDir } from "./scanner.js";

export const IGNORE_KEY = "ignored_files";

// Dateien unter 1 MB sind fast immer Reste. Dieselbe Grenze wie im Scanner —
// bewusst niedrig, damit kurze Zeichentrickfolgen nicht verschwinden.
const MIN_VIDEO_BYTES = Math.max(0, parseInt(process.env.MIN_VIDEO_MB || "1", 10) || 1) * 1024 * 1024;

// Obergrenze, damit ein versehentlich gewähltes Laufwerk die Oberfläche nicht
// mit zehntausenden Zeilen erschlägt.
const MAX_HITS = 2000;

/** Pfad zum Vergleichen vereinheitlichen (siehe Kommentar in ordnerwahl.rs). */
export const norm = (p) => String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/** Die Ignorierliste als Set normalisierter Pfade. */
export function ignoredSet() {
  try {
    const raw = getSetting(IGNORE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set((Array.isArray(arr) ? arr : []).map(norm));
  } catch {
    return new Set();
  }
}

export function setIgnored(set) {
  setSetting(IGNORE_KEY, JSON.stringify([...set].sort()));
}

/* Dateien, für die gerade ein Vorschaubild erlaubt ist.
   WARUM: /api/invoke/media_thumbnail lässt sonst nur Dateien zu, die schon in
   der Bibliothek stehen — genau die sind hier aber noch NICHT drin. Ohne diese
   Liste bliebe im Auswahl-Fenster jedes Vorschaubild leer. Der Server ist übers
   Netz erreichbar, deshalb keine freie Pfadangabe, sondern nur das, was der
   Nutzer eben selbst durchsucht hat. */
const vorschauErlaubt = new Set();
export const istVorschauDatei = (p) => vorschauErlaubt.has(norm(p));

/** Liegt `p` innerhalb einer der erlaubten Wurzeln oder einer Bibliothek? */
function pfadErlaubt(p) {
  const roots = [...BROWSE_ROOTS, ...listLibraries().map((l) => l.path)].map(norm);
  const t = norm(p);
  return roots.some((r) => r === "/" || t === r || t.startsWith(r + "/"));
}

function* walk(root, maxDepth = 8) {
  const stack = [{ dir: root, depth: 0 }];
  while (stack.length) {
    const { dir, depth } = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= maxDepth || isSystemDir(e.name)) continue;
        stack.push({ dir: p, depth: depth + 1 });
      } else if (e.isFile()) {
        yield { path: p, name: e.name, dir };
      }
    }
  }
}

/** Steht die Datei schon im Index? */
function inLibrary(d, path) {
  return !!(
    d.prepare("SELECT 1 FROM movies WHERE path = ?").get(path) ||
    d.prepare("SELECT 1 FROM episodes WHERE path = ?").get(path) ||
    d.prepare("SELECT 1 FROM episode_files WHERE path = ?").get(path)
  );
}

/** Einen Ordner rekursiv nach Videos durchsuchen — verändert nichts. */
export function preview(rootRaw) {
  const root = String(rootRaw || "").trim();
  if (!root) throw new Error("Kein Ordner angegeben");
  let st;
  try {
    st = statSync(root);
  } catch {
    throw new Error("Dieser Ordner ist auf dem Server nicht sichtbar. Ist die Platte im docker-compose gemountet?");
  }
  if (!st.isDirectory()) throw new Error("Das ist kein Ordner: " + root);
  if (!pfadErlaubt(root)) throw new Error("Pfad außerhalb der erlaubten Ordner");

  const d = openDb();
  const ign = ignoredSet();
  const hits = [];
  let skipped = 0;
  let truncated = false;

  for (const f of walk(root)) {
    if (!isVideo(f.name)) continue;
    const stem = fileStem(f.name);
    if (isJunkClip(stem)) {
      skipped++;
      continue;
    }
    let size = 0;
    try {
      size = statSync(f.path).size;
    } catch {
      continue;
    }
    if (size < MIN_VIDEO_BYTES) {
      skipped++;
      continue;
    }
    if (hits.length >= MAX_HITS) {
      truncated = true;
      break;
    }

    const parentName = basename(f.dir);
    const se = parseEpisode(stem, parentName);
    let kind, title, year = null, season = null, episode = null;
    if (se) {
      kind = "episode";
      season = se.season;
      episode = se.episode;
      // Bei "…/Serie/Season 3/datei.mkv" steht der Serientitel eine Ebene höher.
      const ausOrdner = isPureSeasonDir(parentName) ? basename(dirname(f.dir)) : parentName;
      title = cleanShowTitle(ausOrdner) || cleanShowTitle(stem);
    } else {
      kind = "movie";
      const ty = parseTitleYear(stem);
      title = ty.title;
      year = ty.year ?? null;
    }

    vorschauErlaubt.add(norm(f.path));
    hits.push({
      path: f.path,
      name: f.name,
      dir: f.dir,
      sizeBytes: size,
      kind,
      title,
      year,
      season,
      episode,
      inLibrary: inLibrary(d, f.path),
      ignored: ign.has(norm(f.path)),
    });
  }

  hits.sort((a, b) => a.path.toLowerCase().localeCompare(b.path.toLowerCase(), "de"));
  // Die Vorschau-Freigabe darf nicht unbegrenzt wachsen.
  if (vorschauErlaubt.size > 20000) vorschauErlaubt.clear();
  return { path: root, hits, skipped, truncated };
}

/**
 * Auswahl übernehmen. Bestätigtes kommt in die Bibliothek (der durchsuchte
 * Ordner wird dafür angelegt, falls ihn noch keine Bibliothek abdeckt),
 * Abgelehntes in die Ignorierliste und aus dem Index heraus.
 */
export function apply({ root, kind, accept = [], reject = [] }) {
  const d = openDb();
  const ign = ignoredSet();
  for (const p of reject) ign.add(norm(p));
  // Bestätigtes muss aus der Ignorierliste heraus — sonst bliebe ein früher
  // abgelehnter Fund für immer verloren.
  for (const p of accept) ign.delete(norm(p));
  setIgnored(ign);

  let removed = 0;
  for (const p of reject) {
    removed += d.prepare("DELETE FROM movies WHERE path = ?").run(p).changes || 0;
    removed += d.prepare("DELETE FROM episode_files WHERE path = ?").run(p).changes || 0;
    removed += d.prepare("DELETE FROM episodes WHERE path = ?").run(p).changes || 0;
  }

  let libraryId = null;
  let libraryCreated = false;
  if (accept.length > 0) {
    const rn = norm(root);
    const deckend = listLibraries().find((l) => {
      const ln = norm(l.path);
      return rn === ln || rn.startsWith(ln + "/");
    });
    if (deckend) {
      libraryId = deckend.id;
    } else {
      const lib = addLibrary(normalize(root), kind === "movie" ? "movie" : "show", basename(root) || null);
      libraryId = lib.id;
      libraryCreated = true;
    }
  }

  return { accepted: accept.length, rejected: reject.length, libraryId, libraryCreated, removed };
}

/** Abgelehnte Dateien (für die Liste in den Einstellungen). */
export const listIgnored = () => [...ignoredSet()].sort();

/** Eine Ablehnung zurücknehmen. */
export function unignore(paths = []) {
  const ign = ignoredSet();
  const vorher = ign.size;
  for (const p of paths) ign.delete(norm(p));
  setIgnored(ign);
  return vorher - ign.size;
}

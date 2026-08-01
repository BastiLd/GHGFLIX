// /api/invoke/<cmd> — the desktop app's ENTIRE Tauri command surface,
// re-implemented against the server's SQLite DB. This is what lets the
// unmodified desktop React UI run in the browser: src/lib/backend.ts routes
// every `invoke()` here, with identical argument and result shapes
// (camelCase, desktop types from src/lib/types.ts).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, normalize, basename, dirname } from "node:path";
import { spawn } from "node:child_process";
import {
  openDb, getSetting, setSetting, listLibraries, addLibrary, removeLibrary, DATA_DIR, setPlacement,
  resolveProfile,
} from "./db.js";
import {
  scanLibrary, scanState, removeLibraryContent, detectLibraries, primaryRoot, isSystemDir, BROWSE_ROOTS,
  applyPendingProgress, refreshAllMetadata, applyShowMatch, applyMovieMatch, refreshEpisodeMeta,
  rememberShowIdentity, rememberMovieIdentity,
} from "./scanner.js";
import { canDirectPlay, ffprobe } from "./stream.js";
import * as tmdb from "./tmdb.js";
import { asLocalRef, isLocalRef } from "./artwork.js";
import * as ordnerwahl from "./ordnerwahl.js";
import * as serienfilme from "./serienfilme.js";
import * as kanaele from "./kanaele.js";
import { makeThumb, trickplayInfo, ensureTrickplay, dirSize, clearThumbCache, THUMB_DIR, TRICK_DIR } from "./thumbs.js";

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const FFPROBE = process.env.FFPROBE_PATH || "ffprobe";

const db = () => openDb();
const now = () => Date.now();

// ── row → desktop-shape mappers ──────────────────────────────────────────────

/** Desktop stores genres as a JSON array string; the server historically as
 *  "Action, Drama". Normalize to the desktop format. */
function genresJson(g) {
  if (!g) return null;
  if (typeof g === "string" && g.trim().startsWith("[")) return g;
  return JSON.stringify(String(g).split(",").map((s) => s.trim()).filter(Boolean));
}

/**
 * Bildpfad für die Oberfläche. Lokale Dateien (poster.jpg neben dem Film,
 * Plex/Jellyfin-Stil) haben Vorrang vor TMDb und werden als "local:<Pfad>"
 * ausgeliefert — /api/img erkennt das Präfix und liefert die Datei direkt aus.
 */
const pickArt = (local, remote) => (local ? (isLocalRef(local) ? local : asLocalRef(local)) : (remote ?? null));

function movieOut(r) {
  if (!r) return null;
  return {
    id: r.id,
    path: r.path,
    title: r.title,
    year: r.year ?? null,
    tmdbId: r.tmdb_id ?? null,
    overview: r.overview ?? null,
    tagline: r.tagline ?? null,
    posterPath: pickArt(r.local_poster, r.poster),
    backdropPath: pickArt(r.local_backdrop, r.backdrop),
    logoPath: r.logo ?? null,
    genres: genresJson(r.genres),
    runtime: r.runtime_min ?? (r.duration ? Math.round(r.duration / 60) : null),
    rating: r.rating ?? null,
    addedAt: r.added_at,
    identified: !!(r.identified || r.tmdb_id),
    width: r.width ?? null,
    height: r.height ?? null,
    aspect: r.aspect ?? (r.width && r.height ? r.width / r.height : null),
    cert: r.cert ?? null,
  };
}

function showOut(r) {
  if (!r) return null;
  /* season > 0 bei der Staffelzahl: Staffel 0 sind die Specials und zaehlt
     nicht als eigene Staffel — sonst stuende bei Miraculous "7 Staffeln",
     obwohl es sechs gibt. Die Folgenzahl zaehlt dagegen ALLE, Specials
     eingeschlossen (so machen es Plex und Jellyfin auch). */
  const c = db()
    .prepare("SELECT COUNT(id) e, COUNT(DISTINCT CASE WHEN season > 0 THEN season END) s FROM episodes WHERE show_id=?")
    .get(r.id);
  return {
    id: r.id,
    folder: r.folder ?? null,
    title: r.title,
    year: r.year ?? null,
    tmdbId: r.tmdb_id ?? null,
    overview: r.overview ?? null,
    tagline: r.tagline ?? null,
    posterPath: pickArt(r.local_poster, r.poster),
    backdropPath: pickArt(r.local_backdrop, r.backdrop),
    logoPath: r.logo ?? null,
    genres: genresJson(r.genres),
    rating: r.rating ?? null,
    addedAt: r.added_at,
    identified: !!(r.identified || r.tmdb_id),
    episodeCount: c?.e ?? 0,
    seasonCount: c?.s ?? 0,
    width: null,
    height: null,
    cert: r.cert ?? null,
    status: r.status ?? null,
    lastYear: r.last_year ?? null,
    runtime: r.runtime ?? null,
    introStart: r.intro_start ?? null,
    introEnd: r.intro_end ?? null,
  };
}

function episodeOut(r, showTitle = null) {
  if (!r) return null;
  const files = r.file_count ?? db().prepare("SELECT COUNT(*) c FROM episode_files WHERE episode_id=?").get(r.id)?.c ?? 1;
  return {
    id: r.id,
    showId: r.show_id,
    season: r.season,
    episode: r.episode,
    episodeEnd: r.episode_end ?? null,
    path: r.path,
    title: r.title ?? null,
    overview: r.overview ?? null,
    // TMDb-Standbild zuerst; sonst das lokal danebenliegende bzw. das aus dem
    // Video geschnittene Bild (Jellyfin-Verhalten) — nie mehr eine leere Kachel.
    stillPath: r.still ?? (r.local_still ? asLocalRef(r.local_still) : null),
    airDate: r.air_date ?? null,
    runtime: r.runtime ?? (r.duration ? Math.round(r.duration / 60) : null),
    addedAt: r.added_at,
    introStart: r.intro_start ?? null,
    introEnd: r.intro_end ?? null,
    showTitle: showTitle ?? r.show_title ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    aspect: r.aspect ?? (r.width && r.height ? r.width / r.height : null),
    fileCount: Math.max(1, files),
  };
}

function progressOut(r) {
  return {
    profileId: String(r.profile_id),
    mediaType: r.media_type,
    refId: r.ref_id,
    positionSec: r.position,
    durationSec: r.duration,
    watched: !!r.watched,
    updatedAt: r.updated_at,
  };
}

/** Nur Dateien, die wirklich in der Bibliothek stehen, dürfen an ffmpeg. */
function isLibraryFile(d, path) {
  if (!path) return false;
  return !!(
    d.prepare("SELECT 1 FROM movies WHERE path = ?").get(path) ||
    d.prepare("SELECT 1 FROM episodes WHERE path = ?").get(path) ||
    d.prepare("SELECT 1 FROM episode_files WHERE path = ?").get(path)
  );
}

const getEpisodeRow = (id) =>
  db()
    .prepare("SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.id=?")
    .get(id);

// ── identity map (remembered manual assignments, survives rebuilds) ─────────

const rememberIdentity = (folder, kind, tmdbId) =>
  db()
    .prepare("INSERT INTO identity_map (folder, kind, tmdb_id) VALUES (?,?,?) ON CONFLICT(folder,kind) DO UPDATE SET tmdb_id=excluded.tmdb_id")
    .run(folder, kind, tmdbId);

// ── TMDb enrichment helpers ──────────────────────────────────────────────────

// Anreicherung läuft über dieselben Funktionen wie der Scan (eine Wahrheit),
// damit "Identifizieren" exakt dasselbe Ergebnis liefert wie die Auto-Erkennung.
async function enrichShow(showId, tmdbId) {
  await applyShowMatch(db(), showId, tmdbId, true);
  await refreshEpisodeMeta(db(), showId, tmdbId, true).catch(() => {});
}

async function enrichMovie(movieId, tmdbId) {
  await applyMovieMatch(db(), movieId, tmdbId, true);
}

/** Merge shows that ended up on the same TMDb id — returns the surviving id. */
function mergeShowsByTmdb(tmdbId, preferId) {
  const rows = db().prepare("SELECT id FROM shows WHERE tmdb_id=? ORDER BY id").all(tmdbId);
  if (rows.length <= 1) return preferId;
  const survivor = rows.some((r) => r.id === preferId) ? preferId : rows[0].id;
  for (const r of rows) {
    if (r.id === survivor) continue;
    db().prepare("UPDATE episodes SET show_id=? WHERE show_id=?").run(survivor, r.id);
    db().prepare("UPDATE OR IGNORE favorites SET ref_id=? WHERE media_type='show' AND ref_id=?").run(survivor, r.id);
    db().prepare("DELETE FROM favorites WHERE media_type='show' AND ref_id=?").run(r.id);
    db().prepare("DELETE FROM shows WHERE id=?").run(r.id);
  }
  return survivor;
}

// Vorschaubilder + Sprite-Blätter leben jetzt komplett in ./thumbs.js
// (Parallelitäts-Bremse, einstellbare Größe, Cache-Grenze, Trickplay).

// ── ffprobe chapters (player chapter menu + intro skip) ──────────────────────

function probeChapters(path) {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ["-v", "quiet", "-print_format", "json", "-show_chapters", path]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve([]));
    p.on("close", () => {
      try {
        const j = JSON.parse(out);
        resolve(
          (j.chapters ?? []).map((c) => ({
            title: c.tags?.title ?? null,
            time: parseFloat(c.start_time) || 0,
          })),
        );
      } catch {
        resolve([]);
      }
    });
  });
}

// ── tool checks ──────────────────────────────────────────────────────────────

function toolVersion(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ["-version"]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("error", () => resolve(null));
    p.on("close", (code) => resolve(code === 0 ? (out.split("\n")[0] || "ok") : null));
  });
}

// ── the command table ────────────────────────────────────────────────────────

const kindToServer = (k) => (k === "tv" ? "show" : "movie");
const kindToDesktop = (k) => (k === "show" ? "tv" : "movie");
const libOut = (l) => ({ id: l.id, path: l.path, kind: kindToDesktop(l.kind) });

export async function handleInvoke(cmd, a = {}) {
  const d = db();
  switch (cmd) {
    // ===== settings =====
    case "get_setting":
      return getSetting(String(a.key));
    case "set_setting":
      setSetting(String(a.key), String(a.value));
      return null;

    // ===== libraries =====
    case "get_libraries":
      return listLibraries().map(libOut);
    case "add_library": {
      const path = String(a.path || "").trim();
      if (!path || !existsSync(path) || !statSync(path).isDirectory()) {
        throw new Error("Dieser Ordner ist auf dem Server nicht sichtbar. Ist die Platte im docker-compose gemountet?");
      }
      const lib = addLibrary(path, kindToServer(a.kind), basename(path) || null);
      void scanLibrary();
      return lib.id;
    }
    case "detect_libraries": {
      // desktop: scans the picked root; web: scans ALL mounted drives
      const found = detectLibraries();
      for (const f of found) addLibrary(f.path, f.kind, f.name);
      if (found.length) void scanLibrary();
      return listLibraries().map(libOut);
    }
    case "remove_library": {
      const lib = removeLibrary(Number(a.id));
      if (lib) removeLibraryContent(lib.path, lib.kind);
      return null;
    }
    /* Eine Folge (typischerweise ein Special) ist eigentlich ein Film und
       soll in den "Filme"-Reiter der Serie wandern.
       Gemeldet: bei Miraculous sind unter "Filme & Specials" sechs Dateien,
       aber NUR "Awakening" ist wirklich ein Kinofilm — die anderen fünf
       (New York, Shanghai, Paris, London, Tokyo) sind echte Specials und
       sollen dort bleiben. Der Nutzer wählt das pro Datei selbst aus. */
    case "episode_to_movie": {
      const epId = Number(a.episodeId);
      const ep = d.prepare("SELECT * FROM episodes WHERE id=?").get(epId);
      if (!ep) throw new Error("Folge nicht gefunden");
      const show = d.prepare("SELECT * FROM shows WHERE id=?").get(ep.show_id);
      const titel = (ep.title && ep.title.trim()) || show?.title || "Film";

      d.prepare("INSERT INTO movies (title, path, overview, added_at) VALUES (?,?,?,?) ON CONFLICT(path) DO NOTHING")
        .run(titel, ep.path, ep.overview || null, Date.now());
      const movieId = d.prepare("SELECT id FROM movies WHERE path=?").get(ep.path).id;

      // Weitere Qualitätsvarianten derselben Datei: nicht als eigener Film
      // dupliziert, aber auch nicht mehr als Folge — nur von der erneuten
      // Aufnahme ausschließen.
      const altPfade = d.prepare("SELECT path FROM episode_files WHERE episode_id=?").all(epId).map((r) => r.path);
      d.prepare("DELETE FROM episode_files WHERE episode_id=?").run(epId);
      d.prepare("DELETE FROM episodes WHERE id=?").run(epId);

      const liste = JSON.parse(getSetting("movie_override_files") || "[]");
      const bekannt = new Set(liste.map((p) => String(p).toLowerCase()));
      for (const p of [ep.path, ...altPfade]) {
        if (!bekannt.has(p.toLowerCase())) {
          liste.push(p);
          bekannt.add(p.toLowerCase());
        }
      }
      setSetting("movie_override_files", JSON.stringify(liste));

      /* Sicherheitsnetz: fuerSerie() erkennt Filme im Serienordner schon von
         selbst (dieselbe "Filme & Specials"-Wurzel wie die Staffeln) — die
         ausdrückliche Verknüpfung greift nur, falls diese Heuristik einmal
         nicht zutrifft (andere Ordnerstruktur). */
      if (show) serienfilme.verknuepfen(show, { title: titel, year: null }, true);
      return movieId;
    }

    // ===== Auswahl-Fenster für Ordner (Punkt 1) =====
    case "preview_folder":
      return ordnerwahl.preview(String(a.path || ""));
    case "apply_folder_selection": {
      const summary = ordnerwahl.apply({
        root: String(a.root || ""),
        kind: String(a.kind || "tv") === "movie" ? "movie" : "tv",
        accept: Array.isArray(a.accept) ? a.accept.map(String) : [],
        reject: Array.isArray(a.reject) ? a.reject.map(String) : [],
      });
      if (summary.accepted > 0 || summary.removed > 0) void scanLibrary();
      return summary;
    }
    // ===== Kanäle & Feeds (Punkt 5) =====
    case "feeds_list":
      return kanaele.feedsLaden();
    case "feed_add":
      return kanaele.abonnieren(String(a.url || ""), a.art === "blog" ? "blog" : "youtube");
    case "feed_remove":
      return kanaele.abbestellen(String(a.id || ""));
    case "feed_update":
      return kanaele.feedAendern(String(a.id || ""), {
        benachrichtigen: a.benachrichtigen,
        titel: a.titel,
        // undefined = nicht anfassen, null = aus der Gruppe nehmen
        gruppeId: a.gruppeId === undefined ? undefined : a.gruppeId,
      });
    case "feed_items":
      return kanaele.beitraege({
        art: a.art ? String(a.art) : null,
        gruppeId: a.gruppeId === undefined ? undefined : a.gruppeId,
        feedId: a.feedId ? String(a.feedId) : null,
        limit: Number(a.limit) || 60,
        nurUngelesen: !!a.unreadOnly,
        nurGemerkt: !!a.savedOnly,
        ohneGesehene: !!a.hideWatched,
        format: a.format ? String(a.format) : null,
        suche: a.search ? String(a.search) : null,
        sortierung: a.sort ? String(a.sort) : "neu",
      });
    case "feed_saved":
      return kanaele.merken(String(a.id || ""), a.on !== false);
    case "feed_watched":
      return kanaele.gesehenSetzen(String(a.id || ""), a.on !== false);

    // ── Gruppen ──
    case "feed_groups":
      return kanaele.gruppenUebersicht();
    case "feed_group_add":
      return kanaele.gruppeAnlegen({ name: a.name, emoji: a.emoji, farbe: a.farbe });
    case "feed_group_update":
      return kanaele.gruppeAendern(String(a.id || ""), {
        name: a.name,
        emoji: a.emoji,
        farbe: a.farbe,
        standardOffen: a.standardOffen,
        sortierung: a.sortierung,
      });
    case "feed_group_remove":
      return kanaele.gruppeLoeschen(String(a.id || ""));
    case "feed_refresh": {
      const neu = await kanaele.abholen(a.id ? String(a.id) : null);
      return { neu: neu.length, beitraege: neu };
    }
    case "feed_unread":
      return kanaele.ungelesenZahl(a.art ? String(a.art) : null);
    case "feed_mark_read":
      return kanaele.alsGelesen(Array.isArray(a.ids) ? a.ids.map(String) : null);

    case "list_ignored_files":
      return ordnerwahl.listIgnored();
    case "unignore_files":
      return ordnerwahl.unignore(Array.isArray(a.paths) ? a.paths.map(String) : []);

    case "browse_dirs": {
      const root = primaryRoot();
      let target = a.path ? String(a.path) : root;
      // nur innerhalb der erlaubten Wurzeln bzw. bestehender Bibliotheken
      const nrm = (x) => normalize(String(x)).replace(/\\/g, "/").replace(/\/+$/, "") || "/";
      const allowed = [...BROWSE_ROOTS, ...listLibraries().map((l) => l.path), root].map(nrm);
      const tn = nrm(target);
      if (!allowed.some((r) => r === "/" || tn === r || tn.startsWith(r + "/"))) {
        throw new Error("Pfad außerhalb der erlaubten Ordner");
      }
      let entries;
      try {
        entries = readdirSync(target, { withFileTypes: true })
          .filter((e) => e.isDirectory() && !isSystemDir(e.name))
          .map((e) => ({ name: e.name, path: join(target, e.name) }))
          .sort((x, y) => x.name.localeCompare(y.name, "de"));
      } catch (e) {
        throw new Error("Ordner nicht lesbar: " + String(e.message || e));
      }
      const atRoot = normalize(target) === normalize(root);
      return { path: target, root, parent: atRoot ? null : normalize(join(target, "..")), entries };
    }

    // ===== scanning =====
    case "scan_libraries":
      void scanLibrary();
      return null;
    case "is_scanning":
      return !!scanState.running;
    case "scan_status":
      return {
        running: !!scanState.running,
        stage: scanState.stage || "scan",
        message: scanState.message || "Scanne Bibliothek…",
        current: scanState.current || 0,
        total: scanState.total || 0,
      };
    case "refresh_metadata": {
      void refreshAllMetadata().catch((e) => console.error("[refresh]", e));
      return null;
    }
    case "reset_library": {
      // keep watched-state: convert progress to TMDb coordinates first, then
      // wipe the index and rescan — applyPendingProgress re-links afterwards
      const rows = d
        .prepare(
          `SELECT pr.profile_id, pr.media_type, pr.position, pr.duration, pr.watched, pr.updated_at,
                  COALESCE(m.tmdb_id, s.tmdb_id) tmdb_id, COALESCE(e.season,-1) season, COALESCE(e.episode,-1) episode
           FROM progress pr
           LEFT JOIN movies m ON pr.media_type='movie' AND m.id=pr.ref_id
           LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
           LEFT JOIN shows s ON s.id=e.show_id
           WHERE COALESCE(m.tmdb_id, s.tmdb_id) IS NOT NULL`,
        )
        .all();
      const up = d.prepare(
        `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
           position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
      );
      for (const r of rows) up.run(r.profile_id, r.media_type, r.tmdb_id, r.season, r.episode, r.position, r.duration, r.watched, r.updated_at);
      d.exec("DELETE FROM episodes; DELETE FROM shows; DELETE FROM movies; DELETE FROM progress;");
      return null;
    }
    case "detect_intros": {
      // chapter-based intro windows (cheap enough for a ZimaBoard). The
      // desktop app's audio fingerprinting stays desktop-only; its results
      // arrive here via sync anyway.
      const showId = a.showId ?? null;
      (async () => {
        const re = /intro|opening|\bop\b|vorspann|recap|previously|titelsong|theme song/i;
        const eps = showId
          ? d.prepare("SELECT id, path FROM episodes WHERE show_id=? AND intro_start IS NULL").all(showId)
          : d.prepare("SELECT id, path FROM episodes WHERE intro_start IS NULL LIMIT 500").all();
        scanState.stage = "intros";
        scanState.total = eps.length;
        for (let i = 0; i < eps.length; i++) {
          scanState.current = i + 1;
          scanState.message = `Intro-Erkennung (Kapitel) ${i + 1}/${eps.length}`;
          const chaps = await probeChapters(eps[i].path);
          for (let c = 0; c < chaps.length; c++) {
            if (re.test(chaps[c].title || "")) {
              const start = chaps[c].time;
              const end = c + 1 < chaps.length ? chaps[c + 1].time : start + 90;
              d.prepare("UPDATE episodes SET intro_start=?, intro_end=? WHERE id=?").run(start, end, eps[i].id);
              break;
            }
          }
        }
        scanState.message = "";
        scanState.total = 0;
      })();
      return null;
    }

    // ===== library reads =====
    case "list_movies":
      return d.prepare("SELECT * FROM movies ORDER BY title").all().map(movieOut);
    case "get_movie":
      return movieOut(d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.id)));
    case "movie_versions": {
      const m = d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.id));
      if (!m) return [];
      const list = m.tmdb_id
        ? d.prepare("SELECT * FROM movies WHERE tmdb_id=? ORDER BY height DESC").all(m.tmdb_id)
        : [m];
      return list.map(movieOut);
    }
    case "list_shows":
      return d.prepare("SELECT * FROM shows ORDER BY title").all().map(showOut);
    case "get_show_detail": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.id));
      if (!s) return null;
      const eps = d.prepare("SELECT * FROM episodes WHERE show_id=? ORDER BY season, episode").all(s.id);
      const seasons = [];
      for (const e of eps) {
        let grp = seasons.find((x) => x.season === e.season);
        if (!grp) seasons.push((grp = { season: e.season, episodes: [] }));
        grp.episodes.push(episodeOut(e, s.title));
      }
      // Punkt 3: Kinofilme dieser Serie für den Reiter „Filme".
      const movies = serienfilme.fuerSerie(s, eps).map(movieOut);
      return { show: showOut(s), seasons, movies };
    }
    case "link_movie_to_show": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      const mv = d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.movieId));
      if (!s) throw new Error("Serie nicht gefunden");
      if (!mv) throw new Error("Film nicht gefunden");
      serienfilme.verknuepfen(s, mv, !!a.linked);
      return null;
    }
    case "get_episode":
      return episodeOut(getEpisodeRow(Number(a.id)));
    case "episode_versions": {
      const e = d.prepare("SELECT * FROM episodes WHERE id=?").get(Number(a.id));
      if (!e) return [];
      // alle Dateivarianten derselben Folge (verschiedene Qualitäten)
      const files = d
        .prepare("SELECT * FROM episode_files WHERE episode_id=? ORDER BY COALESCE(height,0) DESC, id ASC")
        .all(e.id);
      if (!files.length) {
        return [{ id: e.id, episodeId: e.id, path: e.path, width: e.width ?? null, height: e.height ?? null, addedAt: e.added_at }];
      }
      return files.map((f) => ({
        id: f.id,
        episodeId: e.id,
        path: f.path,
        width: f.width ?? e.width ?? null,
        height: f.height ?? e.height ?? null,
        addedAt: f.added_at,
      }));
    }
    case "list_show_episodes":
      return d
        .prepare("SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id WHERE e.show_id=? ORDER BY e.season, e.episode")
        .all(Number(a.showId))
        .map((r) => episodeOut(r));
    case "search_episodes": {
      const q = `%${String(a.query || "").trim()}%`;
      return d
        .prepare(
          `SELECT e.*, s.title show_title FROM episodes e JOIN shows s ON s.id=e.show_id
           WHERE e.title LIKE ?1 OR s.title LIKE ?1 ORDER BY s.title, e.season, e.episode LIMIT 100`,
        )
        .all(q)
        .map((r) => episodeOut(r));
    }
    case "path_exists":
      return existsSync(String(a.path));
    case "file_info": {
      try {
        const st = statSync(String(a.path));
        return { sizeBytes: st.size, modifiedSecs: Math.round(st.mtimeMs / 1000), exists: true };
      } catch {
        return { sizeBytes: 0, modifiedSecs: null, exists: false };
      }
    }
    case "reveal_in_explorer":
    case "open_app_data":
      throw new Error("Im Browser nicht möglich — die Dateien liegen auf dem Server.");

    // ===== TMDb + identify =====
    case "search_tmdb":
      return tmdb.searchList(String(a.query || ""), a.kind || "multi");
    case "identify_movie": {
      const m = d.prepare("SELECT * FROM movies WHERE id=?").get(Number(a.movieId));
      if (!m) throw new Error("Film nicht gefunden");
      await enrichMovie(m.id, Number(a.tmdbId));
      if (a.remember !== false) {
        // BEIDES merken: über den stabilen Namens-Key (überlebt Umbenennen und
        // "Bibliothek neu aufbauen") und über den Ordner (Altbestand).
        rememberMovieIdentity(d, m.path, Number(a.tmdbId));
        rememberIdentity(dirname(m.path), "movie", Number(a.tmdbId));
      }
      return null;
    }
    case "identify_show": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!s) throw new Error("Serie nicht gefunden");
      await enrichShow(s.id, Number(a.tmdbId));
      const survivor = mergeShowsByTmdb(Number(a.tmdbId), s.id);
      if (a.remember !== false) {
        rememberShowIdentity(d, survivor, Number(a.tmdbId));
        if (s.folder) rememberIdentity(s.folder, "show", Number(a.tmdbId));
      }
      return survivor;
    }
    case "set_episode_numbers": {
      d.prepare("UPDATE episodes SET season=?, episode=? WHERE id=?").run(Number(a.season), Number(a.episode), Number(a.episodeId));
      const e = getEpisodeRow(Number(a.episodeId));
      if (e?.show_id) {
        const s = d.prepare("SELECT tmdb_id FROM shows WHERE id=?").get(e.show_id);
        if (s?.tmdb_id) await enrichShow(e.show_id, s.tmdb_id).catch(() => {});
      }
      return null;
    }
    case "assign_episodes_sequential": {
      const start = getEpisodeRow(Number(a.episodeId));
      if (!start) throw new Error("Folge nicht gefunden");
      // "this file is SxxEyy, the rest follows in file order"
      const all = d
        .prepare("SELECT id, path FROM episodes WHERE show_id=? ORDER BY path")
        .all(start.show_id);
      const idx = all.findIndex((x) => x.id === start.id);
      if (idx < 0) return 0;
      let season = Number(a.season);
      let episode = Number(a.episode);
      let n = 0;
      for (let i = idx; i < all.length; i++) {
        d.prepare("UPDATE episodes SET season=?, episode=? WHERE id=?").run(season, episode, all[i].id);
        episode++;
        n++;
      }
      const s = d.prepare("SELECT tmdb_id FROM shows WHERE id=?").get(start.show_id);
      if (s?.tmdb_id) await enrichShow(start.show_id, s.tmdb_id).catch(() => {});
      return n;
    }
    case "tmdb_season_list":
      return tmdb.seasonEpisodeList(Number(a.tmdbId), Number(a.season));
    case "tmdb_season_numbers":
      return tmdb.seasonNumbers(Number(a.tmdbId));
    case "reassign_season": {
      const src = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!src) throw new Error("Serie nicht gefunden");
      let target = d.prepare("SELECT * FROM shows WHERE tmdb_id=?").get(Number(a.targetTmdb));
      if (!target) {
        const info = d.prepare("INSERT INTO shows (title, added_at, identified) VALUES (?,?,1)").run("…", now());
        await enrichShow(Number(info.lastInsertRowid), Number(a.targetTmdb));
        target = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(info.lastInsertRowid));
      }
      // Platzierung MERKEN, damit der nächste Scan die Verschiebung nicht
      // rückgängig macht (das war bisher der Fall).
      for (const e of d.prepare("SELECT path, season, episode FROM episodes WHERE show_id=? AND season=?").all(src.id, Number(a.season))) {
        setPlacement(e.path, Number(a.targetTmdb), e.season, e.episode);
      }
      d.prepare("UPDATE episodes SET show_id=? WHERE show_id=? AND season=?").run(target.id, src.id, Number(a.season));
      d.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
      await enrichShow(target.id, Number(a.targetTmdb)).catch(() => {});
      return target.id;
    }
    case "reassign_episode": {
      const e = d.prepare("SELECT * FROM episodes WHERE id=?").get(Number(a.episodeId));
      if (!e) throw new Error("Folge nicht gefunden");
      let target = d.prepare("SELECT * FROM shows WHERE tmdb_id=?").get(Number(a.targetTmdb));
      if (!target) {
        const info = d.prepare("INSERT INTO shows (title, added_at, identified) VALUES (?,?,1)").run("…", now());
        await enrichShow(Number(info.lastInsertRowid), Number(a.targetTmdb));
        target = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(info.lastInsertRowid));
      }
      setPlacement(e.path, Number(a.targetTmdb), Number(a.season), Number(a.episode));
      d.prepare("UPDATE episodes SET show_id=?, season=?, episode=? WHERE id=?").run(target.id, Number(a.season), Number(a.episode), e.id);
      d.exec("DELETE FROM shows WHERE id NOT IN (SELECT DISTINCT show_id FROM episodes)");
      await enrichShow(target.id, Number(a.targetTmdb)).catch(() => {});
      return target.id;
    }
    case "repair_season_titles": {
      const s = d.prepare("SELECT * FROM shows WHERE id=?").get(Number(a.showId));
      if (!s?.tmdb_id) throw new Error("Serie ist keiner TMDb-Serie zugeordnet");
      const season = Number(a.season);
      const tmdbEps = await tmdb.seasonEpisodeList(s.tmdb_id, season);
      const eps = d.prepare("SELECT id, path, episode FROM episodes WHERE show_id=? AND season=?").all(s.id, season);
      const norm = (x) =>
        String(x || "").toLowerCase().replace(/[^a-zä-ü0-9]+/g, " ").trim().replace(/\s+/g, " ");

      /* Titeltext aus dem Dateinamen — zwei Schreibweisen:
           "Serie - S01E20 - Pixelator"   klassisches SxxEyy
           "120 - Pixelator"              zusammengezogene Nummer vorne
         Die zweite fehlte bis 01.08.2026, und genau so ist die
         Miraculous-Sammlung benannt. Dieselbe Regel wie in commands.rs. */
      const kandidat = (stem) => {
        let rest = null;
        const mSe = /s\d{1,2}\s*[-. _]*e\d{1,3}[-. _]*/i.exec(stem);
        if (mSe) rest = stem.slice(mSe.index + mSe[0].length);
        else {
          const mNr = /^\s*\d{1,4}\s*(?:x\s*\d{1,3})?\s*[-._)\]]+\s*/.exec(stem);
          if (mNr) rest = stem.slice(mNr[0].length);
        }
        if (rest == null) return null;
        const c = norm(rest);
        // Mindestqualität — siehe Erklärung in commands.rs: lieber nicht
        // zuordnen als falsch zuordnen.
        if (c.length < 5) return null;
        if (Math.max(0, ...c.split(" ").map((w) => w.length)) < 4) return null;
        if (!/[aeiouäöü]/.test(c)) return null;
        return c;
      };

      const normed = tmdbEps.filter((t) => t.title).map((t) => ({ nr: t.episode, t: norm(t.title) }));
      const zuweisung = [];
      const belegt = new Set();
      for (const e of eps) {
        const stem = basename(e.path).replace(/\.[^.]+$/, "");
        const c = kandidat(stem);
        if (!c) continue;
        const treffer = normed
          .filter((x) => x.t === c || (c.length >= 4 && x.t.startsWith(c)) || (x.t.length >= 4 && c.startsWith(x.t)))
          .map((x) => x.nr);
        const eindeutig = [...new Set(treffer)];
        // NUR bei genau einem Treffer zuordnen — sonst entstehen die
        // Vertauschungen, die vorher niemand mehr rückgängig machen konnte.
        if (eindeutig.length === 1 && !belegt.has(eindeutig[0])) {
          belegt.add(eindeutig[0]);
          zuweisung.push([e.id, eindeutig[0]]);
        }
      }

      if (zuweisung.length > 0) {
        // Zweistufig umnummerieren, sonst kollidiert UNIQUE(show,season,episode).
        for (const e of eps) d.prepare("UPDATE episodes SET episode = -id WHERE id=?").run(e.id);
        for (const [id, nr] of zuweisung) d.prepare("UPDATE episodes SET episode=? WHERE id=?").run(nr, id);
        for (const e of eps) {
          if (zuweisung.some(([id]) => id === e.id)) continue;
          let n = Math.max(1, e.episode);
          while (
            d.prepare("SELECT COUNT(*) n FROM episodes WHERE show_id=? AND season=? AND episode=? AND id<>?")
              .get(s.id, season, n, e.id).n > 0
          ) n++;
          d.prepare("UPDATE episodes SET episode=? WHERE id=?").run(n, e.id);

          /* WAS NICHT ZUGEORDNET WERDEN KONNTE, DARF NICHTS FALSCHES ZEIGEN.
             Gemeldet an den Miraculous-Specials: über
             „001 - New York United Heroez.mp4" stand der TMDb-Titel
             „A Christmas Special" samt dessen Bild — nur weil das die Folge 1
             der Staffel 0 ist. Solche Sammlungen nummerieren anders als TMDb.
             Lieber der ehrliche Name aus dem Dateinamen und GAR KEIN Bild
             als ein fremder Titel mit fremdem Bild. */
          const stem = basename(e.path).replace(/\.[^.]+$/, "");
          const mSe = /s\d{1,2}\s*[-. _]*e\d{1,3}[-. _]*/i.exec(stem);
          const mNr = /^\s*\d{1,4}\s*(?:x\s*\d{1,3})?\s*[-._)\]]+\s*/.exec(stem);
          const rest = mSe ? stem.slice(mSe.index + mSe[0].length) : mNr ? stem.slice(mNr[0].length) : null;
          const ausDatei = rest ? rest.replace(/[._]+/g, " ").split(/\s+/).filter(Boolean).join(" ") : null;
          if (ausDatei && ausDatei.length >= 3) {
            d.prepare("UPDATE episodes SET title=?, still=NULL, overview=NULL WHERE id=?").run(ausDatei, e.id);
          }
        }
      }
      await enrichShow(s.id, s.tmdb_id).catch(() => {});
      return [zuweisung.length, eps.length];
    }

    // ===== progress =====
    case "set_progress": {
      d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at`,
      ).run(resolveProfile(a.profileId), a.mediaType, Number(a.refId), Number(a.positionSec) || 0, Number(a.durationSec) || 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "get_progress": {
      const r = d
        .prepare("SELECT * FROM progress WHERE profile_id=? AND media_type=? AND ref_id=?")
        .get(resolveProfile(a.profileId), a.mediaType, Number(a.refId));
      return r ? progressOut(r) : null;
    }
    case "list_progress":
      return d.prepare("SELECT * FROM progress WHERE profile_id=?").all(resolveProfile(a.profileId)).map(progressOut);
    case "continue_watching":
    case "recently_watched": {
      const recent = cmd === "recently_watched";
      const rows = d
        .prepare(
          `SELECT pr.*, mv.title m_title, mv.poster m_poster, mv.backdrop m_backdrop, mv.year m_year,
                  mv.local_poster m_lposter, mv.local_backdrop m_lbackdrop,
                  e.season, e.episode, e.title e_title, e.still, e.local_still, e.show_id,
                  sh.title s_title, sh.poster s_poster, sh.backdrop s_backdrop,
                  sh.local_poster s_lposter, sh.local_backdrop s_lbackdrop
           FROM progress pr
           LEFT JOIN movies mv ON pr.media_type='movie' AND mv.id=pr.ref_id
           LEFT JOIN episodes e ON pr.media_type='episode' AND e.id=pr.ref_id
           LEFT JOIN shows sh ON sh.id=e.show_id
           WHERE pr.profile_id=? AND COALESCE(mv.id, e.id) IS NOT NULL
             ${recent ? "" : "AND pr.watched=0 AND pr.position > 30 AND pr.duration > 0"}
           ORDER BY pr.updated_at DESC LIMIT ?`,
        )
        .all(resolveProfile(a.profileId), Number(a.limit) || 20);
      return rows.map((r) => {
        const isMovie = r.media_type === "movie";
        const pad = (n) => String(n).padStart(2, "0");
        return {
          mediaType: r.media_type,
          refId: r.ref_id,
          title: isMovie ? r.m_title : r.s_title ?? "?",
          subtitle: isMovie
            ? r.m_year
              ? String(r.m_year)
              : null
            : `S${pad(r.season)} E${pad(r.episode)}${r.e_title ? " · " + r.e_title : ""}`,
          posterPath: isMovie ? pickArt(r.m_lposter, r.m_poster) : pickArt(r.s_lposter, r.s_poster),
          backdropPath: isMovie
            ? pickArt(r.m_lbackdrop, r.m_backdrop)
            : (r.still ?? (r.local_still ? asLocalRef(r.local_still) : null) ?? pickArt(r.s_lbackdrop, r.s_backdrop)),
          positionSec: r.position,
          durationSec: r.duration,
          progress: r.duration > 0 ? Math.min(1, r.position / r.duration) : 0,
          updatedAt: r.updated_at,
          showId: r.show_id ?? null,
          season: r.season ?? null,
          episode: r.episode ?? null,
        };
      });
    }
    case "apply_remote_progress": {
      const rows = Array.isArray(a.rows) ? a.rows : [];
      const up = d.prepare(
        `INSERT INTO pending_progress (profile_id, media_type, tmdb_id, season, episode, position, duration, watched, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(profile_id, media_type, tmdb_id, season, episode) DO UPDATE SET
           position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
         WHERE excluded.updated_at > pending_progress.updated_at`,
      );
      for (const r of rows) {
        if (!r?.tmdbId) continue;
        up.run(resolveProfile(a.profileId), r.mediaType, r.tmdbId, r.season ?? -1, r.episode ?? -1, r.positionSec ?? 0, r.durationSec ?? 0, r.watched ? 1 : 0, r.updatedAt ?? now());
      }
      applyPendingProgress(d);
      return null;
    }

    // ===== favorites / watched / stats / extras =====
    case "toggle_favorite": {
      const args = [resolveProfile(a.profileId), a.mediaType, Number(a.refId)];
      const existing = d.prepare("SELECT 1 FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").get(...args);
      if (existing) {
        d.prepare("DELETE FROM favorites WHERE profile_id=? AND media_type=? AND ref_id=?").run(...args);
        return false;
      }
      d.prepare("INSERT INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(...args, now());
      return true;
    }
    case "list_favorites":
      return d
        .prepare("SELECT media_type mediaType, ref_id refId, added_at addedAt FROM favorites WHERE profile_id=? ORDER BY added_at DESC")
        .all(resolveProfile(a.profileId));
    case "set_watched": {
      const row = a.mediaType === "movie"
        ? d.prepare("SELECT duration FROM movies WHERE id=?").get(Number(a.refId))
        : d.prepare("SELECT duration FROM episodes WHERE id=?").get(Number(a.refId));
      d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,0,?,?,?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      ).run(resolveProfile(a.profileId), a.mediaType, Number(a.refId), row?.duration ?? 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "set_show_watched":
    case "set_season_watched": {
      const eps =
        cmd === "set_show_watched"
          ? d.prepare("SELECT id, duration FROM episodes WHERE show_id=?").all(Number(a.showId))
          : d.prepare("SELECT id, duration FROM episodes WHERE show_id=? AND season=?").all(Number(a.showId), Number(a.season));
      const up = d.prepare(
        `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?, 'episode', ?, 0, ?, ?, ?)
         ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET watched=excluded.watched, position=0, updated_at=excluded.updated_at`,
      );
      for (const e of eps) up.run(resolveProfile(a.profileId), e.id, e.duration ?? 0, a.watched ? 1 : 0, now());
      return null;
    }
    case "get_stats": {
      const p = resolveProfile(a.profileId);
      const r1 = d.prepare("SELECT COALESCE(SUM(CASE WHEN watched=1 THEN duration ELSE position END),0) s FROM progress WHERE profile_id=?").get(p);
      const r2 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND media_type='movie' AND watched=1").get(p);
      const r3 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND media_type='episode' AND watched=1").get(p);
      const r4 = d.prepare("SELECT COUNT(*) c FROM progress WHERE profile_id=? AND watched=0 AND position>30").get(p);
      return { watchedSeconds: Math.round(r1.s || 0), moviesWatched: r2.c, episodesWatched: r3.c, inProgress: r4.c };
    }
    case "tmdb_extras":
      return tmdb.extras(a.mediaType === "movie" ? "movie" : "tv", Number(a.tmdbId));
    // Punkt 4: alle Trailer/Teaser/Clips — wahlweise zu einer einzelnen Staffel
    case "tmdb_videos":
      return tmdb.videos(
        a.mediaType === "movie" ? "movie" : "tv",
        Number(a.tmdbId),
        a.season == null ? null : Number(a.season),
      );

    // ===== artwork + quality =====
    case "tmdb_images":
      return tmdb.images(a.mediaType, Number(a.tmdbId), a.season ?? null, a.episode ?? null);
    case "set_artwork": {
      const { target, id, path, field, season } = a;
      const col = field === "backdrop" ? "backdrop" : "poster";
      // Eine bewusste Auswahl im Bild-Dialog muss auch dann greifen, wenn eine
      // lokale poster.jpg danebenliegt — sonst passiert sichtbar nichts.
      const localCol = field === "backdrop" ? "local_backdrop" : "local_poster";
      if (target === "movie") d.prepare(`UPDATE movies SET ${col}=?, ${localCol}=NULL WHERE id=?`).run(path, Number(id));
      else if (target === "show") d.prepare(`UPDATE shows SET ${col}=?, ${localCol}=NULL WHERE id=?`).run(path, Number(id));
      else if (target === "episode") d.prepare("UPDATE episodes SET still=?, local_still=NULL, still_generated=1 WHERE id=?").run(path, Number(id));
      else if (target === "season")
        d.prepare("INSERT INTO season_art (show_id, season, path) VALUES (?,?,?) ON CONFLICT(show_id,season) DO UPDATE SET path=excluded.path").run(Number(id), Number(season), path);
      return null;
    }
    case "get_season_art":
      return d.prepare("SELECT season, path FROM season_art WHERE show_id=?").all(Number(a.showId)).map((r) => [r.season, r.path]);
    case "media_thumbnail": {
      const path = String(a.path || "");
      // Das Auswahl-Fenster zeigt Dateien, die noch NICHT in der Bibliothek
      // stehen — für die gibt ordnerwahl.js die Vorschau eigens frei.
      if (!isLibraryFile(d, path) && !ordnerwahl.istVorschauDatei(path)) {
        throw new Error("Datei nicht in der Bibliothek");
      }
      const t = Math.max(0, Number(a.timeSec) || 0);
      // Breite kommt aus der Einstellung "Vorschaubild-Größe" — vorher wurde
      // IMMER mit 320 px erzeugt und große Kacheln waren unscharf hochskaliert.
      const width = Math.min(960, Math.max(80, Number(a.width) || 320));
      const file = await makeThumb(path, t, width);
      if (!file) throw new Error("Kein Vorschaubild");
      // Der Token muss mit in die URL: <img src> kann keine Header senden, und
      // bei gesetztem GHGFLIX_PASSWORD lieferte der Server sonst 401 — genau
      // deshalb blieb die Zeitleisten-Vorschau im Browser leer.
      const tok = a.__token ? `&token=${encodeURIComponent(String(a.__token))}` : "";
      return `/api/thumbfile?path=${encodeURIComponent(path)}&t=${Math.round(t)}&w=${width}${tok}`;
    }
    // Vorgeneriertes Sprite-Blatt (Trickplay) für flüssige Zeitleisten-Vorschau
    case "trickplay_info": {
      const path = String(a.path || "");
      if (!isLibraryFile(d, path)) return null;
      const info = trickplayInfo(path);
      if (!info) {
        // im Hintergrund erzeugen, damit es beim nächsten Mal da ist
        const row =
          d.prepare("SELECT duration FROM movies WHERE path=?").get(path) ??
          d.prepare("SELECT duration FROM episodes WHERE path=?").get(path);
        if (row?.duration) ensureTrickplay(path, row.duration);
        return null;
      }
      const tok = a.__token ? `&token=${encodeURIComponent(String(a.__token))}` : "";
      return { ...info, url: `/api/trickplay?path=${encodeURIComponent(path)}${tok}` };
    }
    case "probe_qualities": {
      (async () => {
        const rows = [
          ...d.prepare("SELECT 'movie' t, id, path FROM movies WHERE width IS NULL OR duration IS NULL").all(),
          ...d.prepare("SELECT 'episode' t, id, path FROM episodes WHERE width IS NULL OR duration IS NULL").all(),
        ];
        for (const r of rows) {
          const info = await ffprobe(r.path);
          if (!info) continue;
          d.prepare(`UPDATE ${r.t === "movie" ? "movies" : "episodes"} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=? WHERE id=?`)
            .run(info.duration, info.vcodec, info.acodec, info.container, info.width, info.height, r.id);
        }
      })().catch((e) => console.error("[probe]", e));
      return null;
    }
    case "set_media_dims": {
      const table = a.mediaType === "movie" ? "movies" : "episodes";
      d.prepare(`UPDATE ${table} SET width=?, height=? WHERE id=?`).run(Number(a.width), Number(a.height), Number(a.id));
      return null;
    }

    // ===== intro windows =====
    case "set_episode_intro":
      d.prepare("UPDATE episodes SET intro_start=?, intro_end=? WHERE id=?").run(Number(a.start), Number(a.end), Number(a.episodeId));
      return null;
    case "set_show_intro":
      d.prepare("UPDATE shows SET intro_start=?, intro_end=? WHERE id=?").run(a.start ?? null, a.end ?? null, Number(a.showId));
      return null;

    // ===== tools / maintenance =====
    case "check_tools": {
      const [ffm, ffp] = await Promise.all([toolVersion(FFMPEG), toolVersion(FFPROBE)]);
      return {
        mpv: { path: null, ok: false, version: "— (im Browser spielt der HTML5-Player)" },
        ffmpeg: { path: FFMPEG, ok: !!ffm, version: ffm },
        ffprobe: { path: FFPROBE, ok: !!ffp, version: ffp },
      };
    }
    case "thumb_cache_size":
      return dirSize(THUMB_DIR) + dirSize(TRICK_DIR) + dirSize(join(DATA_DIR, "img-cache"));
    case "clear_thumb_cache":
      return clearThumbCache();
    case "db_optimize":
      d.exec("VACUUM");
      return null;
    case "export_json": {
      const data = {
        app: "ghgflix-server",
        exportedAt: now(),
        progress: d.prepare("SELECT * FROM progress").all(),
        favorites: d.prepare("SELECT * FROM favorites").all(),
        identity_map: d.prepare("SELECT * FROM identity_map").all(),
        settings: d.prepare("SELECT * FROM settings WHERE key NOT IN ('auth_tokens','password','supabase_key')").all(),
      };
      return JSON.stringify(data, null, 2);
    }
    case "import_json": {
      let j;
      try {
        j = JSON.parse(String(a.data || ""));
      } catch {
        throw new Error("Ungültige JSON-Datei");
      }
      let n = 0;
      for (const r of j.progress ?? []) {
        d.prepare(
          `INSERT INTO progress (profile_id, media_type, ref_id, position, duration, watched, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(profile_id, media_type, ref_id) DO UPDATE SET position=excluded.position, duration=excluded.duration, watched=excluded.watched, updated_at=excluded.updated_at
           WHERE excluded.updated_at > progress.updated_at`,
        ).run(r.profile_id, r.media_type, r.ref_id, r.position, r.duration, r.watched, r.updated_at);
        n++;
      }
      for (const r of j.favorites ?? []) {
        d.prepare("INSERT OR IGNORE INTO favorites (profile_id, media_type, ref_id, added_at) VALUES (?,?,?,?)").run(r.profile_id, r.media_type, r.ref_id, r.added_at);
        n++;
      }
      for (const r of j.identity_map ?? []) {
        d.prepare("INSERT INTO identity_map (folder, kind, tmdb_id) VALUES (?,?,?) ON CONFLICT(folder,kind) DO UPDATE SET tmdb_id=excluded.tmdb_id").run(r.folder, r.kind, r.tmdb_id);
        n++;
      }
      return n;
    }
    case "export_data":
    case "import_data":
      throw new Error("Im Browser bitte den Download/Upload-Export benutzen.");

    // ===== playback (web player) =====
    case "play_info": {
      const path = String(a.path || "");
      let row = d.prepare("SELECT 'movie' mt, * FROM movies WHERE path=?").get(path);
      if (!row) row = d.prepare("SELECT 'episode' mt, * FROM episodes WHERE path=?").get(path);
      if (!row) {
        // Qualitätsvariante einer Folge (episode_files) → Folge dahinter finden
        const f = d.prepare("SELECT episode_id FROM episode_files WHERE path=?").get(path);
        if (f) row = d.prepare("SELECT 'episode' mt, * FROM episodes WHERE id=?").get(f.episode_id);
      }
      if (!row) throw new Error("Datei nicht in der Bibliothek: " + path);
      if (!row.vcodec) {
        const info = await ffprobe(path);
        if (info) {
          Object.assign(row, info);
          d.prepare(`UPDATE ${row.mt === "movie" ? "movies" : "episodes"} SET duration=?, vcodec=?, acodec=?, container=?, width=?, height=? WHERE id=?`)
            .run(info.duration, info.vcodec, info.acodec, info.container, info.width, info.height, row.id);
        }
      }
      // EIN ffprobe-Aufruf statt zwei (der zweite lief bisher immer zusätzlich)
      const probe = row.audioStreams ? row : await ffprobe(path).catch(() => null);
      const chapters = await probeChapters(path).catch(() => []);
      // Sprite-Blatt für die Zeitleisten-Vorschau im Hintergrund vorbereiten
      if (row.duration) ensureTrickplay(path, row.duration);
      return {
        mediaType: row.mt,
        id: row.id,
        duration: row.duration ?? 0,
        direct: canDirectPlay(row),
        directUrl: `/api/stream/${row.mt}/${row.id}?x=1`,
        transcodeUrl: `/api/transcode/${row.mt}/${row.id}?x=1`,
        // Punkt 2: Safari/iOS spielen das fragmentierte MP4 von /api/transcode
        // nicht ab (schwarzes Bild) — für sie gibt es denselben Inhalt als HLS.
        hlsUrl: `/api/hls/${row.mt}/${row.id}/master.m3u8?x=1`,
        width: row.width ?? null,
        height: row.height ?? null,
        aspect: row.aspect ?? (row.width && row.height ? row.width / row.height : null),
        audioStreams: probe?.audioStreams ?? [],
        subtitleStreams: (probe?.subtitleStreams ?? []).filter((s) => !["hdmv_pgs_subtitle", "dvd_subtitle", "dvb_subtitle"].includes(s.codec ?? "")),
        chapters,
      };
    }

    default:
      throw new Error(`Unbekanntes Kommando: ${cmd}`);
  }
}

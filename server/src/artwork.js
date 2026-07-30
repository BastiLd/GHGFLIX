// ============================================================================
// Lokale Bilder & .nfo-Dateien — Plex-/Jellyfin-Konventionen
//
// Plex und Jellyfin nehmen Bilder, die NEBEN den Videodateien liegen, immer vor
// den Online-Bildern. Genau das macht dieses Modul: es findet poster.jpg,
// fanart.jpg, banner, Logo, Staffelposter und Folgen-Standbilder und liest
// optional die Metadaten aus einer .nfo-Datei (Kodi-Format).
//
// Fundstellen (in dieser Reihenfolge geprüft — erste Übereinstimmung gewinnt):
//   Poster    : poster.* · folder.* · cover.* · movie.* · show.* · default.* ·
//               <Dateiname>-poster.* · <Dateiname>.*
//   Hintergrund: fanart.* · backdrop.* · background.* · art.* ·
//               <Dateiname>-fanart.* · extrafanart/*.*
//   Banner    : banner.* · <Dateiname>-banner.*
//   Logo      : logo.* · clearlogo.*
//   Staffel   : season01-poster.* · season-specials-poster.* ·
//               <Staffelordner>/poster.*
//   Folge     : <Dateiname>-thumb.* · <Dateiname>.*
// ============================================================================
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, basename, extname } from "node:path";
import { fileStem, IMAGE_EXT } from "./parser.js";

const IMG_EXTS = ["jpg", "jpeg", "png", "webp", "bmp", "tbn"];

/** Verzeichnisinhalt als Map kleingeschrieben → echter Dateiname (1× lesen). */
function dirIndex(dir) {
  const out = new Map();
  try {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile()) out.set(e.name.toLowerCase(), e.name);
    }
  } catch {
    /* Ordner nicht lesbar */
  }
  return out;
}

/** Erste existierende Datei aus `bases` × Bildendungen. */
function pick(dir, index, bases) {
  for (const base of bases) {
    for (const ext of IMG_EXTS) {
      const real = index.get(`${base}.${ext}`.toLowerCase());
      if (real) return join(dir, real);
    }
  }
  return null;
}

/**
 * Lokale Bilder für eine Mediendatei bzw. einen Medienordner.
 * @param {string} dir     Ordner, in dem gesucht wird
 * @param {string|null} stem Dateiname ohne Endung (für "<Name>-poster.jpg")
 */
export function findLocalArtwork(dir, stem = null) {
  if (!dir || !existsSync(dir)) return { poster: null, backdrop: null, banner: null, logo: null, thumb: null };
  const index = dirIndex(dir);
  const s = stem ? stem.toLowerCase() : null;

  const posterBases = ["poster", "folder", "cover", "movie", "show", "default", "season-all-poster"];
  if (s) posterBases.unshift(`${s}-poster`);
  const backdropBases = ["fanart", "backdrop", "background", "art", "season-all-fanart"];
  if (s) backdropBases.unshift(`${s}-fanart`, `${s}-backdrop`);
  const bannerBases = ["banner"];
  if (s) bannerBases.unshift(`${s}-banner`);
  const logoBases = ["logo", "clearlogo"];
  if (s) logoBases.unshift(`${s}-logo`, `${s}-clearlogo`);
  const thumbBases = [];
  if (s) thumbBases.push(`${s}-thumb`, `${s}-landscape`, s);
  thumbBases.push("thumb", "landscape");

  let backdrop = pick(dir, backdropBases.length ? index : index, backdropBases);
  // Jellyfin/Kodi: extrafanart/ mit mehreren Bildern → das erste nehmen
  if (!backdrop) {
    const extra = join(dir, "extrafanart");
    try {
      if (statSync(extra).isDirectory()) {
        const first = readdirSync(extra).find((f) => IMAGE_EXT.has(extname(f).slice(1).toLowerCase()));
        if (first) backdrop = join(extra, first);
      }
    } catch {
      /* kein extrafanart */
    }
  }

  return {
    poster: pick(dir, index, posterBases),
    backdrop,
    banner: pick(dir, index, bannerBases),
    logo: pick(dir, index, logoBases),
    thumb: pick(dir, index, thumbBases),
  };
}

/**
 * Staffelposter im Serienordner: "season01-poster.jpg", "season-specials-poster.jpg"
 * oder "Season 1/poster.jpg".
 * @returns {Map<number,string>} Staffelnummer → Dateipfad
 */
export function findSeasonArtwork(showDir) {
  const out = new Map();
  if (!showDir || !existsSync(showDir)) return out;
  const index = dirIndex(showDir);
  for (const [lower, real] of index) {
    const m = /^season[ _-]?(\d{1,3}|specials?)[ _-]?(?:poster)?\.(jpg|jpeg|png|webp|bmp|tbn)$/.exec(lower);
    if (!m) continue;
    const season = /^special/.test(m[1]) ? 0 : parseInt(m[1], 10);
    if (Number.isFinite(season) && !out.has(season)) out.set(season, join(showDir, real));
  }
  // Staffelordner mit eigenem poster.jpg
  try {
    for (const e of readdirSync(showDir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const m = /^(?:season|staffel|saison|s)\s*0*(\d{1,3})$/i.exec(e.name.trim());
      const season = m ? parseInt(m[1], 10) : /^special/i.test(e.name.trim()) ? 0 : null;
      if (season == null || out.has(season)) continue;
      const sub = join(showDir, e.name);
      const art = pick(sub, dirIndex(sub), ["poster", "folder", "cover"]);
      if (art) out.set(season, art);
    }
  } catch {
    /* nicht lesbar */
  }
  return out;
}

// ── .nfo (Kodi/Jellyfin/Plex-Export) ────────────────────────────────────────

const tag = (xml, name) => {
  const m = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  return m ? m[1].trim().replace(/<!\[CDATA\[|\]\]>/g, "").trim() : null;
};

/**
 * .nfo neben der Datei/im Ordner lesen. Unterstützt sowohl das Kodi-XML als
 * auch die "nur eine URL"-Variante (dann ziehen wir die TMDb-ID aus der URL).
 */
export function readNfo(videoPath) {
  const dir = dirname(videoPath);
  const stem = fileStem(basename(videoPath));
  const candidates = [
    join(dir, `${stem}.nfo`),
    join(dir, "movie.nfo"),
    join(dir, "tvshow.nfo"),
    join(dir, "episode.nfo"),
  ];
  for (const file of candidates) {
    let raw;
    try {
      if (!statSync(file).isFile()) continue;
      raw = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    if (!raw.trim()) continue;

    // Variante "nur URL"
    const urlId = /themoviedb\.org\/(?:movie|tv)\/(\d+)/i.exec(raw);
    const uniqueTmdb = /<uniqueid[^>]*type=["']tmdb["'][^>]*>(\d+)</i.exec(raw);
    const tmdbTag = tag(raw, "tmdbid") || tag(raw, "tmdb");
    const tmdbId = parseInt(uniqueTmdb?.[1] ?? tmdbTag ?? urlId?.[1] ?? "", 10);

    const yearRaw = tag(raw, "year") || (tag(raw, "premiered") || tag(raw, "releasedate") || "").slice(0, 4);
    const out = {
      file,
      tmdbId: Number.isFinite(tmdbId) && tmdbId > 0 ? tmdbId : null,
      imdbId: tag(raw, "imdbid") || /tt\d{6,}/.exec(raw)?.[0] || null,
      title: tag(raw, "title") || tag(raw, "originaltitle") || null,
      showTitle: tag(raw, "showtitle") || null,
      year: /^\d{4}$/.test(yearRaw || "") ? parseInt(yearRaw, 10) : null,
      plot: tag(raw, "plot") || tag(raw, "outline") || null,
      season: parseInt(tag(raw, "season") ?? "", 10),
      episode: parseInt(tag(raw, "episode") ?? "", 10),
    };
    if (!Number.isFinite(out.season)) out.season = null;
    if (!Number.isFinite(out.episode)) out.episode = null;
    // eine .nfo ohne jede verwertbare Angabe überspringen
    if (out.tmdbId || out.title || out.plot) return out;
  }
  return null;
}

/** MIME-Typ für eine lokale Bilddatei. */
export function imageMime(path) {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".bmp":
      return "image/bmp";
    default:
      return "image/jpeg";
  }
}

/**
 * Bildpfade werden als "local:<absoluter Pfad>" in der DB gespeichert, damit
 * die bestehenden TMDb-Pfade ("/abc.jpg") unverändert weiterfunktionieren.
 */
export const LOCAL_PREFIX = "local:";
export const asLocalRef = (p) => (p ? LOCAL_PREFIX + p : null);
export const isLocalRef = (p) => typeof p === "string" && p.startsWith(LOCAL_PREFIX);
export const localRefPath = (p) => (isLocalRef(p) ? p.slice(LOCAL_PREFIX.length) : null);

// ============================================================================
// TMDb — Metadaten, Treffer-Bewertung und Bild-Cache
//
// Die Trefferauswahl ist ein 1:1-Port der Desktop-Logik aus
// `src-tauri/src/scanner.rs` (search_query / search_with_fallback /
// token_overlap / best_tv_match). Der Server hat vorher stumpf das ERSTE
// Suchergebnis genommen — deshalb landete z. B. eine 13-teilige "Daredevil"-
// Staffel bei "Daredevil: Born Again" statt beim Original.
//
// Bilder werden auf Platte zwischengespeichert, damit das NAS Artwork nie
// zweimal herunterlädt.
// ============================================================================
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, settingOr } from "./db.js";
import { lettersOnly, cleanSearchQuery } from "./parser.js";

const BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";
const IMG_DIR = join(DATA_DIR, "img-cache");

const key = () => settingOr("tmdb_key", "TMDB_API_KEY", "");
const lang = () => settingOr("tmdb_lang", "TMDB_LANG", "de-DE");

/** Länderkürzel aus der Sprache ("de-DE" → "DE") für Altersfreigaben. */
const region = () => (lang().split("-")[1] || "DE").toUpperCase();

// TMDb erlaubt ~50 Anfragen/Sekunde. Wir bremsen freiwillig auf ~10/s, damit
// ein großer Erst-Scan nicht in 429-Fehler läuft (die früher still zu
// "keine Metadaten" führten).
let lastCall = 0;
async function throttle() {
  const gap = 100;
  const wait = lastCall + gap - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function get(path, params = {}) {
  const k = key();
  if (!k) return null;
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", k);
  if (params.language !== null) url.searchParams.set("language", lang());
  for (const [a, b] of Object.entries(params)) {
    if (b == null) continue;
    url.searchParams.set(a, String(b));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    await throttle();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429) {
        // Rate-Limit: kurz warten und erneut versuchen statt still aufzugeben
        const retry = parseInt(res.headers.get("retry-after") || "2", 10) || 2;
        await new Promise((r) => setTimeout(r, Math.min(10, retry) * 1000));
        continue;
      }
      if (res.status === 401) {
        console.error("[tmdb] API-Key abgelehnt (401) — bitte in den Einstellungen prüfen");
        return null;
      }
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      if (attempt === 2) {
        console.warn(`[tmdb] ${path} fehlgeschlagen: ${String(e).slice(0, 120)}`);
        return null;
      }
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return null;
}

export const tmdbEnabled = () => !!key();

// ── Suche + Trefferbewertung (Desktop-Parität) ──────────────────────────────

/**
 * Suchbegriff für die Auto-Erkennung: NUR BUCHSTABEN (keine Ziffern, keine
 * Satzzeichen, kein Szene-Müll) — das rettet unsaubere Release-Namen am
 * zuverlässigsten. Fällt auf den ziffern-erhaltenden Reiniger zurück
 * (für Titel wie "9-1-1") und zuletzt auf den Rohtitel.
 */
export function searchQuery(title) {
  const a = lettersOnly(title);
  if (a.trim()) return a;
  const b = cleanSearchQuery(title);
  return b.trim() ? b : String(title);
}

const mapHit = (x, defaultKind) => {
  const kind = x.media_type ?? defaultKind;
  if (kind !== "movie" && kind !== "tv") return null;
  const title = x.title ?? x.name;
  if (!title) return null;
  return {
    tmdbId: x.id,
    mediaType: kind,
    title,
    year: parseInt((x.release_date || x.first_air_date || "").slice(0, 4), 10) || null,
    overview: x.overview || null,
    posterPath: x.poster_path ?? null,
    backdropPath: x.backdrop_path ?? null,
    rating: x.vote_average ?? null,
    popularity: x.popularity ?? 0,
  };
};

/** Rohe Suche (eine Anfrage). */
export async function searchRaw(query, kind, year = null) {
  const path = kind === "movie" ? "/search/movie" : kind === "tv" ? "/search/tv" : "/search/multi";
  const params = { query, include_adult: "false" };
  if (year && kind === "movie") params.year = year;
  if (year && kind === "tv") params.first_air_date_year = year;
  const r = await get(path, params);
  const defaultKind = kind === "tv" ? "tv" : "movie";
  return (r?.results ?? []).map((x) => mapHit(x, defaultKind)).filter(Boolean);
}

/**
 * Suche mit Rückfallebenen: erst mit Jahr, dann ohne, dann mit immer kürzerem
 * Titel — rettet "Miraculouse - Tales of …" → "Miraculouse Tales …" → "Miraculouse".
 */
export async function searchWithFallback(query, kind, year = null) {
  const words = String(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  for (let n = words.length; n >= 1; n--) {
    const q = words.slice(0, n).join(" ");
    const res = await searchRaw(q, kind, year);
    if (res.length) return res;
    if (n === words.length && year != null) {
      const res2 = await searchRaw(q, kind, null);
      if (res2.length) return res2;
    }
  }
  return [];
}

const titleTokens = (s) => lettersOnly(s).toLowerCase().split(/\s+/).filter(Boolean);

/** Anteil der gesuchten Wörter, die im Kandidaten vorkommen (0…1). */
function tokenOverlap(want, cand) {
  if (want.length === 0) return 0;
  const set = new Set(cand);
  return want.filter((w) => set.has(w)).length / want.length;
}

/** Titel-/Jahres-Bewertung eines Kandidaten (Port von best_tv_match, Schritt 1). */
function scoreCandidates(results, query, year) {
  const want = titleTokens(query);
  const joinedWant = want.join(" ");
  return results
    .slice(0, 8)
    .map((r, i) => {
      const cand = titleTokens(r.title);
      const joinedCand = cand.join(" ");
      let s = 0;
      if (joinedCand === joinedWant && want.length) s += 100;
      if (joinedCand.startsWith(joinedWant) || joinedWant.startsWith(joinedCand)) s += 55;
      else if (joinedCand.includes(joinedWant) || joinedWant.includes(joinedCand)) s += 30;
      s += tokenOverlap(want, cand) * 25;
      if (year != null && r.year != null) {
        const d = Math.abs(year - r.year);
        s += d === 0 ? 28 : d <= 1 ? 14 : d <= 3 ? 4 : -Math.min(d, 25);
      }
      s -= i * 0.5; // sanfter Schubs Richtung TMDb-eigenem Ranking
      return { score: s, order: i, id: r.tmdbId, hit: r };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Besten Serien-Treffer wählen. TITEL + JAHR zuerst; die TMDb-Gesamtfolgenzahl
 * ist nur Stichentscheid zwischen sonst gleichwertigen Kandidaten.
 */
export async function bestTvMatch(query, year, localEps = 0) {
  const results = await searchWithFallback(query, "tv", year);
  if (!results.length) return null;
  const scored = scoreCandidates(results, query, year);
  const top = scored[0].score;
  const contenders = scored.filter((c) => top - c.score < 12).sort((a, b) => a.order - b.order);
  if (contenders.length === 1 || localEps < 3) return contenders[0].id;

  // Letzte Instanz: passt unsere lokale Folgenzahl überhaupt in den Kandidaten?
  // (Nie umgekehrt — eine große Serie ist für eine einzelne Staffel in Ordnung.)
  for (const c of contenders) {
    const det = await get(`/tv/${c.id}`);
    const total = det?.number_of_episodes ?? 0;
    if (localEps <= total + 2) return c.id;
  }
  return contenders[0].id;
}

/** Besten Film-Treffer wählen (gleiche Bewertung, ohne Folgen-Stichentscheid). */
export async function bestMovieMatch(query, year) {
  const results = await searchWithFallback(query, "movie", year);
  if (!results.length) return null;
  const scored = scoreCandidates(results, query, year);
  const top = scored[0].score;
  const contenders = scored.filter((c) => top - c.score < 12).sort((a, b) => a.order - b.order);
  return contenders[0].id;
}

// Rückwärtskompatible Kurzformen (alter Server-Code)
export async function searchShow(title, year) {
  const id = await bestTvMatch(searchQuery(title), year ?? null, 0);
  return id ? { id } : null;
}
export async function searchMovie(title, year) {
  const id = await bestMovieMatch(searchQuery(title), year ?? null);
  return id ? { id } : null;
}

// ── Details ─────────────────────────────────────────────────────────────────

export const showDetails = (id) => get(`/tv/${id}`, { append_to_response: "content_ratings" });
export const movieDetails = (id) => get(`/movie/${id}`, { append_to_response: "release_dates" });
export const seasonDetails = (id, season) => get(`/tv/${id}/season/${season}`);

export const genreNames = (obj) => (obj?.genres ?? []).map((g) => g.name).join(", ") || null;

/** Deutsche Freigabe bevorzugen, sonst US, sonst die erste vorhandene. */
function pickCert(entries) {
  const all = entries.filter(([, c]) => c && String(c).trim());
  const by = (cc) => all.find(([l]) => l === cc)?.[1];
  const de = by(region()) ?? by("DE");
  if (de) return /^\d+$/.test(de) ? `FSK ${de}` : de;
  return by("US") ?? all[0]?.[1] ?? null;
}

/**
 * Vollständige Film-Metadaten in einer Anfrage (inkl. Altersfreigabe) —
 * spart pro Film einen zusätzlichen Aufruf gegenüber vorher.
 */
export async function movieMeta(tmdbId) {
  const r = await movieDetails(tmdbId);
  if (!r) return null;
  return {
    tmdbId: r.id,
    title: r.title ?? null,
    originalTitle: r.original_title ?? null,
    year: parseInt((r.release_date || "").slice(0, 4), 10) || null,
    overview: r.overview?.trim() || null,
    tagline: r.tagline?.trim() || null,
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
    genres: (r.genres ?? []).map((g) => g.name),
    runtime: r.runtime ?? null,
    rating: r.vote_average ?? null,
    cert: pickCert(
      (r.release_dates?.results ?? []).flatMap((c) =>
        (c.release_dates ?? []).map((e) => [c.iso_3166_1, e.certification]),
      ),
    ),
  };
}

/** Vollständige Serien-Metadaten in einer Anfrage (inkl. Altersfreigabe). */
export async function showMeta(tmdbId) {
  const r = await showDetails(tmdbId);
  if (!r) return null;
  return {
    tmdbId: r.id,
    title: r.name ?? null,
    originalTitle: r.original_name ?? null,
    year: parseInt((r.first_air_date || "").slice(0, 4), 10) || null,
    lastYear: parseInt((r.last_air_date || "").slice(0, 4), 10) || null,
    overview: r.overview?.trim() || null,
    tagline: r.tagline?.trim() || null,
    posterPath: r.poster_path ?? null,
    backdropPath: r.backdrop_path ?? null,
    genres: (r.genres ?? []).map((g) => g.name),
    rating: r.vote_average ?? null,
    status: r.status ?? null,
    runtime: r.episode_run_time?.[0] ?? null,
    episodeCount: r.number_of_episodes ?? null,
    seasons: (r.seasons ?? []).map((s) => ({
      season: s.season_number,
      posterPath: s.poster_path ?? null,
      episodeCount: s.episode_count ?? null,
      overview: s.overview?.trim() || null,
    })),
    cert: pickCert((r.content_ratings?.results ?? []).map((c) => [c.iso_3166_1, c.rating])),
  };
}

// ── Bilder ──────────────────────────────────────────────────────────────────

const VALID_SIZE = /^(w\d{2,4}|h\d{2,4}|original)$/;

/**
 * TMDb-Bild ("/abc.jpg") über den Plattencache ausliefern.
 * Erlaubte Größen: w92…w1280, h632, original.
 */
export async function cachedImage(tmdbPath, size = "w342") {
  if (!/^\/[\w.-]+\.(jpg|png|webp)$/i.test(tmdbPath)) return null;
  if (!VALID_SIZE.test(size)) size = "w342";
  mkdirSync(IMG_DIR, { recursive: true });
  const local = join(IMG_DIR, `${size}_${tmdbPath.slice(1)}`);
  if (existsSync(local)) {
    // leere/abgebrochene Downloads aus früheren Läufen nicht ewig ausliefern
    try {
      if (statSync(local).size > 0) return createReadStream(local);
    } catch {
      /* neu laden */
    }
  }
  try {
    const res = await fetch(`${IMG_BASE}/${size}${tmdbPath}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    await writeFile(local, buf);
  } catch {
    return null;
  }
  return createReadStream(local);
}

/** Suchergebnisse als Liste in der Desktop-Form (TmdbResult). */
export async function searchList(query, kind = "multi") {
  const rows = await searchRaw(query, kind === "tv" ? "tv" : kind === "movie" ? "movie" : "multi", null);
  return rows.slice(0, 20).map((x) => ({
    tmdbId: x.tmdbId,
    mediaType: x.mediaType,
    title: x.title,
    year: x.year,
    overview: x.overview,
    posterPath: x.posterPath,
    backdropPath: x.backdropPath,
    rating: x.rating,
  }));
}

/** Artwork-Kandidaten (Plex-artiger Bild-Auswahldialog). */
export async function images(kind, tmdbId, season = null, episode = null) {
  let path = kind === "movie" ? `/movie/${tmdbId}/images` : `/tv/${tmdbId}/images`;
  if (kind === "season") path = `/tv/${tmdbId}/season/${season}/images`;
  if (kind === "episode") path = `/tv/${tmdbId}/season/${season}/episode/${episode}/images`;
  // ohne Sprachfilter anfragen, damit wirklich alle Varianten kommen …
  const j = await get(path, { language: null, include_image_language: "de,en,null" });
  if (!j) return [];
  const map = (arr, kindName) =>
    (arr ?? []).map((i) => ({
      filePath: i.file_path,
      kind: kindName,
      width: i.width ?? null,
      height: i.height ?? null,
      voteAverage: i.vote_average ?? null,
      lang: i.iso_639_1 ?? null,
    }));
  // … und die besten (Bewertung, dann Auflösung) zuerst zeigen
  const byQuality = (a, b) => (b.voteAverage ?? 0) - (a.voteAverage ?? 0) || (b.width ?? 0) - (a.width ?? 0);
  return [
    ...map(j.posters, "poster").sort(byQuality),
    ...map(j.backdrops, "backdrop").sort(byQuality),
    ...map(j.stills, "still").sort(byQuality),
    ...map(j.logos, "logo").sort(byQuality),
  ];
}

/** Bestes Logo (transparentes PNG) für die Detailseite. */
export async function bestLogo(kind, tmdbId) {
  const j = await get(kind === "movie" ? `/movie/${tmdbId}/images` : `/tv/${tmdbId}/images`, {
    language: null,
    include_image_language: `${lang().split("-")[0]},en,null`,
  });
  const logos = j?.logos ?? [];
  const png = logos.filter((l) => (l.file_path || "").toLowerCase().endsWith(".png"));
  const pool = png.length ? png : logos;
  return pool.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0]?.file_path ?? null;
}

/* ── Trailer (Punkt 4) ─────────────────────────────────────────────────────
   TMDb liefert Videos IMMER nur in genau einer Sprache. Bisher wurde deshalb
   die eingestellte Sprache geholt und erst bei völliger Leere auf Englisch
   ausgewichen — Ergebnis: gibt es einen deutschen Teaser, sah man den
   englischen Haupttrailer nie.

   Jetzt werden beide Sprachen geholt und zusammengeführt; die Oberfläche
   bietet die gefundenen Sprachen zur Auswahl an. Doppelte (gleicher
   YouTube-Schlüssel) fallen weg. */
const VIDEO_RANG = { Trailer: 0, Teaser: 1, Clip: 2, Featurette: 3, "Behind the Scenes": 4, Bloopers: 5 };

function videoAus(v, season = null) {
  return {
    key: v.key,
    name: v.name ?? "",
    site: v.site ?? "",
    type: v.type ?? "",
    lang: v.iso_639_1 || null,
    region: v.iso_3166_1 || null,
    official: !!v.official,
    publishedAt: v.published_at ?? null,
    size: v.size ?? null,
    season,
  };
}

function videosSortieren(list) {
  return list.sort(
    (a, b) =>
      (VIDEO_RANG[a.type] ?? 9) - (VIDEO_RANG[b.type] ?? 9) ||
      Number(b.official) - Number(a.official) ||
      String(b.publishedAt ?? "").localeCompare(String(a.publishedAt ?? "")),
  );
}

/** Videos zu einem Titel — oder zu EINER Staffel, wenn `season` gesetzt ist. */
export async function videos(kind, tmdbId, season = null) {
  const base = kind === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const pfad = season != null ? `${base}/season/${season}/videos` : `${base}/videos`;
  // Eingestellte Sprache UND Englisch — sonst fehlen je nach Titel die Hälfte.
  const [eigene, en] = await Promise.all([get(pfad), get(pfad, { language: "en-US" })]);
  const zusammen = [...(eigene?.results ?? []), ...(en?.results ?? [])];
  const gesehen = new Set();
  const raus = [];
  for (const v of zusammen) {
    if (v.site !== "YouTube" || !v.key || gesehen.has(v.key)) continue;
    gesehen.add(v.key);
    raus.push(videoAus(v, season));
  }
  return videosSortieren(raus);
}

/** Trailer + Besetzung für die Detailseiten. */
export async function extras(kind, tmdbId) {
  const base = kind === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const [alle, credits] = await Promise.all([videos(kind, tmdbId), get(`${base}/credits`)]);
  // trailerKey bleibt für den alten "Trailer ansehen"-Knopf erhalten.
  const trailer =
    alle.find((v) => v.type === "Trailer" && v.official) ??
    alle.find((v) => v.type === "Trailer") ??
    alle[0];
  return {
    trailerKey: trailer?.key ?? null,
    videos: alle,
    cast: (credits?.cast ?? []).slice(0, 20).map((c) => ({
      name: c.name,
      character: c.character ?? null,
      profilePath: c.profile_path ?? null,
    })),
  };
}

/** Welche Staffelnummern es gibt. */
export async function seasonNumbers(tmdbId) {
  const det = await showDetails(tmdbId);
  return (det?.seasons ?? []).map((s) => s.season_number).sort((a, b) => a - b);
}

/** Folgenliste einer Staffel in der Desktop-Form (TmdbEpisodeInfo). */
export async function seasonEpisodeList(tmdbId, season) {
  const det = await seasonDetails(tmdbId, season);
  return (det?.episodes ?? []).map((e) => ({
    episode: e.episode_number,
    title: e.name ?? null,
    overview: e.overview?.trim() || null,
    stillPath: e.still_path ?? null,
    airDate: e.air_date ?? null,
    runtime: e.runtime ?? null,
  }));
}

/** Altersfreigabe (FSK) — einzeln abrufbar, sonst über movieMeta/showMeta. */
export async function certification(kind, tmdbId) {
  const meta = kind === "movie" ? await movieMeta(tmdbId) : await showMeta(tmdbId);
  return meta?.cert ?? null;
}

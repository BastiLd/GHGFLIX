// TMDb metadata + image cache. Uses the global fetch (Node 24) and caches
// every downloaded image on disk so the ZimaBoard never re-downloads artwork.
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR, settingOr } from "./db.js";

const BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";
const IMG_DIR = join(DATA_DIR, "img-cache");

const key = () => settingOr("tmdb_key", "TMDB_API_KEY", "");
const lang = () => settingOr("tmdb_lang", "TMDB_LANG", "de-DE");

async function get(path, params = {}) {
  const k = key();
  if (!k) return null;
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", k);
  url.searchParams.set("language", lang());
  for (const [a, b] of Object.entries(params)) url.searchParams.set(a, String(b));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export const tmdbEnabled = () => !!key();

export async function searchShow(title, year) {
  const r = await get("/search/tv", { query: title, ...(year ? { first_air_date_year: year } : {}) });
  return r?.results?.[0] ?? (year ? (await get("/search/tv", { query: title }))?.results?.[0] : null) ?? null;
}

export async function searchMovie(title, year) {
  const r = await get("/search/movie", { query: title, ...(year ? { year } : {}) });
  return r?.results?.[0] ?? (year ? (await get("/search/movie", { query: title }))?.results?.[0] : null) ?? null;
}

export const showDetails = (id) => get(`/tv/${id}`);
export const movieDetails = (id) => get(`/movie/${id}`);
export const seasonDetails = (id, season) => get(`/tv/${id}/season/${season}`);

export const genreNames = (obj) => (obj?.genres ?? []).map((g) => g.name).join(", ") || null;

/** Serve a TMDb image path ("/abc.jpg") through the on-disk cache. */
export async function cachedImage(tmdbPath, size = "w342") {
  if (!/^\/[\w.-]+\.(jpg|png|webp)$/i.test(tmdbPath)) return null;
  if (!/^(w\d{2,4}|original)$/.test(size)) size = "w342";
  mkdirSync(IMG_DIR, { recursive: true });
  const local = join(IMG_DIR, `${size}_${tmdbPath.slice(1)}`);
  if (!existsSync(local)) {
    try {
      const res = await fetch(`${IMG_BASE}/${size}${tmdbPath}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) return null;
      await writeFile(local, Buffer.from(await res.arrayBuffer()));
    } catch {
      return null;
    }
  }
  return createReadStream(local);
}

// ───── desktop-app parity additions (invoke API) ─────

/** Search returning a LIST in the desktop app's TmdbResult shape. */
export async function searchList(query, kind = "multi") {
  const path = kind === "movie" ? "/search/movie" : kind === "tv" ? "/search/tv" : "/search/multi";
  const r = await get(path, { query, include_adult: "false" });
  const rows = (r?.results ?? []).filter((x) => kind !== "multi" || x.media_type === "movie" || x.media_type === "tv");
  return rows.slice(0, 20).map((x) => ({
    tmdbId: x.id,
    mediaType: kind === "multi" ? x.media_type : kind,
    title: x.title ?? x.name ?? "?",
    year: parseInt((x.release_date || x.first_air_date || "").slice(0, 4), 10) || null,
    overview: x.overview ?? null,
    posterPath: x.poster_path ?? null,
    backdropPath: x.backdrop_path ?? null,
    rating: x.vote_average ?? null,
  }));
}

/** Artwork candidates (Plex-style picker). kind: movie|tv|season|episode. */
export async function images(kind, tmdbId, season = null, episode = null) {
  let path = kind === "movie" ? `/movie/${tmdbId}/images` : `/tv/${tmdbId}/images`;
  if (kind === "season") path = `/tv/${tmdbId}/season/${season}/images`;
  if (kind === "episode") path = `/tv/${tmdbId}/season/${season}/episode/${episode}/images`;
  const k = key();
  if (!k) return [];
  // images endpoint: request without language filter so we get everything
  const url = new URL(BASE + path);
  url.searchParams.set("api_key", k);
  let j = null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    j = res.ok ? await res.json() : null;
  } catch { /* ignore */ }
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
  return [...map(j.posters, "poster"), ...map(j.backdrops, "backdrop"), ...map(j.stills, "still")];
}

/** Trailer + cast for the detail pages. */
export async function extras(kind, tmdbId) {
  const base = kind === "movie" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const [videos, credits] = await Promise.all([get(`${base}/videos`), get(`${base}/credits`)]);
  const all = videos?.results ?? [];
  const trailer =
    all.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ??
    all.find((v) => v.site === "YouTube" && v.type === "Trailer") ??
    all.find((v) => v.site === "YouTube");
  return {
    trailerKey: trailer?.key ?? null,
    cast: (credits?.cast ?? []).slice(0, 20).map((c) => ({
      name: c.name,
      character: c.character ?? null,
      profilePath: c.profile_path ?? null,
    })),
  };
}

/** Which season numbers exist for a show. */
export async function seasonNumbers(tmdbId) {
  const det = await showDetails(tmdbId);
  return (det?.seasons ?? []).map((s) => s.season_number).sort((a, b) => a - b);
}

/** Episode list of one season in the desktop TmdbEpisodeInfo shape. */
export async function seasonEpisodeList(tmdbId, season) {
  const det = await seasonDetails(tmdbId, season);
  return (det?.episodes ?? []).map((e) => ({
    episode: e.episode_number,
    title: e.name ?? null,
    overview: e.overview ?? null,
    stillPath: e.still_path ?? null,
    airDate: e.air_date ?? null,
  }));
}

/** Certification (FSK/age rating) for movies and shows, best effort. */
export async function certification(kind, tmdbId) {
  if (kind === "movie") {
    const r = await get(`/movie/${tmdbId}/release_dates`);
    const pick = (cc) => r?.results?.find((x) => x.iso_3166_1 === cc)?.release_dates?.find((d) => d.certification)?.certification;
    return pick("DE") ?? pick("US") ?? null;
  }
  const r = await get(`/tv/${tmdbId}/content_ratings`);
  const pick = (cc) => r?.results?.find((x) => x.iso_3166_1 === cc)?.rating;
  return pick("DE") ?? pick("US") ?? null;
}

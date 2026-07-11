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

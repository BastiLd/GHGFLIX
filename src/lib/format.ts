import type { Movie } from "./types";

/** Collapse duplicate rips of the same movie (same TMDb id) into a single entry,
 *  keeping the highest-resolution file as the representative. Unmatched movies
 *  (no tmdbId) are always kept separate. */
export function dedupeMovies(list: Movie[]): Movie[] {
  const repIndex = new Map<number, number>();
  const out: Movie[] = [];
  for (const m of list) {
    if (m.tmdbId == null) {
      out.push(m);
      continue;
    }
    const existing = repIndex.get(m.tmdbId);
    if (existing == null) {
      repIndex.set(m.tmdbId, out.length);
      out.push(m);
    } else if ((m.height ?? 0) > (out[existing].height ?? 0)) {
      out[existing] = m;
    }
  }
  return out;
}

export function formatTime(totalSeconds: number): string {
  if (!isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds % 60);
  const m = Math.floor((totalSeconds / 60) % 60);
  const h = Math.floor(totalSeconds / 3600);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatRuntime(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h > 0) return `${h} Std. ${m} Min.`;
  return `${m} Min.`;
}

export function parseGenres(json?: string | null): string[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function seasonEpisodeLabel(season: number, episode: number): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `S${pad(season)} E${pad(episode)}`;
}

export function qualityLabel(path?: string | null): string | null {
  if (!path) return null;
  const p = path.toLowerCase();
  if (/2160p|\b4k\b|uhd/.test(p)) return "4K";
  if (/1440p|\bqhd\b/.test(p)) return "1440p";
  if (/1080p|fhd/.test(p)) return "1080p";
  if (/720p|\bhd\b/.test(p)) return "720p";
  if (/480p|360p|\bsd\b|dvdrip|dvdscr/.test(p)) return "SD";
  return null;
}

const TIERS: [number, string][] = [
  [4320, "8K"],
  [2160, "4K"],
  [1440, "1440p"],
  [1080, "1080p"],
  [720, "720p"],
  [480, "480p"],
  [0, "SD"],
];

/** Pick a quality label from the real resolution. Uses both height and an
 *  implied "height" from the width (≈ width / (16/9)) so widescreen / cinemascope
 *  files — where the stored height is smaller than the format suggests — are
 *  still classified by their true class (e.g. 1920×800 → 1080p, not 720p). */
export function qualityFromDims(width?: number | null, height?: number | null): string | null {
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 || h <= 0) return null;
  const effective = Math.max(h, Math.round((w * 9) / 16));
  for (const [min, label] of TIERS) {
    if (effective >= min - min * 0.12) return label; // 12% tolerance below each tier
  }
  return "SD";
}

/** Best available quality label: prefer the measured resolution, fall back to the
 *  filename. Works for any media item that carries width/height + path. */
export function quality(item?: {
  width?: number | null;
  height?: number | null;
  path?: string | null;
} | null): string | null {
  if (!item) return null;
  return qualityFromDims(item.width, item.height) ?? qualityLabel(item.path);
}

/** Kids mode: is an item allowed under the configured maximum age rating?
 *  Items WITHOUT a known rating are hidden when the filter is active (safe side). */
export function certAllowed(cert: string | null | undefined, max: "off" | "0" | "6" | "12" | "16"): boolean {
  if (max === "off") return true;
  const limit = parseInt(max, 10);
  const num = cert ? parseInt(cert.match(/\d+/)?.[0] ?? "", 10) : NaN;
  if (Number.isNaN(num)) return false;
  return num <= limit;
}

/** human file size */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function ratingText(rating?: number | null): string | null {
  if (rating == null || rating <= 0) return null;
  return rating.toFixed(1);
}

import { IS_WEB, withToken } from "./platform";

const TMDB_IMG = "https://image.tmdb.org/t/p";

/** Web build: go through the server's on-disk image cache (works offline in
 *  the LAN, saves TMDb traffic). Desktop: straight to TMDb like before. */
function img(path: string, size: string): string {
  if (IS_WEB) return withToken(`/api/img?path=${encodeURIComponent(path)}&size=${size}`);
  return `${TMDB_IMG}/${size}${path}`;
}

export function posterUrl(path?: string | null, size: "w185" | "w342" | "w500" = "w342"): string | null {
  return path ? img(path, size) : null;
}

export function backdropUrl(path?: string | null, size: "w780" | "w1280" | "original" = "w1280"): string | null {
  return path ? img(path, size) : null;
}

export function stillUrl(path?: string | null, size: "w300" | "w500" = "w300"): string | null {
  return path ? img(path, size) : null;
}

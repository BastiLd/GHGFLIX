const TMDB_IMG = "https://image.tmdb.org/t/p";

export function posterUrl(path?: string | null, size: "w185" | "w342" | "w500" = "w342"): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

export function backdropUrl(path?: string | null, size: "w780" | "w1280" | "original" = "w1280"): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

export function stillUrl(path?: string | null, size: "w300" | "w500" = "w300"): string | null {
  return path ? `${TMDB_IMG}/${size}${path}` : null;
}

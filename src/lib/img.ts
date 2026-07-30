import { IS_WEB, withToken } from "./platform";

const TMDB_IMG = "https://image.tmdb.org/t/p";

/**
 * Lokale Bilddatei (poster.jpg / fanart.jpg neben dem Film, oder ein aus dem
 * Video geschnittenes Standbild). Der Server liefert solche Pfade als
 * "local:<Pfad>" aus — sie haben keine TMDb-Größen und gehen unverändert
 * durch den Bild-Proxy.
 */
const isLocal = (path: string) => path.startsWith("local:");

/**
 * Web-Build: über den Bild-Cache des Servers (funktioniert im LAN auch ohne
 * Internet und spart TMDb-Traffic). Desktop: direkt zu TMDb.
 */
function img(path: string, size: string): string {
  if (isLocal(path)) {
    // Lokale Dateien kann nur der Server ausliefern. Im Desktop-Build gibt es
    // sie nicht — dort führt der Pfad ins Leere, deshalb lieber nichts liefern.
    return IS_WEB ? withToken(`/api/img?path=${encodeURIComponent(path)}`) : "";
  }
  if (IS_WEB) return withToken(`/api/img?path=${encodeURIComponent(path)}&size=${size}`);
  return `${TMDB_IMG}/${size}${path}`;
}

/**
 * Poster (Hochformat 2:3) — die kleine Kachel in den Reihen.
 * Größen bewusst großzügig: auf 4K-Bildschirmen und im TV-Modus waren w185/w342
 * sichtbar matschig.
 */
export function posterUrl(
  path?: string | null,
  size: "w185" | "w342" | "w500" | "w780" = "w500",
): string | null {
  if (!path) return null;
  const url = img(path, size);
  return url || null;
}

/**
 * Hintergrundbild (Querformat 16:9) — das große Bild hinter Titel/Buttons.
 * Für den Hero-Bereich lohnt "original", weil das Bild bildschirmfüllend läuft.
 */
export function backdropUrl(
  path?: string | null,
  size: "w780" | "w1280" | "original" = "w1280",
): string | null {
  if (!path) return null;
  const url = img(path, size);
  return url || null;
}

/** Folgen-Standbild (Querformat). */
export function stillUrl(path?: string | null, size: "w300" | "w500" | "original" = "w500"): string | null {
  if (!path) return null;
  const url = img(path, size);
  return url || null;
}

/**
 * Passende Bildgröße zur tatsächlichen Anzeigebreite wählen (inkl.
 * Geräte-Pixelverhältnis). So ist ein Poster auf einem 4K-Fernseher scharf,
 * ohne dass ein Handy unnötig große Dateien lädt.
 */
export function posterUrlFor(path: string | null | undefined, cssWidth: number): string | null {
  const dpr = typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const need = cssWidth * dpr;
  const size = need <= 185 ? "w185" : need <= 342 ? "w342" : need <= 500 ? "w500" : "w780";
  return posterUrl(path, size);
}

/** Dasselbe für Hintergrundbilder. */
export function backdropUrlFor(path: string | null | undefined, cssWidth: number): string | null {
  const dpr = typeof window !== "undefined" ? Math.min(3, window.devicePixelRatio || 1) : 1;
  const need = cssWidth * dpr;
  const size = need <= 780 ? "w780" : need <= 1280 ? "w1280" : "original";
  return backdropUrl(path, size);
}

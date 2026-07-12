/** Platform detection: the SAME React app runs in two shells —
 *  1. Tauri (Windows desktop app, mpv player, Rust/SQLite backend)
 *  2. Browser (served by the GHGFlix server / ZimaOS Docker container,
 *     HTML5 video player, Node/SQLite backend behind /api/invoke).
 *
 *  Everything platform-specific goes through the shims in backend.ts and
 *  mpv.ts so the pages/components stay byte-for-byte identical. */

export const IS_TAURI: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);

export const IS_WEB = !IS_TAURI;

/** Auth token for the web server (set by the web login screen when the
 *  server has a password; empty when the server is open). */
export const webToken = () => localStorage.getItem("ghgflix.web.token") || "";
export const setWebToken = (t: string) => localStorage.setItem("ghgflix.web.token", t);

/** Query-string fragment for URLs that can't send headers (video src, images). */
export const tokenParam = () => (webToken() ? `token=${encodeURIComponent(webToken())}` : "");

/** Append the token to a same-origin API url when needed. */
export function withToken(url: string): string {
  const t = tokenParam();
  if (!t) return url;
  return url + (url.includes("?") ? "&" : "?") + t;
}

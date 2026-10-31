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

let remoteBase: string | null = null;
let accountKey = '';
export const serverBase = () => remoteBase ?? '';
export const usesServer = () => IS_WEB || remoteBase !== null;
export function configureAccountServer(base:string|null,id:string) { remoteBase=base;accountKey=id ? `ghgflix.account.${id}` : ''; }
export const accountToken = () => accountKey ? localStorage.getItem(accountKey) || '' : '';
export function setAccountToken(token:string) { if(accountKey) { if(token)localStorage.setItem(accountKey,token);else localStorage.removeItem(accountKey); } }

/** Auth token for the web server (set by the web login screen when the
 *  server has a password; empty when the server is open). */
export const serverToken = () => localStorage.getItem("ghgflix.web.token") || "";
export const webToken = () => accountToken() || serverToken();
export const setWebToken = (t: string) => localStorage.setItem("ghgflix.web.token", t);

/** Only the still-current personal session may expire. A gateway request or a
 * late response from a previous server/account must not reset an open form. */
export function notifyAccountExpired(base: string, token: string) {
  if (token && base === serverBase() && token === accountToken()) {
    window.dispatchEvent(new CustomEvent('ghgflix:account-required'));
  }
}

/** Query-string fragment for URLs that can't send headers (video src, images). */
export const tokenParam = () => (webToken() ? `token=${encodeURIComponent(webToken())}` : "");

/** Append the token to a same-origin API url when needed. */
export function withToken(url: string): string {
  if (url.startsWith('/api/')) url=serverBase()+url;
  const t = tokenParam();
  if (!t) return url;
  return url + (url.includes("?") ? "&" : "?") + t;
}

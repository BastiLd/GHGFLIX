/** TV-Modus (Masterplan TV-044/TV-045/TV-046): macht die Server-Weboberfläche
 *  auf JEDEM Smart-TV-Browser per Fernbedienung bedienbar — ganz ohne App-
 *  Installation. Aktivierung:
 *   - automatisch per User-Agent-Erkennung (Tizen/webOS/Android TV/Fire TV …)
 *   - manuell über den Schalter in Einstellungen → Allgemein
 *   - per Link: http://<server>:8484/?tv=1 (TV-047)
 *
 *  Pfeiltasten bewegen den Fokus räumlich zwischen allen klickbaren Elementen
 *  (2D-Grid-Navigation, TV-007-Prinzip), Enter/OK klickt (Browser-nativ),
 *  Zurück-Taste (Escape / webOS 461 / Tizen 10009) geht eine Seite zurück. */
import { IS_WEB } from "./platform";

const PREF_KEY = "ghgflix.tvMode"; // "on" | "off" | null (= Auto-Erkennung)

const TV_UA =
  /\b(smart-?tv|tizen|web0s|webos|netcast|googletv|android ?tv|aft\w|bravia|viera|hbbtv|crkey|roku|philipstv|toshibatv)\b/i;

export function tvModePref(): "on" | "off" | "auto" {
  const p = localStorage.getItem(PREF_KEY);
  return p === "on" || p === "off" ? p : "auto";
}

export function setTvModePref(p: "on" | "off" | "auto"): void {
  if (p === "auto") localStorage.removeItem(PREF_KEY);
  else localStorage.setItem(PREF_KEY, p);
}

export function tvModeActive(): boolean {
  const p = tvModePref();
  if (p === "on") return true;
  if (p === "off") return false;
  return TV_UA.test(navigator.userAgent);
}

// ── räumliche Fokus-Navigation ────────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function candidates(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    // grob sichtbar (etwas Puffer für Reihen, in die man hineinscrollen kann)
    return r.bottom > -200 && r.top < window.innerHeight + 200 && r.right > -200 && r.left < window.innerWidth + 200;
  });
}

function center(r: DOMRect): { x: number; y: number } {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** Nächstes Element in Pfeilrichtung: Hauptdistanz + doppelt gewichteter
 *  Querversatz (bevorzugt Elemente, die wirklich "in der Linie" liegen). */
function nearest(from: HTMLElement, dir: "left" | "right" | "up" | "down"): HTMLElement | null {
  const fr = center(from.getBoundingClientRect());
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates()) {
    if (el === from) continue;
    const c = center(el.getBoundingClientRect());
    const dx = c.x - fr.x;
    const dy = c.y - fr.y;
    let main = 0;
    let cross = 0;
    if (dir === "left") [main, cross] = [-dx, Math.abs(dy)];
    else if (dir === "right") [main, cross] = [dx, Math.abs(dy)];
    else if (dir === "up") [main, cross] = [-dy, Math.abs(dx)];
    else [main, cross] = [dy, Math.abs(dx)];
    if (main <= 4) continue; // nicht in dieser Richtung
    const score = main + cross * 2;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  return best;
}

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const t = el.tagName;
  return t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || (el as HTMLElement).isContentEditable;
}

const BACK_KEYS = new Set(["Escape", "GoBack", "BrowserBack", "XF86Back"]);
const BACK_CODES = new Set([461 /* webOS */, 10009 /* Tizen */, 166 /* KEY_BACK */]);

function onKey(e: KeyboardEvent): void {
  // Zurück (TV-040): Fernbedienungs-Zurück → eine Seite zurück
  if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode)) {
    if (isTextField(document.activeElement)) return (document.activeElement as HTMLElement).blur();
    e.preventDefault();
    history.back();
    return;
  }
  const dir =
    e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : e.key === "ArrowDown" ? "down" : null;
  if (!dir) return;
  // In Textfeldern navigieren Links/Rechts den Cursor — nicht kapern.
  if (isTextField(document.activeElement) && (dir === "left" || dir === "right")) return;

  const active = (document.activeElement as HTMLElement | null) ?? null;
  const from = active && active !== document.body ? active : null;
  const target = from ? nearest(from, dir) : candidates()[0] ?? null;
  if (target) {
    e.preventDefault();
    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }
}

let installed = false;

/** Einmalig beim App-Start aufrufen (main.tsx). */
export function initTvMode(): void {
  if (!IS_WEB) return;
  // TV-047: Link "…/?tv=1" aktiviert den Modus dauerhaft auf diesem Gerät
  if (/[?&#]tv=1\b/.test(location.href)) setTvModePref("on");
  if (!tvModeActive() || installed) return;
  installed = true;
  document.body.classList.add("tv-mode");
  window.addEventListener("keydown", onKey);
  // Startfokus, sobald die App gerendert hat
  setTimeout(() => {
    if (document.activeElement === document.body) candidates()[0]?.focus();
  }, 800);
}

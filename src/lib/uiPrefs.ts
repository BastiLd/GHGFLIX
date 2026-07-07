import { create } from "zustand";
import { getSetting, setSetting } from "./api";

/** All user-tunable UI/behaviour preferences, loaded ONCE from the backend
 *  settings table at app start. Components subscribe via `useUiPrefs`; writing
 *  through `setPref` persists immediately. Defaults live here in one place. */
export interface UiPrefs {
  // ── appearance ──
  cardSize: "sm" | "md" | "lg";
  animations: boolean; // page fades + hover transitions
  hoverZoom: boolean; // card scale-up on hover
  pageTransition: boolean;
  badgeUnmatched: boolean; // "Nicht erkannt" badges
  badgeNew: boolean; // "NEU" badge on recently added
  badgeWatched: boolean; // ✓ on fully watched
  // ── home ──
  heroEnabled: boolean;
  heroMode: "random" | "newest";
  heroRotateSec: number; // 0 = off
  rowContinue: boolean;
  rowRecent: boolean;
  rowMyList: boolean;
  rowShows: boolean;
  rowMovies: boolean;
  rowGenres: boolean;
  rowTopRated: boolean;
  rowHistory: boolean; // "Zuletzt gesehen"
  genreRowCount: number;
  startPage: "home" | "movies" | "shows" | "list";
  // ── scrolling ──
  scrollSpeed: number; // multiplier 0.5–3
  scrollSmooth: boolean;
  /** plain vertical wheel scrolls a row horizontally while hovering it — for
   *  mice whose thumb/tilt wheel doesn't reach the app (e.g. some MX Master
   *  configs). The page still scrolls when the cursor is not over a row. */
  wheelRowScroll: boolean;
  // ── player ──
  seekSmall: number;
  seekBig: number;
  volumeStep: number;
  volumeMax: number; // 100–150
  uiTimeoutSec: number;
  dblClickSeek: boolean;
  autoplayNext: boolean;
  nextCountdownSec: number;
  endAutoBack: boolean;
  thumbEnabled: boolean;
  subScale: number; // 0.5–2
  audioLangPref: "en-de" | "de-en" | "file";
  rememberTrackLang: boolean;
  pipSize: "sm" | "md" | "lg";
  // ── mini player & queue ──
  miniPlayer: boolean; // back button → YouTube-style mini player
  miniSize: "sm" | "md" | "lg";
  // ── player extras ──
  screenshotEnabled: boolean;
  showClock: boolean; // current time in the player top bar
  showEndsAt: boolean; // "endet um 21:47"
  watchedThreshold: number; // % at which something counts as watched
  chapterMarkers: boolean; // ticks on the seek bar
  introMarker: boolean; // highlighted intro segment on the seek bar
  // ── library / display extras ──
  epLocalStills: boolean; // extract a frame for episodes without TMDb image
  kidsMaxCert: "off" | "0" | "6" | "12" | "16"; // hide above this FSK
  fontScale: number; // UI zoom %, 80–130
  sidebarCompact: boolean;
  greeting: boolean; // "Guten Abend, Basti" on Home
  updateCheck: boolean; // check GitHub for newer releases
  autoBackup: boolean; // weekly watched-data backup into app-data
  // ── misc ──
  toastSec: number;
  mascot: "off" | "blitz" | "katze" | "robo" | "geist" | "drache" | "pinguin";
  mascotTips: boolean;
}

export const DEFAULT_PREFS: UiPrefs = {
  cardSize: "md",
  animations: true,
  hoverZoom: true,
  pageTransition: true,
  badgeUnmatched: true,
  badgeNew: true,
  badgeWatched: true,
  heroEnabled: true,
  heroMode: "random",
  heroRotateSec: 0,
  rowContinue: true,
  rowRecent: true,
  rowMyList: true,
  rowShows: true,
  rowMovies: true,
  rowGenres: true,
  rowTopRated: true,
  rowHistory: true,
  genreRowCount: 8,
  startPage: "home",
  scrollSpeed: 1.8,
  scrollSmooth: true,
  wheelRowScroll: false,
  seekSmall: 10,
  seekBig: 60,
  volumeStep: 5,
  volumeMax: 100,
  uiTimeoutSec: 3,
  dblClickSeek: true,
  autoplayNext: true,
  nextCountdownSec: 15,
  endAutoBack: true,
  thumbEnabled: true,
  subScale: 1,
  audioLangPref: "en-de",
  rememberTrackLang: true,
  pipSize: "md",
  miniPlayer: true,
  miniSize: "md",
  screenshotEnabled: true,
  showClock: false,
  showEndsAt: true,
  watchedThreshold: 95,
  chapterMarkers: true,
  introMarker: true,
  epLocalStills: true,
  kidsMaxCert: "off",
  fontScale: 100,
  sidebarCompact: false,
  greeting: true,
  updateCheck: true,
  autoBackup: true,
  toastSec: 4,
  mascot: "off",
  mascotTips: true,
};

/** settings-table key for a pref (namespaced so they don't collide). */
const keyOf = (k: keyof UiPrefs) => `pref_${k}`;

function parse<K extends keyof UiPrefs>(k: K, raw: string | null): UiPrefs[K] {
  const def = DEFAULT_PREFS[k];
  if (raw == null || raw === "") return def;
  if (typeof def === "boolean") return (raw === "on") as UiPrefs[K];
  if (typeof def === "number") {
    const n = parseFloat(raw);
    return (Number.isFinite(n) ? n : def) as UiPrefs[K];
  }
  return raw as UiPrefs[K];
}

function serialize(v: UiPrefs[keyof UiPrefs]): string {
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v);
}

interface UiPrefsStore extends UiPrefs {
  loaded: boolean;
  load: () => Promise<void>;
  setPref: <K extends keyof UiPrefs>(k: K, v: UiPrefs[K]) => void;
}

export const useUiPrefs = create<UiPrefsStore>((set, get) => ({
  ...DEFAULT_PREFS,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    const keys = Object.keys(DEFAULT_PREFS) as (keyof UiPrefs)[];
    const values = await Promise.all(keys.map((k) => getSetting(keyOf(k)).catch(() => null)));
    const patch: Partial<UiPrefs> = {};
    keys.forEach((k, i) => {
      (patch as Record<string, unknown>)[k] = parse(k, values[i]);
    });
    set({ ...(patch as UiPrefs), loaded: true });
  },

  setPref: (k, v) => {
    set({ [k]: v } as Partial<UiPrefsStore>);
    void setSetting(keyOf(k), serialize(v)).catch(() => {});
  },
}));

/** Non-hook accessor for imperative code (player init, scroll handler …). */
export const uiPrefs = () => useUiPrefs.getState();

// ===== custom accent color (overrides the theme's red) =====

const ACCENT_LS = "ghgflix.customAccent";

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return hex;
  const c = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
  const r = c(((n >> 16) & 255) + amt);
  const g = c(((n >> 8) & 255) + amt);
  const b = c((n & 255) + amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Apply (or clear with null) a custom accent color across the whole UI. */
export function applyAccent(hex: string | null) {
  const root = document.documentElement;
  if (!hex) {
    localStorage.removeItem(ACCENT_LS);
    root.style.removeProperty("--color-ghg-red");
    root.style.removeProperty("--color-ghg-red-bright");
    root.style.removeProperty("--color-ghg-red-dark");
    return;
  }
  localStorage.setItem(ACCENT_LS, hex);
  root.style.setProperty("--color-ghg-red", hex);
  root.style.setProperty("--color-ghg-red-bright", shade(hex, 34));
  root.style.setProperty("--color-ghg-red-dark", shade(hex, -50));
}

export function loadAccent(): string | null {
  const hex = localStorage.getItem(ACCENT_LS);
  if (hex) applyAccent(hex);
  return hex;
}

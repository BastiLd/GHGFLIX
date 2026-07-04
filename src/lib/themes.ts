export interface Theme {
  id: string;
  name: string;
  accent: string;
  bg?: string;
  bg2?: string;
  surface?: string;
  surface2?: string;
  elevated?: string;
  line?: string;
  text?: string;
  muted?: string;
}

const DARK = {
  bg: "#08080a",
  bg2: "#101014",
  surface: "#16161c",
  surface2: "#20202a",
  elevated: "#2a2a36",
  line: "#26262f",
  text: "#f5f5f7",
  muted: "#9a9aa8",
};

export const THEMES: Theme[] = [
  { id: "ghg", name: "GHG Rot", accent: "#e50914" },
  { id: "inferno", name: "Inferno", accent: "#ff5722" },
  { id: "sunset", name: "Sunset", accent: "#ff7a18" },
  { id: "gold", name: "Gold", accent: "#f5b50a" },
  { id: "amber", name: "Amber", accent: "#ffc107" },
  { id: "lime", name: "Lime", accent: "#9ccc00" },
  { id: "emerald", name: "Emerald", accent: "#00c853" },
  { id: "mint", name: "Mint", accent: "#1de9b6" },
  { id: "teal", name: "Teal", accent: "#00bfa5" },
  { id: "cyan", name: "Cyan", accent: "#00b8d4" },
  { id: "sky", name: "Sky", accent: "#29b6f6" },
  { id: "ocean", name: "Ocean", accent: "#2196f3" },
  { id: "royal", name: "Royal", accent: "#3d5afe" },
  { id: "indigo", name: "Indigo", accent: "#5c6bc0" },
  { id: "violet", name: "Violet", accent: "#7c4dff" },
  { id: "purple", name: "Purple", accent: "#9c27b0" },
  { id: "magenta", name: "Magenta", accent: "#e040fb" },
  { id: "pink", name: "Pink", accent: "#ff4081" },
  { id: "rose", name: "Rose", accent: "#f50057" },
  { id: "crimson", name: "Crimson", accent: "#d50000" },
  {
    id: "hacker",
    name: "Hacker",
    accent: "#00e676",
    bg: "#02100a",
    bg2: "#04190f",
    surface: "#06251a",
    surface2: "#0a3324",
    elevated: "#0e4030",
    line: "#0c3b2a",
    text: "#d7ffe9",
    muted: "#6fae90",
  },
  {
    id: "synthwave",
    name: "Synthwave",
    accent: "#ff2e97",
    bg: "#160427",
    bg2: "#1d0833",
    surface: "#250d40",
    surface2: "#321253",
    elevated: "#3f1768",
    line: "#3a1560",
    text: "#f7e9ff",
    muted: "#b79fd0",
  },
  {
    id: "dracula",
    name: "Dracula",
    accent: "#bd93f9",
    bg: "#1d1f29",
    bg2: "#21232f",
    surface: "#282a36",
    surface2: "#343746",
    elevated: "#414458",
    line: "#33354a",
    text: "#f8f8f2",
    muted: "#a9adc4",
  },
  {
    id: "nord",
    name: "Nord",
    accent: "#88c0d0",
    bg: "#242933",
    bg2: "#2a303c",
    surface: "#2e3440",
    surface2: "#3b4252",
    elevated: "#434c5e",
    line: "#3b4252",
    text: "#eceff4",
    muted: "#a6aec0",
  },
  {
    id: "light",
    name: "Hell",
    accent: "#e50914",
    bg: "#ececed",
    bg2: "#f7f7f9",
    surface: "#ffffff",
    surface2: "#ececef",
    elevated: "#e0e0e6",
    line: "#d7d7dd",
    text: "#16161c",
    muted: "#62626c",
  },
];

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function shade(hex: string, p: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const target = p < 0 ? 0 : 255;
  const a = Math.abs(p);
  const mix = (c: number) => clampByte(c + (target - c) * a);
  const to = (c: number) => mix(c).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

const LS_THEME = "ghgflix.theme";
const LS_ACCENT = "ghgflix.accent";

export function applyTheme(id: string, customAccent?: string | null) {
  const t = THEMES.find((x) => x.id === id) || THEMES[0];
  const accent = customAccent || t.accent;
  const root = document.documentElement.style;
  root.setProperty("--color-ghg-red", accent);
  root.setProperty("--color-ghg-red-bright", shade(accent, 0.2));
  root.setProperty("--color-ghg-red-dark", shade(accent, -0.35));
  const pal = { ...DARK, ...t } as typeof DARK;
  root.setProperty("--color-ghg-bg", pal.bg);
  root.setProperty("--color-ghg-bg2", pal.bg2);
  root.setProperty("--color-ghg-surface", pal.surface);
  root.setProperty("--color-ghg-surface2", pal.surface2);
  root.setProperty("--color-ghg-elevated", pal.elevated);
  root.setProperty("--color-ghg-line", pal.line);
  root.setProperty("--color-ghg-text", pal.text);
  root.setProperty("--color-ghg-muted", pal.muted);
}

export function currentThemeId(): string {
  return localStorage.getItem(LS_THEME) || "ghg";
}

export function currentAccent(): string | null {
  return localStorage.getItem(LS_ACCENT);
}

export function setTheme(id: string) {
  localStorage.setItem(LS_THEME, id);
  localStorage.removeItem(LS_ACCENT);
  applyTheme(id, null);
}

export function setCustomAccent(accent: string) {
  localStorage.setItem(LS_ACCENT, accent);
  applyTheme(currentThemeId(), accent);
}

export function initTheme() {
  applyTheme(currentThemeId(), currentAccent());
}

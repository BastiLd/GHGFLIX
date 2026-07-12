/** Backend shim: every Tauri API the app uses, with a browser fallback so the
 *  identical UI runs inside the GHGFlix server's web app (ZimaOS/Docker).
 *
 *  Desktop  → real @tauri-apps APIs (invoke, events, window, dialogs, opener)
 *  Browser  → HTTP calls against the GHGFlix server (/api/invoke/<cmd>),
 *             polling-based scan events, Fullscreen API, <input type=file>. */
import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { getVersion as tauriGetVersion } from "@tauri-apps/api/app";
import { getCurrentWindow as tauriGetCurrentWindow, LogicalSize as TauriLogicalSize } from "@tauri-apps/api/window";
import { open as tauriOpenDialog, save as tauriSaveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl as tauriOpenUrl } from "@tauri-apps/plugin-opener";
import { join as tauriJoin, pictureDir as tauriPictureDir } from "@tauri-apps/api/path";
import { IS_TAURI, webToken } from "./platform";

// ─── invoke ──────────────────────────────────────────────────────────────────

/** Desktop: Tauri command. Web: POST /api/invoke/<cmd> on the same origin. */
export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (IS_TAURI) return tauriInvoke<T>(cmd, args);
  const res = await fetch(`/api/invoke/${cmd}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(webToken() ? { Authorization: `Bearer ${webToken()}` } : {}),
    },
    body: JSON.stringify(args ?? {}),
  });
  if (res.status === 401) {
    // token expired / password newly set → back to the web login
    window.dispatchEvent(new CustomEvent("ghgflix:unauthorized"));
    throw new Error("Nicht angemeldet");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(body?.error ?? `Serverfehler (${res.status})`));
  return body.result as T;
}

// ─── events ──────────────────────────────────────────────────────────────────

export type UnlistenFn = () => void;

/** Browser event bus + scan-status poller that synthesizes the two Tauri
 *  events the UI listens for: "scan://progress" and "library://updated". */
const webBus = new EventTarget();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastRunning = false;
let pollListeners = 0;

function ensurePolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (pollListeners <= 0) return;
    try {
      const s = await invoke<{ running: boolean; stage: string; message: string; current: number; total: number }>(
        "scan_status",
      );
      if (s.running) {
        webBus.dispatchEvent(
          new CustomEvent("scan://progress", {
            detail: { stage: s.stage || "scan", message: s.message || "Scanne…", current: s.current || 0, total: s.total || 0 },
          }),
        );
      } else if (lastRunning) {
        webBus.dispatchEvent(new CustomEvent("scan://progress", { detail: { stage: "done", message: "Fertig", current: 1, total: 1 } }));
        webBus.dispatchEvent(new CustomEvent("library://updated", { detail: null }));
      }
      lastRunning = s.running;
    } catch {
      /* server briefly unreachable — keep polling */
    }
  }, 2000);
}

/** Same call-shape as Tauri's listen(): returns Promise<UnlistenFn>. */
export function listen<T>(event: string, handler: (e: { payload: T }) => void): Promise<UnlistenFn> {
  if (IS_TAURI) return tauriListen<T>(event, handler);
  const h = (e: Event) => handler({ payload: (e as CustomEvent).detail as T });
  webBus.addEventListener(event, h);
  pollListeners++;
  ensurePolling();
  return Promise.resolve(() => {
    webBus.removeEventListener(event, h);
    pollListeners--;
  });
}

// ─── app / window ────────────────────────────────────────────────────────────

export async function getVersion(): Promise<string> {
  if (IS_TAURI) return tauriGetVersion();
  try {
    const r = await fetch("/api/ping").then((r) => r.json());
    return String(r.version ?? "web");
  } catch {
    return "web";
  }
}

export class LogicalSize {
  width: number;
  height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

/** Minimal window facade. Desktop: the real Tauri window. Web: Fullscreen API
 *  for fullscreen, everything else is a harmless no-op (a browser tab has no
 *  decorations/always-on-top/window size). */
export function getCurrentWindow() {
  if (IS_TAURI) return tauriGetCurrentWindow() as unknown as WebWindowFacade;
  return webWindow;
}

export interface WebWindowFacade {
  isFullscreen(): Promise<boolean>;
  setFullscreen(v: boolean): Promise<void>;
  setVisibleOnAllWorkspaces(v: boolean): Promise<void>;
  setAlwaysOnTop(v: boolean): Promise<void>;
  setDecorations(v: boolean): Promise<void>;
  setMinSize(s: LogicalSize | TauriLogicalSize | null): Promise<void>;
  setResizable(v: boolean): Promise<void>;
  setSize(s: LogicalSize | TauriLogicalSize): Promise<void>;
  startDragging(): Promise<void>;
  show(): Promise<void>;
  setFocus(): Promise<void>;
}

const webWindow: WebWindowFacade = {
  isFullscreen: async () => !!document.fullscreenElement,
  setFullscreen: async (v) => {
    try {
      if (v && !document.fullscreenElement) await document.documentElement.requestFullscreen();
      else if (!v && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      /* user gesture required / unsupported */
    }
  },
  setVisibleOnAllWorkspaces: async () => {},
  setAlwaysOnTop: async () => {},
  setDecorations: async () => {},
  setMinSize: async () => {},
  setResizable: async () => {},
  setSize: async () => {},
  startDragging: async () => {},
  show: async () => {},
  setFocus: async () => {},
};

export { TauriLogicalSize };

// ─── dialogs ─────────────────────────────────────────────────────────────────

export interface OpenDialogOptions {
  directory?: boolean;
  multiple?: boolean;
  filters?: { name: string; extensions: string[] }[];
}

/** Web note: directory picks are NOT done here (server paths live on the
 *  server, not the browser) — Settings uses the server folder browser
 *  instead. File picks return a File object wrapped as an object-URL string
 *  plus the File itself via `webPickedFile`. */
export let webPickedFile: File | null = null;

export async function openDialog(opts: OpenDialogOptions): Promise<string | string[] | null> {
  if (IS_TAURI) return tauriOpenDialog(opts as never) as Promise<string | string[] | null>;
  if (opts.directory) return null; // handled by the server folder browser in the UI
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (opts.filters?.length) input.accept = opts.filters.flatMap((f) => f.extensions.map((e) => "." + e)).join(",");
    input.onchange = () => {
      const f = input.files?.[0] ?? null;
      webPickedFile = f;
      resolve(f ? URL.createObjectURL(f) : null);
    };
    // canceling never fires onchange in some browsers — resolve on focus loss
    window.addEventListener("focus", () => setTimeout(() => resolve(null), 400), { once: true });
    input.click();
  });
}

export async function saveDialog(opts: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }): Promise<string | null> {
  if (IS_TAURI) return tauriSaveDialog(opts as never) as Promise<string | null>;
  // Browser downloads pick their own location — return the suggested name.
  return opts.defaultPath ?? "ghgflix-export.json";
}

export async function openUrl(url: string): Promise<void> {
  if (IS_TAURI) return tauriOpenUrl(url);
  window.open(url, "_blank", "noopener");
}

// ─── paths (used only for the screenshot filename on desktop) ───────────────

export async function pictureDir(): Promise<string> {
  if (IS_TAURI) return tauriPictureDir();
  return "";
}

export async function join(...parts: string[]): Promise<string> {
  if (IS_TAURI) return tauriJoin(...parts);
  return parts.filter(Boolean).join("/");
}

/** Trigger a browser download for generated content (web export etc.). */
export function webDownload(filename: string, content: string | Blob, mime = "application/octet-stream") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

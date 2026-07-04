import { create } from "zustand";
import { setProperty } from "tauri-plugin-mpv-api";
import { listShowEpisodes, listProgress } from "./api";
import type { Episode } from "./types";

/** Global playback coordination: the YouTube-style mini-player and the play
 *  queue live OUTSIDE the /play route so they survive navigation. The full
 *  Player page and the MiniPlayer overlay both talk to this store.
 *
 *  Handoff protocol (Player → Mini): Player sets `handoff=true`, shrinks the
 *  mpv video into the corner rect via video-margin-ratios, sets `mini`, then
 *  navigates away. Its unmount cleanup sees `handoff` and SKIPS destroy().
 *  Mini → Player: MiniPlayer sets `expandTo`, navigates to /play/…; the Player
 *  sees `expandTo` matching its media and skips init + loadfile (video keeps
 *  running seamlessly), then resets the margins to full size. */

export interface MiniInfo {
  mediaType: "movie" | "episode";
  mediaId: number;
  title: string;
  subtitle?: string | null;
  path: string;
}

/** One visual entry in the queue. A whole (rest of a) season is ONE entry whose
 *  `ids` empty out as its episodes play. */
export interface QueueItem {
  key: string;
  kind: "movie" | "episode" | "season";
  mediaType: "movie" | "episode";
  label: string;
  sub?: string;
  ids: number[];
}

interface PlaybackStore {
  mpvInited: boolean;
  handoff: boolean;
  mini: MiniInfo | null;
  expandTo: { mediaType: "movie" | "episode"; mediaId: number; path?: string } | null;
  queue: QueueItem[];

  setInited: (v: boolean) => void;
  setHandoff: (v: boolean) => void;
  setMini: (m: MiniInfo | null) => void;
  setExpandTo: (e: PlaybackStore["expandTo"]) => void;

  enqueue: (item: Omit<QueueItem, "key">, next?: boolean) => void;
  removeFromQueue: (key: string) => void;
  moveInQueue: (key: string, dir: -1 | 1) => void;
  clearQueue: () => void;
  /** Pop the next playable id off the queue (consumes one id; drops empty items). */
  popNext: () => { mediaType: "movie" | "episode"; id: number } | null;
  /** Peek without consuming (for "als Nächstes" preview). */
  peekNext: () => QueueItem | null;
}

const QUEUE_LS = "ghgflix.queue";
let seq = 1;

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_LS);
    const arr = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    return Array.isArray(arr) ? arr.filter((x) => x && Array.isArray(x.ids) && x.ids.length > 0) : [];
  } catch {
    return [];
  }
}

function persist(queue: QueueItem[]) {
  try {
    localStorage.setItem(QUEUE_LS, JSON.stringify(queue));
  } catch {
    /* full/blocked storage is non-fatal */
  }
}

export const usePlayback = create<PlaybackStore>((set, get) => ({
  mpvInited: false,
  handoff: false,
  mini: null,
  expandTo: null,
  queue: loadQueue(),

  setInited: (v) => set({ mpvInited: v }),
  setHandoff: (v) => set({ handoff: v }),
  setMini: (m) => set({ mini: m }),
  setExpandTo: (e) => set({ expandTo: e }),

  enqueue: (item, next = false) => {
    const q = [...get().queue];
    const entry: QueueItem = { ...item, key: `q${Date.now()}_${seq++}` };
    if (next) q.unshift(entry);
    else q.push(entry);
    persist(q);
    set({ queue: q });
  },
  removeFromQueue: (key) => {
    const q = get().queue.filter((x) => x.key !== key);
    persist(q);
    set({ queue: q });
  },
  moveInQueue: (key, dir) => {
    const q = [...get().queue];
    const i = q.findIndex((x) => x.key === key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
    persist(q);
    set({ queue: q });
  },
  clearQueue: () => {
    persist([]);
    set({ queue: [] });
  },
  popNext: () => {
    const q = [...get().queue];
    while (q.length) {
      const first = q[0];
      if (first.ids.length === 0) {
        q.shift();
        continue;
      }
      const id = first.ids[0];
      const rest = first.ids.slice(1);
      if (rest.length === 0) q.shift();
      else q[0] = { ...first, ids: rest };
      persist(q);
      set({ queue: q });
      return { mediaType: first.mediaType, id };
    }
    return null;
  },
  peekNext: () => get().queue.find((x) => x.ids.length > 0) ?? null,
}));

export const playback = () => usePlayback.getState();

// ===== mini-player geometry =====

/** The corner rectangle (CSS px) the mini video occupies, from the pref size. */
export function miniRect(size: "sm" | "md" | "lg") {
  const w = size === "sm" ? 320 : size === "lg" ? 480 : 400;
  const h = Math.round((w * 9) / 16);
  const margin = 16;
  return { w, h, right: margin, bottom: margin };
}

/** Shrink the running mpv video into the mini corner (or restore full size). */
export function applyMiniMargins(active: boolean, size: "sm" | "md" | "lg") {
  if (!active) {
    for (const side of ["left", "right", "top", "bottom"]) {
      setProperty(`video-margin-ratio-${side}` as never, 0 as never).catch(() => {});
    }
    return;
  }
  const { w, h, right, bottom } = miniRect(size);
  const W = window.innerWidth || 1280;
  const H = window.innerHeight || 800;
  const clamp = (v: number) => Math.min(0.95, Math.max(0, v));
  setProperty("video-margin-ratio-left" as never, clamp((W - right - w) / W) as never).catch(() => {});
  setProperty("video-margin-ratio-right" as never, clamp(right / W) as never).catch(() => {});
  setProperty("video-margin-ratio-top" as never, clamp((H - bottom - h) / H) as never).catch(() => {});
  setProperty("video-margin-ratio-bottom" as never, clamp(bottom / H) as never).catch(() => {});
}

/** clip-path for the Layout background: full page with a hole over the video. */
export function miniClipPath(size: "sm" | "md" | "lg"): string {
  const { w, h, right, bottom } = miniRect(size);
  const W = window.innerWidth || 1280;
  const H = window.innerHeight || 800;
  const x1 = W - right - w;
  const y1 = H - bottom - h;
  const x2 = W - right;
  const y2 = H - bottom;
  // outer rect (clockwise) + inner rect (counter-clockwise) → evenodd hole
  return `polygon(evenodd, 0 0, ${W}px 0, ${W}px ${H}px, 0 ${H}px, 0 0, ${x1}px ${y1}px, ${x1}px ${y2}px, ${x2}px ${y2}px, ${x2}px ${y1}px, ${x1}px ${y1}px)`;
}

// ===== queue builders =====

const epLabel = (e: Episode) => `S${String(e.season).padStart(2, "0")} E${String(e.episode).padStart(2, "0")}`;

/** Enqueue the remaining (unwatched, after the given episode) part of a season
 *  as ONE queue entry. `fromEpisodeId` null → first unwatched episode onwards. */
export async function enqueueSeasonRest(
  profileId: string,
  showId: number,
  showTitle: string,
  season: number | null,
  fromEpisodeId: number | null,
  next = false,
): Promise<number> {
  const [eps, prog] = await Promise.all([listShowEpisodes(showId), listProgress(profileId)]);
  const watched = new Set(prog.filter((p) => p.mediaType === "episode" && p.watched).map((p) => p.refId));
  let list = eps;
  if (season != null) list = list.filter((e) => e.season === season);
  if (fromEpisodeId != null) {
    const idx = list.findIndex((e) => e.id === fromEpisodeId);
    if (idx >= 0) list = list.slice(idx + 1);
  } else {
    list = list.filter((e) => !watched.has(e.id));
  }
  if (list.length === 0) return 0;
  const first = list[0];
  const last = list[list.length - 1];
  playback().enqueue(
    {
      kind: "season",
      mediaType: "episode",
      label: season != null ? `${showTitle} · Staffel ${season}` : showTitle,
      sub: `${list.length} Folgen · ${epLabel(first)} – ${epLabel(last)}`,
      ids: list.map((e) => e.id),
    },
    next,
  );
  return list.length;
}

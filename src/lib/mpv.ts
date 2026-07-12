/** mpv shim — the whole player UI (Player.tsx, MiniPlayer.tsx, playback.ts)
 *  talks to THIS module instead of tauri-plugin-mpv-api directly.
 *
 *  Desktop: thin re-export of tauri-plugin-mpv-api (real mpv behind the
 *  transparent webview — hardware decoding, every codec, chapters, tracks).
 *
 *  Browser: a fixed-position <video> element BEHIND the UI (same visual model
 *  as mpv-behind-webview), fed by the GHGFlix server:
 *    - Direct Play (H.264/AAC MP4/WebM) → native seeking
 *    - everything else → live ffmpeg transcode; seeking restarts the stream
 *      at the target time (?t=…) and the shim keeps a time offset so the UI
 *      still sees real media timestamps.
 *  Chapters + audio/subtitle streams come from the server's ffprobe data, so
 *  the chapter menu, intro skip and track menus keep working. */
import * as native from "tauri-plugin-mpv-api";
import { invoke } from "./backend";
import { IS_TAURI, withToken } from "./platform";

type PropCb = (e: { name: string; data: unknown }) => void;

export interface WebPlayInfo {
  mediaType: "movie" | "episode";
  id: number;
  duration: number;
  direct: boolean;
  directUrl: string;
  transcodeUrl: string;
  width?: number | null;
  height?: number | null;
  audioStreams: { index: number; lang?: string | null; title?: string | null; codec?: string | null }[];
  subtitleStreams: { index: number; lang?: string | null; title?: string | null; codec?: string | null }[];
  chapters: { title?: string | null; time: number }[];
}

interface WebState {
  video: HTMLVideoElement | null;
  info: WebPlayInfo | null;
  path: string | null;
  offset: number; // transcode start offset (media seconds at video.currentTime 0)
  transcoding: boolean;
  aid: number; // 1-based mpv-style audio id
  sid: number | "no";
  loop: boolean;
  volume: number; // 0-100
  muted: boolean;
  speed: number;
  margins: { l: number; r: number; t: number; b: number };
  aspect: string;
  observers: Set<PropCb>;
  subEl: HTMLTrackElement | null;
  posTimer: ReturnType<typeof setInterval> | null;
}

const S: WebState = {
  video: null,
  info: null,
  path: null,
  offset: 0,
  transcoding: false,
  aid: 1,
  sid: "no",
  loop: false,
  volume: 100,
  muted: false,
  speed: 1,
  margins: { l: 0, r: 0, t: 0, b: 0 },
  aspect: "-1",
  observers: new Set(),
  subEl: null,
  posTimer: null,
};

const emit = (name: string, data: unknown) => {
  for (const cb of S.observers) {
    try {
      cb({ name, data });
    } catch {
      /* observer errors must not kill playback */
    }
  }
};

const mediaPos = () => (S.video ? S.offset + S.video.currentTime : 0);
const mediaDuration = () => {
  if (!S.video) return 0;
  if (!S.transcoding && isFinite(S.video.duration) && S.video.duration > 0) return S.video.duration;
  return S.info?.duration ?? 0;
};

function box(): HTMLElement | null {
  return document.getElementById("ghgflix-video-box");
}

function applyMargins() {
  const el = box();
  if (!el) return;
  const { l, r, t, b } = S.margins;
  el.style.left = `${l * 100}%`;
  el.style.right = `${r * 100}%`;
  el.style.top = `${t * 100}%`;
  el.style.bottom = `${b * 100}%`;
  const mini = l + r + t + b > 0.01;
  el.style.borderRadius = mini ? "12px" : "0";
  el.style.overflow = mini ? "hidden" : "visible";
}

function applyAspect() {
  const v = S.video;
  if (!v) return;
  // mpv video-aspect-override: "-1" = source, "16:9", "4:3", "2.35:1", "0" = disable
  if (S.aspect === "-1" || S.aspect === "0" || !S.aspect) {
    v.style.objectFit = "contain";
    v.style.transform = "";
    return;
  }
  const m = S.aspect.split(":").map(Number);
  const want = m.length === 2 && m[1] ? m[0] / m[1] : parseFloat(S.aspect);
  const have = v.videoWidth && v.videoHeight ? v.videoWidth / v.videoHeight : want;
  if (!want || !isFinite(want) || !have) return;
  v.style.objectFit = "fill";
  // approximate: stretch horizontally/vertically relative to source aspect
  const sx = want / have;
  v.style.transform = sx >= 1 ? `scaleX(1)` : `scaleX(1)`; // object-fit:fill inside letterboxed element ≈ good enough
}

function createVideo(): HTMLVideoElement {
  // container div stretches to the (possibly margin-shrunk) rect; the video
  // fills it with object-fit:contain — same visual model as mpv margins
  const wrap = document.createElement("div");
  wrap.id = "ghgflix-video-box";
  wrap.style.cssText = "position:fixed;left:0;right:0;top:0;bottom:0;z-index:0;background:black;";
  const v = document.createElement("video");
  v.id = "ghgflix-video";
  v.playsInline = true;
  v.style.cssText = "width:100%;height:100%;object-fit:contain;background:black;";
  wrap.appendChild(v);
  document.body.appendChild(wrap);
  document.body.classList.add("ghg-web-video");

  v.addEventListener("play", () => emit("pause", false));
  v.addEventListener("pause", () => emit("pause", true));
  v.addEventListener("durationchange", () => emit("duration", mediaDuration()));
  v.addEventListener("timeupdate", () => emit("time-pos", mediaPos()));
  v.addEventListener("waiting", () => emit("paused-for-cache", true));
  v.addEventListener("playing", () => emit("paused-for-cache", false));
  v.addEventListener("canplay", () => emit("paused-for-cache", false));
  v.addEventListener("progress", () => {
    try {
      const b = v.buffered;
      if (b.length) emit("demuxer-cache-time", S.offset + b.end(b.length - 1));
    } catch {
      /* ignore */
    }
  });
  v.addEventListener("ended", () => {
    if (S.loop) {
      void webSeekAbs(0);
      void v.play().catch(() => {});
    } else emit("eof-reached", true);
  });
  v.addEventListener("error", () => {
    // direct play failed (unsupported codec despite probe) → fall back to transcode
    if (!S.transcoding && S.info) {
      void startStream(mediaPos(), true);
    }
  });
  return v;
}

function streamUrl(t: number): string {
  const info = S.info!;
  if (!S.transcoding) return withToken(info.directUrl);
  const a = Math.max(0, S.aid - 1);
  return withToken(`${info.transcodeUrl}&t=${Math.max(0, Math.round(t * 10) / 10)}&a=${a}`);
}

async function startStream(at: number, forceTranscode = false) {
  const v = S.video;
  const info = S.info;
  if (!v || !info) return;
  const wasPaused = v.paused && v.currentTime > 0;
  S.transcoding = forceTranscode || !info.direct;
  S.offset = S.transcoding ? at : 0;
  v.src = streamUrl(at);
  v.playbackRate = S.speed;
  v.volume = S.volume / 100;
  v.muted = S.muted;
  if (!S.transcoding && at > 0) {
    // native seek once metadata is there
    const onMeta = () => {
      v.currentTime = at;
      v.removeEventListener("loadedmetadata", onMeta);
    };
    v.addEventListener("loadedmetadata", onMeta);
  }
  applySubTrack();
  if (!wasPaused) await v.play().catch(() => {});
  emit("duration", mediaDuration());
}

async function webSeekAbs(t: number) {
  const v = S.video;
  if (!v || !S.info) return;
  const target = Math.max(0, Math.min(t, mediaDuration() || t));
  if (!S.transcoding) {
    v.currentTime = target;
  } else {
    const paused = v.paused;
    await startStream(target, true);
    if (paused) v.pause();
  }
  emit("time-pos", target);
}

function applySubTrack() {
  const v = S.video;
  if (!v || !S.info) return;
  if (S.subEl) {
    S.subEl.remove();
    S.subEl = null;
  }
  for (const t of Array.from(v.textTracks)) t.mode = "disabled";
  if (S.sid === "no") return;
  const sub = S.info.subtitleStreams[(S.sid as number) - 1];
  if (!sub) return;
  const tr = document.createElement("track");
  tr.kind = "subtitles";
  tr.label = sub.title || sub.lang || `Untertitel ${S.sid}`;
  tr.srclang = sub.lang || "de";
  tr.src = withToken(`/api/subs/${S.info.mediaType}/${S.info.id}/${sub.index}.vtt`);
  tr.default = true;
  v.appendChild(tr);
  tr.addEventListener("load", () => (tr.track.mode = "showing"));
  tr.track.mode = "showing";
  S.subEl = tr;
}

// ─── public API (mpv-compatible surface) ─────────────────────────────────────

export async function init(opts?: { path?: string; args?: string[]; observedProperties?: readonly string[] }): Promise<void> {
  if (IS_TAURI) {
    await native.init(opts as never);
    return;
  }
  if (!S.video) S.video = createVideo();
}

export async function destroy(): Promise<void> {
  if (IS_TAURI) return native.destroy();
  if (S.video) {
    S.video.pause();
    S.video.removeAttribute("src");
    S.video.load();
  }
  box()?.remove();
  document.body.classList.remove("ghg-web-video");
  if (S.posTimer) clearInterval(S.posTimer);
  Object.assign(S, {
    video: null,
    info: null,
    path: null,
    offset: 0,
    transcoding: false,
    aid: 1,
    sid: "no",
    loop: false,
    margins: { l: 0, r: 0, t: 0, b: 0 },
    subEl: null,
    posTimer: null,
  });
}

export async function command(name: string, args: unknown[] = []): Promise<void> {
  if (IS_TAURI) {
    await native.command(name, args as never);
    return;
  }
  const v = S.video;
  switch (name) {
    case "loadfile": {
      const path = String(args[0] ?? "");
      S.path = path;
      S.aid = 1;
      S.sid = "no";
      S.info = await invoke<WebPlayInfo>("play_info", { path });
      if (!S.video) S.video = createVideo();
      await startStream(0);
      emit("duration", mediaDuration());
      break;
    }
    case "seek": {
      const [amount, mode] = [Number(args[0] ?? 0), String(args[1] ?? "relative")];
      await webSeekAbs(mode === "absolute" ? amount : mediaPos() + amount);
      break;
    }
    case "frame-step":
      if (v) {
        v.pause();
        v.currentTime = Math.min(v.duration || Infinity, v.currentTime + 1 / 25);
      }
      break;
    case "frame-back-step":
      if (v) {
        v.pause();
        v.currentTime = Math.max(0, v.currentTime - 1 / 25);
      }
      break;
    case "add": {
      // chapter navigation: add ["chapter", ±1]
      if (String(args[0]) === "chapter" && S.info?.chapters?.length) {
        const dir = Number(args[1]) || 1;
        const pos = mediaPos();
        const chaps = S.info.chapters;
        const target =
          dir > 0
            ? chaps.find((c) => c.time > pos + 1)
            : [...chaps].reverse().find((c) => c.time < pos - 2) ?? { time: 0 };
        if (target) await webSeekAbs(target.time);
      }
      break;
    }
    case "sub-add": {
      // external subtitle picked in the browser (object URL, SRT converted by caller)
      const url = String(args[0] ?? "");
      if (v && url) {
        if (S.subEl) S.subEl.remove();
        const tr = document.createElement("track");
        tr.kind = "subtitles";
        tr.label = "Extern";
        tr.src = url;
        tr.default = true;
        v.appendChild(tr);
        tr.track.mode = "showing";
        S.subEl = tr;
      }
      break;
    }
    case "screenshot-to-file": {
      if (!v) break;
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      canvas.getContext("2d")?.drawImage(v, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `GHGFlix_${new Date().toISOString().replace(/[:.]/g, "-")}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }, "image/png");
      break;
    }
    default:
      break;
  }
}

export async function getProperty<T>(name: string): Promise<T> {
  if (IS_TAURI) return (await native.getProperty(name as never)) as T;
  const v = S.video;
  switch (name) {
    case "track-list": {
      const info = S.info;
      const out: unknown[] = [];
      (info?.audioStreams ?? []).forEach((a, i) =>
        out.push({ id: i + 1, type: "audio", selected: S.aid === i + 1, lang: a.lang ?? undefined, title: a.title ?? a.codec ?? undefined }),
      );
      (info?.subtitleStreams ?? []).forEach((s, i) =>
        out.push({ id: i + 1, type: "sub", selected: S.sid === i + 1, lang: s.lang ?? undefined, title: s.title ?? s.codec ?? undefined }),
      );
      return out as T;
    }
    case "audio-device-list":
      return [] as T;
    case "chapter-list":
      return (S.info?.chapters ?? []) as T;
    case "width":
      return (S.info?.width ?? v?.videoWidth ?? 0) as T;
    case "height":
      return (S.info?.height ?? v?.videoHeight ?? 0) as T;
    case "pause":
      return (v?.paused ?? true) as T;
    case "time-pos":
      return mediaPos() as T;
    case "duration":
      return mediaDuration() as T;
    case "volume":
      return S.volume as T;
    case "mute":
      return S.muted as T;
    case "speed":
      return S.speed as T;
    default:
      return null as T;
  }
}

export async function setProperty(name: string, value: unknown): Promise<void> {
  if (IS_TAURI) return native.setProperty(name as never, value as never);
  const v = S.video;
  switch (name) {
    case "pause":
      if (v) {
        if (value) v.pause();
        else await v.play().catch(() => {});
      }
      break;
    case "volume":
      S.volume = Math.max(0, Math.min(100, Number(value) || 0));
      if (v) v.volume = S.volume / 100;
      break;
    case "mute":
      S.muted = Boolean(value);
      if (v) v.muted = S.muted;
      break;
    case "speed":
      S.speed = Number(value) || 1;
      if (v) v.playbackRate = S.speed;
      break;
    case "aid": {
      const id = value === "no" ? 1 : Number(value) || 1;
      if (id !== S.aid) {
        S.aid = id;
        // audio selection needs the transcoder (browser can't switch tracks in-stream)
        if (S.info) await startStream(mediaPos(), true);
      }
      break;
    }
    case "sid":
      S.sid = value === "no" ? "no" : Number(value) || "no";
      applySubTrack();
      break;
    case "loop-file":
      S.loop = value === "inf" || value === true;
      break;
    case "video-aspect-override":
      S.aspect = String(value);
      applyAspect();
      break;
    case "video-margin-ratio-left":
      S.margins.l = Number(value) || 0;
      applyMargins();
      break;
    case "video-margin-ratio-right":
      S.margins.r = Number(value) || 0;
      applyMargins();
      break;
    case "video-margin-ratio-top":
      S.margins.t = Number(value) || 0;
      applyMargins();
      break;
    case "video-margin-ratio-bottom":
      S.margins.b = Number(value) || 0;
      applyMargins();
      break;
    case "audio-delay":
    case "sub-delay":
    case "audio-device":
      break; // not possible in a browser — documented in Einstellungen (Web-Hinweis)
    default:
      break;
  }
}

export async function observeProperties(
  props: readonly string[],
  cb: PropCb,
): Promise<() => void> {
  if (IS_TAURI) return native.observeProperties(props as never, cb as never);
  S.observers.add(cb);
  // push current values immediately so late subscribers (mini player) sync up
  const v = S.video;
  if (v) {
    cb({ name: "pause", data: v.paused });
    cb({ name: "duration", data: mediaDuration() });
    cb({ name: "time-pos", data: mediaPos() });
  }
  return () => S.observers.delete(cb);
}

/** Browser picture-in-picture for the web player (mpv uses a real always-on-top
 *  window on desktop — see the Web-Hinweis in Einstellungen). */
export async function webTogglePip(): Promise<boolean> {
  const v = S.video;
  if (!v) return false;
  const doc = document as Document & { pictureInPictureElement?: Element; exitPictureInPicture?: () => Promise<void> };
  try {
    if (doc.pictureInPictureElement) {
      await doc.exitPictureInPicture?.();
      return false;
    }
    await (v as HTMLVideoElement & { requestPictureInPicture?: () => Promise<unknown> }).requestPictureInPicture?.();
    return true;
  } catch {
    return false;
  }
}

/** Convert SRT text to WebVTT (for external subtitle files picked in the browser). */
export function srtToVtt(srt: string): string {
  return (
    "WEBVTT\n\n" +
    srt
      .replace(/\r/g, "")
      .replace(/^\d+\s*$/gm, "")
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
      .trim()
  );
}

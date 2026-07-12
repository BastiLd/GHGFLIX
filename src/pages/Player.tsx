import { getCurrentWindow, join, LogicalSize, openDialog, pictureDir, webPickedFile } from "../lib/backend";
import { IS_WEB } from "../lib/platform";
import {
  ArrowLeft,
  AudioLines,
  Camera,
  Captions,
  Check,
  ChevronRight,
  Gauge,
  Layers,
  ListVideo,
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { command, destroy, getProperty, init, observeProperties, setProperty, srtToVtt, webTogglePip } from "../lib/mpv";
import { episodeVersions, getEpisode, getMovie, getProgress, getSetting, listShowEpisodes, mediaThumbnail, movieVersions, revealInExplorer, setEpisodeIntro, setMediaDims, setProgress } from "../lib/api";
import { openCtx } from "../lib/contextmenu";
import { formatTime, quality as computeQuality, seasonEpisodeLabel } from "../lib/format";
import { comboFromEvent } from "../lib/keys";
import { ENGLISH, GERMAN, langName } from "../lib/lang";
import { useStore } from "../lib/store";
import { applyMiniMargins, playback, usePlayback } from "../lib/playback";
import { uiPrefs } from "../lib/uiPrefs";
import type { Episode, MediaVersion } from "../lib/types";
import { Wordmark } from "../components/Brand";
import { stillUrl } from "../lib/img";
import { Scrubber } from "../components/Scrubber";
import { Spinner } from "../components/ui";

interface Track {
  id: number;
  type: string;
  title?: string;
  lang?: string;
  selected?: boolean;
  codec?: string;
  "demux-channels"?: string;
  "demux-channel-count"?: number;
  forced?: boolean;
  default?: boolean;
}
interface AudioDevice {
  name: string;
  description?: string;
}

const OBSERVED = ["pause", "time-pos", "duration", "eof-reached", "paused-for-cache", "demuxer-cache-time"] as const;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/** Choose which file to play from the auto-quality setting:
 *  "highest" | "lowest" | a target height ("2160"/"1080"/"720"). */
function pickVersion(list: MediaVersion[], mode: string): MediaVersion | undefined {
  if (list.length === 0) return undefined;
  const sorted = [...list].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (mode === "lowest") return sorted[sorted.length - 1];
  const target = parseInt(mode, 10);
  if (!Number.isNaN(target)) {
    const atMost = sorted.filter((v) => (v.height ?? 0) <= target);
    return atMost[0] ?? sorted[sorted.length - 1];
  }
  return sorted[0]; // highest
}

/** Build mpv launch args from the user's performance settings. Defaults are tuned
 *  for smooth, low-CPU playback of heavy 4K/HEVC files: hardware decoding ON (the
 *  single biggest anti-lag win), the modern GPU renderer, and no audio-resampling
 *  by default. Everything is overridable in Settings → Leistung for odd hardware. */
async function buildMpvArgs(): Promise<string[]> {
  const hwdec = (await getSetting("hwdec")) || "auto"; // auto | auto-copy | no
  const vo = (await getSetting("video_output")) || "gpu-next"; // gpu-next | gpu | auto
  const perfMode = (await getSetting("perf_mode")) === "on";
  const smoothing = (await getSetting("playback_smoothing")) === "on";
  const p = uiPrefs();

  const args = [
    `--sub-scale=${Math.min(2, Math.max(0.4, p.subScale || 1))}`,
    `--volume-max=${Math.min(150, Math.max(100, p.volumeMax || 100))}`,
    `--hwdec=${hwdec}`,
    "--keep-open=yes",
    "--force-window=yes",
    "--focus-on=never",
    "--audio-fallback-to-null=yes",
    "--hr-seek=yes",
    // generous buffering so big files / slow disks don't stall mid-playback
    "--cache=yes",
    "--demuxer-max-bytes=192MiB",
    "--demuxer-readahead-secs=20",
    // auto-load external subtitle/audio files lying next to the video
    // ("Movie.mkv" + "Movie.de.srt" just works, no manual adding)
    "--sub-auto=fuzzy",
    "--audio-file-auto=fuzzy",
  ];

  if (vo !== "auto") {
    args.push(`--vo=${vo}`, "--gpu-api=d3d11");
  }
  // Weaker PCs: mpv's "fast" profile disables the expensive scalers/shaders.
  if (perfMode) {
    args.push("--profile=fast");
  }
  // Opt-in judder-free playback (resamples audio to the display rate). Off by
  // default because on mismatched refresh rates it can actually cause frame drops.
  if (smoothing) {
    args.push("--video-sync=display-resample", "--interpolation=no", "--hr-seek-framedrop=yes");
  }
  return args;
}

export default function Player() {
  const { type, id } = useParams();
  const mediaType = (type === "episode" ? "episode" : "movie") as "movie" | "episode";
  const mediaId = Number(id);
  const navigate = useNavigate();
  const profileId = useStore((s) => s.profileId);
  const toast = useStore((s) => s.toast);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVol] = useState(100);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [showUi, setShowUi] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [trackMenu, setTrackMenu] = useState<"audio" | "sub" | "speed" | "version" | "chapters" | null>(null);
  const [aid, setAid] = useState<number | "no">("no");
  const [sid, setSid] = useState<number | "no">("no");
  const [speed, setSpeed] = useState(1);
  const [audioDevices, setAudioDevices] = useState<AudioDevice[]>([]);
  const [audioDevice, setAudioDevice] = useState<string>("auto");
  const [introSkipVisible, setIntroSkipVisible] = useState(false);
  const [nextCancelled, setNextCancelled] = useState(false);

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState<string | null>(null);
  const [quality, setQuality] = useState<string | null>(null);
  const [videoReady, setVideoReady] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [showRemaining, setShowRemaining] = useState(false);
  const [volOsd, setVolOsd] = useState<number | null>(null);
  const volOsdTimer = useRef<number | null>(null);
  const [chapters, setChapters] = useState<{ title?: string; time: number }[]>([]);
  const [epPanel, setEpPanel] = useState(false);
  const [endScreen, setEndScreen] = useState(false);
  const introMarkRef = useRef<number | null>(null); // pending "Intro: Start hier"
  const prefsRef = useRef(uiPrefs());
  // live mirrors for callbacks that must not go stale (mini-player handoff)
  const videoReadyRef = useRef(false);
  const errorRef = useRef(false);
  const titleRef = useRef("");
  const subtitleRef = useRef<string | null>(null);
  const [versions, setVersions] = useState<MediaVersion[]>([]);
  const [versionPath, setVersionPath] = useState<string | null>(null);
  const [thumbInterval, setThumbInterval] = useState(5);
  const [thumbWidth, setThumbWidth] = useState(176);

  const posRef = useRef(0);
  const durRef = useRef(0);
  const pathRef = useRef<string | null>(null);
  const tracksRef = useRef<Track[]>([]);
  const resumeRef = useRef<number | null>(null);
  const tracksLoadedRef = useRef(false);
  const lastSaveRef = useRef(0);
  const itemRef = useRef<{ type: "movie" | "episode"; id: number }>({ type: mediaType, id: mediaId });
  const backTargetRef = useRef<string>("/");
  const hideTimer = useRef<number | null>(null);
  const markerKeyRef = useRef<string>("k");
  const markerRef = useRef<number | null>(null);
  const pipRef = useRef(false);
  const subDefaultRef = useRef<string>("off");
  const subLangRef = useRef<string>("en");
  const introSkipRef = useRef<number>(85);
  // the "audio/manual" intro window (from DB fingerprint, per-show/episode manual
  // marking) kept SEPARATE from the chapter-derived one, so the intro source
  // setting (auto | audio | chapters | fixed) can choose deterministically
  const introWindowRef = useRef<{ start: number; end: number } | null>(null);
  const chapterWindowRef = useRef<{ start: number; end: number } | null>(null);
  const introModeRef = useRef<string>("button");
  const introSourceRef = useRef<string>("auto");
  // Resolve the effective intro window for the current source setting. This is
  // the SINGLE source of truth for both the skip button's visibility and where
  // it seeks to — so "skip" always jumps to the real intro end, never blindly to
  // the fixed seconds unless the user actually chose "feste Zeit".
  const resolveIntroWindow = useCallback((): { start: number; end: number } | null => {
    const fixed = introSkipRef.current > 0 ? { start: 1, end: introSkipRef.current } : null;
    switch (introSourceRef.current) {
      case "fixed":
        return fixed;
      case "chapters":
        return chapterWindowRef.current;
      case "audio":
        return introWindowRef.current; // fingerprint / manual only
      default: // "auto": chapters → audio/manual → fixed fallback
        return chapterWindowRef.current ?? introWindowRef.current ?? fixed;
    }
  }, []);
  const introSkippedRef = useRef(false);
  const autoQualityRef = useRef<string>("highest");

  const queueItems = usePlayback((s) => s.queue);
  const idx = useMemo(() => episodes.findIndex((e) => e.id === mediaId), [episodes, mediaId]);
  const nextEp = idx >= 0 ? episodes[idx + 1] : undefined;
  const prevEp = idx > 0 ? episodes[idx - 1] : undefined;

  // Only the player needs the window-transparent CSS (so mpv shows through behind
  // the webview). Every other page stays opaque, so the desktop never bleeds in.
  useEffect(() => {
    document.documentElement.classList.add("mpv-mode");
    document.documentElement.classList.remove("mpv-mini");
    return () => document.documentElement.classList.remove("mpv-mode");
  }, []);

  useEffect(() => {
    videoReadyRef.current = videoReady;
  }, [videoReady]);
  useEffect(() => {
    errorRef.current = error != null;
  }, [error]);
  useEffect(() => {
    titleRef.current = title;
    subtitleRef.current = subtitle;
  }, [title, subtitle]);

  const saveProgress = useCallback(
    (watched = false) => {
      const { type: t, id: i } = itemRef.current;
      const dur = durRef.current;
      const pos = posRef.current;
      if (dur <= 0) return;
      // "watched" threshold is user-configurable (Einstellungen → Wiedergabe)
      const thr = Math.min(0.99, Math.max(0.5, (prefsRef.current.watchedThreshold || 95) / 100));
      const done = watched || pos >= dur * thr;
      setProgress(profileId, t, i, pos, dur, done).catch(() => {});
    },
    [profileId],
  );

  const applyAudioPreference = useCallback((list: Track[]) => {
    const audio = list.filter((t) => t.type === "audio");
    if (audio.length <= 1) return;
    const p = prefsRef.current;
    if (p.audioLangPref === "file") return; // trust the file's default track
    // last manually chosen language wins (if remembered), then the configured order
    const remembered = p.rememberTrackLang ? localStorage.getItem("ghgflix.audioLang") : null;
    const byLang = (langs: string[]) => audio.find((t) => langs.includes((t.lang || "").toLowerCase()));
    const first = p.audioLangPref === "de-en" ? GERMAN : ENGLISH;
    const second = p.audioLangPref === "de-en" ? ENGLISH : GERMAN;
    const pick = (remembered && byLang([remembered])) || byLang(first) || byLang(second);
    if (pick) {
      setProperty("aid", pick.id as any).catch(() => {});
      setAid(pick.id);
    }
  }, []);

  const applySubtitlePreference = useCallback((list: Track[]) => {
    if (subDefaultRef.current !== "on") {
      setProperty("sid", "no" as any).catch(() => {});
      setSid("no");
      return;
    }
    const subs = list.filter((t) => t.type === "sub");
    const want = subLangRef.current.toLowerCase();
    const pick = subs.find((t) => (t.lang || "").toLowerCase().startsWith(want));
    if (pick) {
      setProperty("sid", pick.id as any).catch(() => {});
      setSid(pick.id);
    }
  }, []);

  const loadTracks = useCallback(async () => {
    try {
      const list = (await getProperty<Track[]>("track-list")) as Track[];
      const arr = list || [];
      setTracks(arr);
      tracksRef.current = arr;
      const a = arr.find((t) => t.type === "audio" && t.selected);
      setAid(a ? a.id : "no");
      applyAudioPreference(arr);
      applySubtitlePreference(arr);
    } catch {
      /* not ready */
    }
    try {
      const devs = (await getProperty<AudioDevice[]>("audio-device-list")) as AudioDevice[];
      setAudioDevices(devs || []);
    } catch {
      /* ignore */
    }
    // chapter list → chapter menu + detect an "intro" chapter for an exact skip
    try {
      const list = (await getProperty<{ title?: string; time: number }[]>("chapter-list")) as {
        title?: string;
        time: number;
      }[];
      const chaps = list || [];
      setChapters(chaps);
      const re = /intro|opening|\bop\b|vorspann|recap|previously|titelsong|theme song/i;
      let win: { start: number; end: number } | null = null;
      for (let i = 0; i < chaps.length; i++) {
        if (re.test(chaps[i].title || "")) {
          const start = chaps[i].time;
          const end = i + 1 < chaps.length ? chaps[i + 1].time : start + introSkipRef.current;
          win = { start, end };
          break;
        }
      }
      chapterWindowRef.current = win; // kept separate from the audio/manual window
    } catch {
      /* keep existing window */
    }
    // persist the REAL resolution reported by mpv → quality badges self-heal
    try {
      const w = Number(await getProperty<number>("width")) || 0;
      const h = Number(await getProperty<number>("height")) || 0;
      const { type: t, id: i } = itemRef.current;
      if (w > 0 && h > 0 && pathRef.current) {
        void setMediaDims(t, i, pathRef.current, w, h).catch(() => {});
      }
    } catch {
      /* ignore */
    }
  }, [applyAudioPreference, applySubtitlePreference]);

  const restoreWindow = useCallback(async () => {
    const w = getCurrentWindow();
    await w.setVisibleOnAllWorkspaces(false).catch(() => {});
    await w.setAlwaysOnTop(false).catch(() => {});
    await w.setDecorations(true).catch(() => {});
    await w.setMinSize(new LogicalSize(940, 600)).catch(() => {});
    await w.setResizable(true).catch(() => {});
    await w.setSize(new LogicalSize(1280, 800)).catch(() => {});
  }, []);

  /** Leave the player. "mini" hands the video off to the corner mini player
   *  (if enabled + a video is actually running), "close" always stops playback.
   *  Which button does what is user-configurable (Einstellungen → Wiedergabe). */
  const leavePlayer = useCallback(
    async (action: "mini" | "close") => {
      saveProgress();
      if (fullscreen) await getCurrentWindow().setFullscreen(false).catch(() => {});
      if (pipRef.current) {
        await restoreWindow();
        pipRef.current = false;
      }
      const { type: t, id: i } = itemRef.current;
      if (action === "mini" && prefsRef.current.miniPlayer && videoReadyRef.current && !errorRef.current && pathRef.current) {
        playback().setHandoff(true);
        playback().setMini({
          mediaType: t,
          mediaId: i,
          title: titleRef.current,
          subtitle: subtitleRef.current,
          path: pathRef.current,
        });
      }
      // Replace the /play entry so a later "back" on the detail page goes to the
      // overview the user actually came from — never back into the player.
      navigate(backTargetRef.current, { replace: true });
    },
    [fullscreen, navigate, restoreWindow, saveProgress],
  );

  const goBack = useCallback(() => leavePlayer(prefsRef.current.backButtonAction), [leavePlayer]);
  const closePlayer = useCallback(() => leavePlayer(prefsRef.current.xButtonAction), [leavePlayer]);

  const handleEnd = useCallback(() => {
    saveProgress(true);
    const p = prefsRef.current;
    // explicit queue entries win over the implicit "next episode"
    if (playback().peekNext()) {
      const n = playback().popNext();
      if (n) {
        navigate(`/play/${n.mediaType}/${n.id}`);
        return;
      }
    }
    if (mediaType === "episode" && nextEp && p.autoplayNext) {
      navigate(`/play/episode/${nextEp.id}`);
    } else if (p.endAutoBack) {
      goBack();
    } else {
      // stay on an end screen instead of leaving automatically
      setEndScreen(true);
    }
  }, [mediaType, nextEp, navigate, saveProgress, goBack]);

  const togglePause = useCallback(() => {
    setProperty("pause", !paused).catch(() => {});
  }, [paused]);

  const toggleFullscreen = useCallback(async () => {
    const w = getCurrentWindow();
    const fs = await w.isFullscreen();
    await w.setFullscreen(!fs);
    setFullscreen(!fs);
  }, []);

  const togglePip = useCallback(async () => {
    if (IS_WEB) {
      // browser build: real Picture-in-Picture window via the browser API
      const on = await webTogglePip();
      pipRef.current = on;
      setPip(on);
      return;
    }
    const w = getCurrentWindow();
    if (!pipRef.current) {
      if (fullscreen) {
        await w.setFullscreen(false).catch(() => {});
        setFullscreen(false);
      }
      await w.setDecorations(false).catch(() => {});
      await w.setResizable(true).catch(() => {});
      await w.setMinSize(new LogicalSize(160, 90)).catch(() => {});
      await w.setAlwaysOnTop(true).catch(() => {});
      const pipW = prefsRef.current.pipSize === "sm" ? 380 : prefsRef.current.pipSize === "lg" ? 640 : 500;
      await w.setSize(new LogicalSize(pipW, Math.round(pipW * 0.5625))).catch(() => {});
      await w.setVisibleOnAllWorkspaces(true).catch(() => {});
      pipRef.current = true;
      setPip(true);
    } else {
      await restoreWindow();
      pipRef.current = false;
      setPip(false);
    }
  }, [fullscreen, restoreWindow]);

  const toggleMarker = useCallback(() => {
    if (markerRef.current == null) {
      markerRef.current = posRef.current;
      toast(`Marke gesetzt bei ${formatTime(posRef.current)} – nochmal drücken zum Zurückspringen`, "info");
    } else {
      const t = markerRef.current;
      markerRef.current = null;
      command("seek", [t, "absolute"]).catch(() => {});
      toast(`Zurück zu ${formatTime(t)}`, "success");
    }
  }, [toast]);

  const changeSpeed = (v: number) => {
    setSpeed(v);
    setProperty("speed", v).catch(() => {});
    localStorage.setItem("ghgflix.speed", String(v));
    setTrackMenu(null);
  };
  // [ / ] keys step through the speed list
  const stepSpeed = useCallback(
    (dir: 1 | -1) => {
      setSpeed((cur) => {
        const idx = SPEEDS.indexOf(cur);
        const ni = Math.min(SPEEDS.length - 1, Math.max(0, (idx < 0 ? SPEEDS.indexOf(1) : idx) + dir));
        const v = SPEEDS[ni];
        setProperty("speed", v).catch(() => {});
        localStorage.setItem("ghgflix.speed", String(v));
        toast(`Geschwindigkeit: ${v}×`, "info");
        return v;
      });
    },
    [toast],
  );
  // A key → cycle the aspect-ratio override (fixes stretched/letterboxed files)
  const aspectRef = useRef(0);
  const cycleAspect = useCallback(() => {
    const modes: [string, string][] = [
      ["-1", "Automatisch"],
      ["16:9", "16:9"],
      ["4:3", "4:3"],
      ["2.35:1", "Cinemascope"],
    ];
    aspectRef.current = (aspectRef.current + 1) % modes.length;
    const [v, label] = modes[aspectRef.current];
    setProperty("video-aspect-override", v as never).catch(() => {});
    toast(`Bildformat: ${label}`, "info");
  }, [toast]);

  // loop the current file (context menu)
  const [loopFile, setLoopFile] = useState(false);
  const toggleLoop = useCallback(() => {
    setLoopFile((cur) => {
      const next = !cur;
      setProperty("loop-file", (next ? "inf" : "no") as never).catch(() => {});
      toast(next ? "Wiederholung an" : "Wiederholung aus", "info");
      return next;
    });
  }, [toast]);

  // S key / menu → save the current frame as PNG into the Pictures folder
  const takeScreenshot = useCallback(async () => {
    try {
      const dir = await pictureDir();
      const file = await join(dir, `GHGFlix_${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
      await command("screenshot-to-file", [file, "video"]);
      toast("Screenshot gespeichert (Bilder-Ordner)", "success");
    } catch (e) {
      toast(`Screenshot fehlgeschlagen: ${e}`, "error");
    }
  }, [toast]);
  const switchVersion = (m: MediaVersion) => {
    setTrackMenu(null);
    if (m.path === versionPath) return;
    resumeRef.current = posRef.current; // resume at the same spot in the new file
    pathRef.current = m.path;
    setVersionPath(m.path);
    setQuality(computeQuality(m));
    tracksLoadedRef.current = false; // re-read audio/subtitle tracks of the new file
    setVideoReady(false); // black GHGFlix screen until the new file shows a frame
    command("loadfile", [m.path]).catch(() => {});
    toast(`Qualität: ${computeQuality(m) || "Version gewechselt"}`, "info");
  };
  const changeAudioDevice = (name: string) => {
    setAudioDevice(name);
    setProperty("audio-device", name as any).catch(() => {});
  };
  // audio/subtitle sync offsets (±0.1s steps)
  const [audioDelay, setAudioDelay] = useState(0);
  const [subDelay, setSubDelay] = useState(0);
  const nudgeDelay = (kind: "audio" | "sub", d: number) => {
    if (kind === "audio") {
      setAudioDelay((cur) => {
        const v = Math.round((cur + d) * 10) / 10;
        setProperty("audio-delay", v).catch(() => {});
        return v;
      });
    } else {
      setSubDelay((cur) => {
        const v = Math.round((cur + d) * 10) / 10;
        setProperty("sub-delay", v).catch(() => {});
        return v;
      });
    }
  };

  // mpv init + observers (once)
  useEffect(() => {
    let unobserve: (() => void) | null = null;
    let cancelled = false;
    (async () => {
      try {
        markerKeyRef.current = ((await getSetting("marker_key")) || "k").toLowerCase();
        subDefaultRef.current = (await getSetting("sub_default")) || "off";
        subLangRef.current = (await getSetting("sub_lang")) || "en";
        introSkipRef.current = parseInt((await getSetting("intro_skip")) || "85", 10) || 85;
        introModeRef.current = (await getSetting("intro_mode")) || "button";
        introSourceRef.current = (await getSetting("intro_source")) || "auto";
        autoQualityRef.current = (await getSetting("auto_quality")) || "highest";
        const ti = parseInt((await getSetting("thumb_interval")) || "5", 10) || 5;
        setThumbInterval(Math.min(60, Math.max(1, ti)));
        const ts = (await getSetting("thumb_size")) || "md";
        setThumbWidth(ts === "sm" ? 140 : ts === "lg" ? 260 : 176);
        const mpvPath = (await getSetting("mpv_path"))?.trim();
        if (playback().mpvInited) {
          // mpv is already running (mini-player handoff) — reuse it seamlessly
          applyMiniMargins(false, prefsRef.current.miniSize);
        } else {
          await init({
            path: mpvPath || undefined,
            args: await buildMpvArgs(),
            observedProperties: OBSERVED,
          });
          playback().setInited(true);
        }
        if (cancelled) return;
        unobserve = await observeProperties(OBSERVED, ({ name, data }) => {
          if (name === "pause") setPaused(Boolean(data));
          else if (name === "duration") {
            const d = Number(data) || 0;
            durRef.current = d;
            setDuration(d);
          } else if (name === "time-pos") {
            const p = Number(data) || 0;
            posRef.current = p;
            if (p > 0) setVideoReady(true); // first frame shown → hide the loading screen
            setPosition((prev) => (Math.floor(prev) === Math.floor(p) ? prev : p));
            if (introModeRef.current === "off") {
              setIntroSkipVisible(false);
            } else {
              const win = resolveIntroWindow();
              if (win) {
                const inWin = p >= win.start - 1 && p < win.end - 0.3;
                if (inWin && introModeRef.current === "auto" && !introSkippedRef.current && p > 0.5) {
                  introSkippedRef.current = true;
                  command("seek", [win.end, "absolute"]).catch(() => {});
                  setIntroSkipVisible(false);
                } else {
                  setIntroSkipVisible(inWin);
                }
              } else {
                setIntroSkipVisible(false);
              }
            }
            if (resumeRef.current != null && p > 0) {
              const target = resumeRef.current;
              resumeRef.current = null;
              command("seek", [target, "absolute"]).catch(() => {});
              toast(`Fortgesetzt bei ${formatTime(target)}`, "info");
            }
            if (!tracksLoadedRef.current && p > 0) {
              tracksLoadedRef.current = true;
              loadTracks();
            }
            const now = Date.now();
            if (now - lastSaveRef.current > 5000) {
              lastSaveRef.current = now;
              saveProgress();
            }
          } else if (name === "paused-for-cache") {
            setBuffering(Boolean(data));
          } else if (name === "demuxer-cache-time") {
            setBuffered(Number(data) || 0);
          } else if (name === "eof-reached") {
            if (data === true) handleEnd();
          }
        });
        // restore the last-used volume + playback speed
        const savedVol = Math.min(100, Math.max(0, parseInt(localStorage.getItem("ghgflix.volume") || "100", 10) || 100));
        setVol(savedVol);
        setProperty("volume", savedVol).catch(() => {});
        const savedSpeed = parseFloat(localStorage.getItem("ghgflix.speed") || "1") || 1;
        if (SPEEDS.includes(savedSpeed) && savedSpeed !== 1) {
          setSpeed(savedSpeed);
          setProperty("speed", savedSpeed).catch(() => {});
        }
        setReady(true);
      } catch (e) {
        setError("mpv konnte nicht gestartet werden. Ist mpv installiert / im PATH (oder Pfad in Einstellungen)?\n" + String(e));
      }
    })();
    return () => {
      cancelled = true;
      saveProgress();
      if (unobserve) unobserve();
      if (playback().handoff) {
        // video keeps running in the mini player — do NOT destroy mpv
        playback().setHandoff(false);
      } else {
        destroy().catch(() => {});
        playback().setInited(false);
        if (pipRef.current) restoreWindow();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // load current item on id change
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    itemRef.current = { type: mediaType, id: mediaId };
    tracksLoadedRef.current = false;
    markerRef.current = null;
    introWindowRef.current = null;
    chapterWindowRef.current = null;
    introSkippedRef.current = false;
    setIntroSkipVisible(false);
    setNextCancelled(false);
    setVideoReady(false);
    setVersions([]);
    setVersionPath(null);
    setEndScreen(false);
    setChapters([]);
    setEpPanel(false);
    introMarkRef.current = null;
    (async () => {
      try {
        let path: string | null = null;
        if (mediaType === "episode") {
          const ep = await getEpisode(mediaId);
          if (!ep) throw new Error("Folge nicht gefunden");
          path = ep.path;
          setTitle(ep.showTitle || "Folge");
          setSubtitle(`${seasonEpisodeLabel(ep.season, ep.episode)}${ep.title ? " · " + ep.title : ""}`);
          // remember the season so the detail page reopens on the RIGHT tab
          // (S6E3 → back must land on Staffel 6, not Staffel 1)
          backTargetRef.current = `/show/${ep.showId}?season=${ep.season}`;
          if (ep.introStart != null && ep.introEnd != null && ep.introEnd > ep.introStart + 2) {
            introWindowRef.current = { start: ep.introStart, end: ep.introEnd };
          }
          // every quality of this episode → auto-pick per the setting
          let files: MediaVersion[] = [{ id: ep.id, path: ep.path, width: ep.width, height: ep.height }];
          try {
            const v = await episodeVersions(mediaId);
            if (v.length > 1) files = v.map((f) => ({ id: f.id, path: f.path, width: f.width, height: f.height }));
          } catch {
            /* ignore */
          }
          if (!cancelled) setVersions(files);
          const chosen = pickVersion(files, autoQualityRef.current) ?? files[0];
          path = chosen.path;
          setVersionPath(chosen.path);
          setQuality(computeQuality(chosen));
          const list = await listShowEpisodes(ep.showId);
          if (!cancelled) setEpisodes(list);
        } else {
          const m = await getMovie(mediaId);
          if (!m) throw new Error("Film nicht gefunden");
          setTitle(m.title);
          setSubtitle(m.year ? String(m.year) : null);
          backTargetRef.current = `/movie/${mediaId}`;
          // gather every quality of this movie and auto-pick per the setting
          let files: MediaVersion[] = [{ id: m.id, path: m.path, width: m.width, height: m.height }];
          try {
            const v = await movieVersions(mediaId);
            if (v.length > 1) files = v.map((mm) => ({ id: mm.id, path: mm.path, width: mm.width, height: mm.height }));
          } catch {
            /* ignore */
          }
          if (!cancelled) setVersions(files);
          const chosen = pickVersion(files, autoQualityRef.current) ?? files[0];
          path = chosen.path;
          setVersionPath(chosen.path);
          setQuality(computeQuality(chosen));
        }
        // Expanding from the mini player? The SAME file is already playing —
        // skip loadfile + resume so the video continues without a hiccup.
        const expand = playback().expandTo;
        const fromMini = expand && expand.mediaType === mediaType && expand.mediaId === mediaId;
        // Starting something NEW while a mini is still running (user clicked
        // "Abspielen" in the library): tear the stale mini down, otherwise its
        // observers would keep saving the OLD item's progress against the NEW
        // item's timeline.
        if (!fromMini && playback().mini) {
          playback().setMini(null);
        }
        if (fromMini) {
          playback().setExpandTo(null);
          if (expand.path) {
            path = expand.path;
            setVersionPath(expand.path);
          }
          pathRef.current = path;
          resumeRef.current = null;
          setVideoReady(true);
          if (!tracksLoadedRef.current) {
            tracksLoadedRef.current = true;
            void loadTracks();
          }
          return;
        }
        pathRef.current = path;
        const prog = await getProgress(profileId, mediaType, mediaId);
        resumeRef.current = prog && !prog.watched && prog.positionSec > 30 ? prog.positionSec : null;
        if (path && !cancelled) await command("loadfile", [path]);
      } catch (e) {
        setError(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, mediaType, mediaId]);

  const wake = useCallback(() => {
    setShowUi(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setShowUi(false);
      setTrackMenu(null);
    }, Math.max(1, prefsRef.current.uiTimeoutSec || 3) * 1000);
  }, []);

  useEffect(() => {
    wake();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [wake]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const combo = comboFromEvent(e);
      if (markerKeyRef.current && combo === markerKeyRef.current) {
        e.preventDefault();
        toggleMarker();
        return;
      }
      wake();
      const pf = prefsRef.current;
      if (e.key === " ") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "l") {
        command("seek", [e.shiftKey ? pf.seekBig : pf.seekSmall, "relative"]).catch(() => {});
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "j") {
        command("seek", [e.shiftKey ? -pf.seekBig : -pf.seekSmall, "relative"]).catch(() => {});
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        nudgeVolume(pf.volumeStep);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        nudgeVolume(-pf.volumeStep);
      } else if (e.key === "[") {
        stepSpeed(-1);
      } else if (e.key === "]") {
        stepSpeed(1);
      } else if (e.key === ".") {
        // frame-by-frame stepping (pauses playback)
        command("frame-step", []).catch(() => {});
      } else if (e.key === ",") {
        command("frame-back-step", []).catch(() => {});
      } else if (e.key.toLowerCase() === "a" && !e.ctrlKey) {
        cycleAspect();
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey) {
        if (prefsRef.current.screenshotEnabled) takeScreenshot();
      } else if (e.key.toLowerCase() === "n" && mediaType === "episode") {
        if (nextEp) navigate(`/play/episode/${nextEp.id}`);
      } else if (e.key === "PageUp") {
        command("add", ["chapter", -1]).catch(() => {});
      } else if (e.key === "PageDown") {
        command("add", ["chapter", 1]).catch(() => {});
      } else if (/^[0-9]$/.test(e.key)) {
        // 0–9 → jump to 0 %–90 % of the file (YouTube-style)
        if (durRef.current > 0) command("seek", [(Number(e.key) / 10) * durRef.current, "absolute"]).catch(() => {});
      } else if (e.key.toLowerCase() === "m") {
        setMuted((m) => {
          const nm = !m;
          setProperty("mute", nm).catch(() => {});
          return nm;
        });
      } else if (e.key.toLowerCase() === "c") {
        toggleSubtitles();
      } else if (e.key.toLowerCase() === "f") toggleFullscreen();
      else if (e.key.toLowerCase() === "p") togglePip();
      else if (e.key === "Escape") {
        if (pipRef.current) togglePip();
        else if (fullscreen) toggleFullscreen();
        else goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [wake, fullscreen, togglePause, toggleFullscreen, togglePip, goBack, toggleMarker, stepSpeed, takeScreenshot, cycleAspect, mediaType, nextEp, navigate]);

  useEffect(() => {
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("mouseup", onMouse);
    return () => window.removeEventListener("mouseup", onMouse);
  }, [goBack]);

  const changeVolume = (v: number) => {
    setVol(v);
    setProperty("volume", v).catch(() => {});
    localStorage.setItem("ghgflix.volume", String(v));
    if (v > 0 && muted) {
      setMuted(false);
      setProperty("mute", false).catch(() => {});
    }
  };
  // transient volume % overlay (YouTube-style OSD) so wheel/arrow changes are visible
  const flashVolume = useCallback((v: number) => {
    setVolOsd(v);
    if (volOsdTimer.current) window.clearTimeout(volOsdTimer.current);
    volOsdTimer.current = window.setTimeout(() => setVolOsd(null), 1200);
  }, []);
  const nudgeVolume = useCallback((delta: number) => {
    setMuted(false);
    setProperty("mute", false).catch(() => {});
    setVol((v) => {
      const max = Math.max(100, prefsRef.current.volumeMax || 100); // boost up to 150%
      const nv = Math.min(max, Math.max(0, v + delta));
      setProperty("volume", nv).catch(() => {});
      localStorage.setItem("ghgflix.volume", String(nv));
      flashVolume(nv);
      return nv;
    });
  }, [flashVolume]);
  const toggleMute = () => {
    const m = !muted;
    setMuted(m);
    setProperty("mute", m).catch(() => {});
  };
  const seekTo = (v: number) => {
    setPosition(v);
    command("seek", [v, "absolute"]).catch(() => {});
  };
  const getThumb = useCallback(async (t: number) => {
    if (!pathRef.current || !prefsRef.current.thumbEnabled) return null;
    try {
      return await mediaThumbnail(pathRef.current, t);
    } catch {
      return null;
    }
  }, []);
  const selectAudio = (v: number | "no") => {
    setAid(v);
    setProperty("aid", v as any).catch(() => {});
    // remember the chosen language so the next file starts with it
    if (prefsRef.current.rememberTrackLang && v !== "no") {
      const lang = (tracksRef.current.find((t) => t.id === v && t.type === "audio")?.lang || "").toLowerCase();
      if (lang) localStorage.setItem("ghgflix.audioLang", lang);
    }
    setTrackMenu(null);
  };
  const selectSub = (v: number | "no") => {
    setSid(v);
    setProperty("sid", v as any).catch(() => {});
    setTrackMenu(null);
  };
  const toggleSubtitles = useCallback(() => {
    setSid((cur) => {
      if (cur === "no") {
        const first = tracksRef.current.find((t) => t.type === "sub");
        const next = first ? first.id : ("no" as const);
        setProperty("sid", next as any).catch(() => {});
        return next;
      }
      setProperty("sid", "no" as any).catch(() => {});
      return "no";
    });
  }, []);
  const addExternalSub = async () => {
    const file = await openDialog({ multiple: false, filters: [{ name: "Untertitel", extensions: ["srt", "ass", "ssa", "sub", "vtt"] }] });
    if (typeof file === "string") {
      let url = file;
      if (IS_WEB && webPickedFile && !/\.vtt$/i.test(webPickedFile.name)) {
        // browsers only render WebVTT — convert SRT on the fly
        try {
          url = URL.createObjectURL(new Blob([srtToVtt(await webPickedFile.text())], { type: "text/vtt" }));
        } catch {
          /* fall through with the raw file */
        }
      }
      await command("sub-add", [url]).catch((e) => toast(String(e), "error"));
      await loadTracks();
    }
  };
  const skipIntro = () => {
    // always jump to the END of the resolved window (chapter/audio/fixed per the
    // user's setting) — never blindly to a fixed offset
    const w = resolveIntroWindow();
    const target = w ? w.end : Math.max(introSkipRef.current, posRef.current + 1);
    command("seek", [target, "absolute"]).catch(() => {});
    setIntroSkipVisible(false);
  };

  // drag the window in PiP mode by pressing anywhere
  const onBackgroundMouseDown = (e: React.MouseEvent) => {
    if (pipRef.current && e.button === 0) {
      getCurrentWindow().startDragging().catch(() => {});
    }
  };

  const audioTracks = tracks.filter((t) => t.type === "audio");
  const subTracks = tracks.filter((t) => t.type === "sub");
  const trackLabel = (t: Track) => {
    const ln = langName(t.lang);
    const parts: string[] = [];
    if (ln) parts.push(ln);
    if (t.title && (!ln || t.title.toLowerCase() !== ln.toLowerCase())) parts.push(t.title);
    // when the file carries no language/title, show codec + channel layout as a hint
    if (parts.length === 0) {
      const tech: string[] = [];
      if (t.codec) tech.push(t.codec.toUpperCase());
      const ch = t["demux-channels"] || (t["demux-channel-count"] ? `${t["demux-channel-count"]}ch` : "");
      if (ch) tech.push(String(ch));
      if (tech.length) parts.push(tech.join(" "));
    }
    if (t.forced) parts.push("(forciert)");
    if (parts.length === 0) parts.push(t.type === "audio" ? `Audio ${t.id}` : `Spur ${t.id}`);
    return parts.join(" · ");
  };

  const showNext =
    mediaType === "episode" &&
    !!nextEp &&
    duration > 0 &&
    duration - position <= (prefsRef.current.nextCountdownSec || 15) &&
    duration - position > 0 &&
    !nextCancelled &&
    prefsRef.current.autoplayNext;

  const openPlayerMenu = (e: React.MouseEvent) => {
    const items: any[] = [
      { label: paused ? "Abspielen" : "Pause", onClick: togglePause },
      { label: pip ? "Bild-im-Bild beenden" : "Bild-im-Bild", onClick: togglePip },
      { label: fullscreen ? "Vollbild beenden" : "Vollbild", onClick: toggleFullscreen },
    ];
    if (mediaType === "episode") {
      items.push({ label: "Nächste Folge", onClick: () => nextEp && navigate(`/play/episode/${nextEp.id}`), disabled: !nextEp });
      items.push({ label: "Vorherige Folge", onClick: () => prevEp && navigate(`/play/episode/${prevEp.id}`), disabled: !prevEp });
      items.push({ label: "Episodenliste", onClick: () => setEpPanel(true) });
      items.push({ separator: true, label: "", onClick: () => {} });
      // manual intro marking: first set the start, then the end — persists for
      // this episode and powers the skip button/auto-skip immediately
      if (introMarkRef.current == null) {
        items.push({
          label: "Intro: Start hier setzen",
          onClick: () => {
            introMarkRef.current = posRef.current;
            toast(`Intro-Start bei ${formatTime(posRef.current)} – jetzt „Intro: Ende hier setzen“`, "info");
          },
        });
      } else {
        items.push({
          label: `Intro: Ende hier setzen (${formatTime(introMarkRef.current)} → jetzt)`,
          onClick: () => {
            const start = introMarkRef.current ?? 0;
            const end = posRef.current;
            introMarkRef.current = null;
            if (end > start + 2) {
              introWindowRef.current = { start, end };
              void setEpisodeIntro(mediaId, start, end)
                .then(() => toast("Intro gespeichert – wird ab jetzt übersprungen", "success"))
                .catch((er) => toast(String(er), "error"));
            } else {
              toast("Intro-Ende muss nach dem Start liegen", "error");
            }
          },
        });
        items.push({
          label: "Intro-Markierung verwerfen",
          onClick: () => {
            introMarkRef.current = null;
          },
        });
      }
    }
    items.push({ separator: true, label: "", onClick: () => {} });
    items.push({ label: loopFile ? "Wiederholung aus" : "Datei wiederholen", onClick: toggleLoop });
    items.push({ label: "Bildformat wechseln (A)", onClick: cycleAspect });
    if (prefsRef.current.screenshotEnabled) {
      items.push({ label: "Screenshot speichern", onClick: () => void takeScreenshot() });
    }
    items.push({
      label: "In Ordner anzeigen",
      onClick: () => {
        if (pathRef.current) void revealInExplorer(pathRef.current).catch(() => {});
      },
    });
    items.push({ label: "Zurück", onClick: goBack });
    openCtx(e, items);
  };

  return (
    <div
      className={`fixed inset-0 bg-transparent text-white select-none ${showUi ? "" : "cursor-none"}`}
      onMouseMove={wake}
      onMouseLeave={() => {
        setShowUi(false);
        setTrackMenu(null);
      }}
      onWheel={(e) => {
        if (pip) return;
        nudgeVolume(e.deltaY < 0 ? 5 : -5);
        wake();
      }}
      onContextMenu={openPlayerMenu}
      onClick={() => trackMenu && setTrackMenu(null)}
    >
      <div
        className="absolute inset-0"
        onMouseDown={onBackgroundMouseDown}
        onClick={() => !pip && togglePause()}
        onDoubleClick={(e) => {
          if (pip) return;
          // double-click on the left/right third seeks (configurable), middle = fullscreen
          // (the two single clicks before a dblclick toggle pause twice = no-op,
          // so no compensation is needed here)
          if (prefsRef.current.dblClickSeek) {
            const frac = e.clientX / window.innerWidth;
            if (frac < 0.3) {
              command("seek", [-prefsRef.current.seekSmall, "relative"]).catch(() => {});
              return;
            }
            if (frac > 0.7) {
              command("seek", [prefsRef.current.seekSmall, "relative"]).catch(() => {});
              return;
            }
          }
          toggleFullscreen();
        }}
      />

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-ghg-bg/95 p-8">
          <div className="max-w-lg text-center">
            <p className="text-ghg-red font-bold text-lg mb-3">Wiedergabe-Fehler</p>
            <p className="text-sm text-ghg-muted whitespace-pre-wrap">{error}</p>
            <button onClick={goBack} className="mt-5 px-4 py-2 rounded-lg bg-ghg-red hover:bg-ghg-red-bright">Zurück</button>
          </div>
        </div>
      )}

      {/* Opaque GHGFlix loading screen: paints over the transparent window so the
          desktop never shows through while mpv starts up or a file is loading. */}
      {!videoReady && !error && !pip && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 bg-ghg-bg">
          <div className="breathe">
            <Wordmark size="lg" />
          </div>
          {title && <p className="text-lg font-semibold text-white/90 max-w-xl text-center px-6 line-clamp-2">{title}</p>}
          <div className="flex items-center gap-2 text-ghg-muted text-sm">
            <Spinner className="w-5 h-5" /> Wird geladen …
          </div>
        </div>
      )}
      {!videoReady && !error && pip && <div className="absolute inset-0 bg-ghg-bg" />}

      {/* transient volume OSD */}
      {volOsd != null && !pip && (
        <div className="absolute top-24 right-8 bg-black/70 rounded-xl px-4 py-2.5 flex items-center gap-3 pointer-events-none fade-in">
          {volOsd === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
          <div className="w-28 h-1.5 rounded-full bg-white/25 overflow-hidden">
            <div className="h-full bg-ghg-red" style={{ width: `${volOsd}%` }} />
          </div>
          <span className="text-sm font-semibold tabular-nums w-9 text-right">{volOsd}%</span>
        </div>
      )}

      {/* mid-playback buffering indicator */}
      {buffering && videoReady && !error && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="bg-black/50 rounded-2xl p-5">
            <Spinner className="w-10 h-10" />
          </div>
        </div>
      )}

      {/* intro skip */}
      {introSkipVisible && showUi && !pip && (
        <button
          onClick={skipIntro}
          className="absolute bottom-28 right-8 px-4 py-2 rounded-lg bg-black/70 hover:bg-ghg-red border border-white/20 text-sm font-semibold transition"
        >
          Intro überspringen ⏭
        </button>
      )}

      {/* next episode countdown (with a preview still when available) */}
      {showNext && (
        <div className="absolute bottom-28 right-8 bg-ghg-elevated/95 border border-ghg-line rounded-xl p-4 w-80 fade-in">
          <div className="flex gap-3">
            {nextEp && stillUrl(nextEp.stillPath) && (
              <img src={stillUrl(nextEp.stillPath)!} alt="" className="w-24 rounded-lg object-cover aspect-video" draggable={false} />
            )}
            <div className="min-w-0">
              <p className="text-xs text-ghg-muted mb-1">Nächste Folge in {Math.ceil(duration - position)}s</p>
              <p className="font-semibold text-sm line-clamp-2">
                {nextEp && `${seasonEpisodeLabel(nextEp.season, nextEp.episode)} · ${nextEp.title || ""}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={() => nextEp && navigate(`/play/episode/${nextEp.id}`)} className="flex-1 py-1.5 rounded-lg bg-ghg-red hover:bg-ghg-red-bright text-sm font-semibold">
              Jetzt
            </button>
            <button onClick={() => setNextCancelled(true)} className="px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm">
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {/* end screen (when auto-back / autoplay are disabled) */}
      {endScreen && !error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-ghg-bg/95 fade-in">
          <Wordmark size="lg" />
          <p className="text-lg font-semibold">{title} — zu Ende</p>
          <div className="flex gap-3">
            <button
              onClick={() => {
                setEndScreen(false);
                command("seek", [0, "absolute"]).catch(() => {});
                setProperty("pause", false).catch(() => {});
              }}
              className="px-4 py-2 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm font-semibold"
            >
              Nochmal ansehen
            </button>
            {mediaType === "episode" && nextEp && (
              <button
                onClick={() => navigate(`/play/episode/${nextEp.id}`)}
                className="px-4 py-2 rounded-lg bg-ghg-red hover:bg-ghg-red-bright text-sm font-semibold"
              >
                Nächste Folge
              </button>
            )}
            <button onClick={goBack} className="px-4 py-2 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm font-semibold">
              Zurück
            </button>
          </div>
        </div>
      )}

      {/* episode quick-list panel */}
      {epPanel && mediaType === "episode" && (
        <div className="absolute top-0 right-0 bottom-0 w-96 max-w-[85vw] bg-ghg-bg/95 border-l border-ghg-line flex flex-col fade-in z-20" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-ghg-line">
            <p className="font-bold text-sm">Episoden</p>
            <button onClick={() => setEpPanel(false)} className="p-1.5 rounded-lg hover:bg-ghg-surface2">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {queueItems.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between px-1 mb-1">
                  <p className="text-[11px] uppercase tracking-wide text-ghg-muted">Warteschlange</p>
                  <button onClick={() => playback().clearQueue()} className="text-[11px] text-ghg-muted hover:text-ghg-red">
                    Leeren
                  </button>
                </div>
                {queueItems.map((q, qi) => (
                  <div key={q.key} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs hover:bg-ghg-surface2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{q.label}</span>
                      {q.sub && <span className="block truncate text-ghg-muted">{q.sub}</span>}
                    </span>
                    <button onClick={() => playback().moveInQueue(q.key, -1)} disabled={qi === 0} className="px-1 text-ghg-muted hover:text-ghg-text disabled:opacity-30">↑</button>
                    <button onClick={() => playback().moveInQueue(q.key, 1)} disabled={qi === queueItems.length - 1} className="px-1 text-ghg-muted hover:text-ghg-text disabled:opacity-30">↓</button>
                    <button onClick={() => playback().removeFromQueue(q.key)} className="px-1 text-ghg-muted hover:text-ghg-red">✕</button>
                  </div>
                ))}
                <div className="border-b border-ghg-line my-2" />
              </div>
            )}
            {episodes.map((ep) => (
              <button
                key={ep.id}
                onClick={() => {
                  setEpPanel(false);
                  if (ep.id !== mediaId) navigate(`/play/episode/${ep.id}`);
                }}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm flex items-center gap-2 hover:bg-ghg-surface2 ${ep.id === mediaId ? "bg-ghg-red/15 text-ghg-red" : ""}`}
              >
                <span className="font-mono text-xs shrink-0">{seasonEpisodeLabel(ep.season, ep.episode)}</span>
                <span className="truncate">{ep.title || "Folge"}</span>
                {ep.id === mediaId && <Play className="w-3.5 h-3.5 ml-auto shrink-0 fill-current" />}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* top bar */}
      <div className={`absolute top-0 left-0 right-0 p-5 bg-gradient-to-b from-black/80 to-transparent transition-opacity duration-300 ${showUi && !pip ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
        <div className="flex items-center gap-4">
          <button onClick={goBack} title={prefsRef.current.backButtonAction === "mini" ? "Zurück (Mini-Player)" : "Zurück (Player schließen)"} className="p-2 rounded-lg bg-black/40 hover:bg-ghg-red transition">
            <ArrowLeft className="w-5 h-5" />
          </button>
          {prefsRef.current.showCloseX && (
            <button onClick={closePlayer} title={prefsRef.current.xButtonAction === "close" ? "Player schließen" : "Mini-Player öffnen"} className="p-2 rounded-lg bg-black/40 hover:bg-ghg-red transition">
              <X className="w-5 h-5" />
            </button>
          )}
          <div>
            <p className="font-bold text-lg leading-tight flex items-center gap-2">
              {title}
              {quality && <span className="px-1.5 py-0.5 rounded bg-white/15 text-xs font-semibold">{quality}</span>}
            </p>
            {subtitle && <p className="text-sm text-white/70">{subtitle}</p>}
          </div>
          <div className="ml-auto text-right text-sm text-white/70 tabular-nums">
            {prefsRef.current.showClock && <p>{new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })} Uhr</p>}
            {prefsRef.current.showEndsAt && duration > 0 && (
              <p className="text-xs">
                endet um{" "}
                {new Date(Date.now() + Math.max(0, (duration - position) / (speed || 1)) * 1000).toLocaleTimeString("de-DE", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* bottom controls */}
      <div
        className={`absolute bottom-0 left-0 right-0 ${pip ? "p-2" : "p-6"} bg-gradient-to-t from-black/90 to-transparent transition-opacity duration-300 ${showUi ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 mb-3 text-xs font-mono">
          <span className="tabular-nums">{formatTime(position)}</span>
          {pip ? (
            <input
              type="range"
              min={0}
              max={duration || 0}
              value={position}
              step={1}
              onChange={(e) => seekTo(Number(e.target.value))}
              className="flex-1 accent-ghg-red h-1.5 cursor-pointer"
            />
          ) : (
            <Scrubber
              position={position}
              duration={duration}
              buffered={buffered}
              onSeek={seekTo}
              getThumb={getThumb}
              interval={thumbInterval}
              previewWidth={thumbWidth}
              markers={prefsRef.current.chapterMarkers ? chapters.map((c) => c.time) : undefined}
              intro={prefsRef.current.introMarker ? resolveIntroWindow() : null}
            />
          )}
          <button
            onClick={() => setShowRemaining((r) => !r)}
            className="tabular-nums hover:text-ghg-red transition"
            title="Gesamt-/Restzeit umschalten"
          >
            {showRemaining ? `-${formatTime(Math.max(0, duration - position))}` : formatTime(duration)}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={togglePause} className="p-2.5 rounded-full bg-ghg-red hover:bg-ghg-red-bright transition">
            {paused ? <Play className="w-5 h-5 fill-white" /> : <Pause className="w-5 h-5 fill-white" />}
          </button>

          {mediaType === "episode" && (
            <>
              <button onClick={() => prevEp && navigate(`/play/episode/${prevEp.id}`)} disabled={!prevEp} className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition" title="Vorherige Folge">
                <SkipBack className="w-5 h-5" />
              </button>
              <button onClick={() => nextEp && navigate(`/play/episode/${nextEp.id}`)} disabled={!nextEp} className="p-2 rounded-lg hover:bg-white/10 disabled:opacity-30 transition" title="Nächste Folge">
                <SkipForward className="w-5 h-5" />
              </button>
            </>
          )}

          <div className="flex items-center gap-2 ml-1">
            <button onClick={toggleMute} className="p-2 rounded-lg hover:bg-white/10 transition">
              {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            {!pip && (
              <input
                type="range"
                min={0}
                max={Math.max(100, prefsRef.current.volumeMax || 100)}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-24 accent-ghg-red h-1 cursor-pointer"
                title={volume > 100 ? `${volume}% (Boost)` : `${volume}%`}
              />
            )}
          </div>

          <div className="flex-1" />

          {/* quality / version switch (only when the same movie exists in several qualities) */}
          {versions.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setTrackMenu(trackMenu === "version" ? null : "version")}
                className="px-2 py-1.5 rounded-lg hover:bg-white/10 transition text-xs font-semibold flex items-center gap-1"
                title="Qualität / Version"
              >
                <Layers className="w-5 h-5" /> {quality || "Version"}
                <span className="text-[10px] text-ghg-muted">×{versions.length}</span>
              </button>
              {trackMenu === "version" && (
                <div className="absolute bottom-12 right-0 w-60 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden fade-in max-h-72 overflow-y-auto">
                  <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ghg-muted">Qualität / Version</p>
                  {versions.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => switchVersion(v)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2 flex items-center justify-between gap-2 ${v.path === versionPath ? "text-ghg-red" : ""}`}
                    >
                      <span className="font-semibold">{computeQuality(v) || "?"}</span>
                      <span className="text-xs text-ghg-muted">{v.width && v.height ? `${v.width}×${v.height}` : ""}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* chapters */}
          {chapters.length > 1 && (
            <div className="relative">
              <button
                onClick={() => setTrackMenu(trackMenu === "chapters" ? null : "chapters")}
                className="px-2 py-1.5 rounded-lg hover:bg-white/10 transition text-xs font-semibold flex items-center gap-1"
                title="Kapitel"
              >
                <ChevronRight className="w-5 h-5" /> Kapitel
              </button>
              {trackMenu === "chapters" && (
                <div className="absolute bottom-12 right-0 w-64 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden fade-in max-h-72 overflow-y-auto">
                  <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ghg-muted">Kapitel</p>
                  {chapters.map((c, i) => {
                    const active = position >= c.time && (i + 1 >= chapters.length || position < chapters[i + 1].time);
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          command("seek", [c.time, "absolute"]).catch(() => {});
                          setTrackMenu(null);
                        }}
                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-ghg-surface2 flex justify-between gap-2 ${active ? "text-ghg-red" : ""}`}
                      >
                        <span className="truncate">{c.title || `Kapitel ${i + 1}`}</span>
                        <span className="font-mono text-ghg-muted shrink-0">{formatTime(c.time)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* speed + audio device + sync offsets */}
          <div className="relative">
            <button onClick={() => setTrackMenu(trackMenu === "speed" ? null : "speed")} className="px-2 py-1.5 rounded-lg hover:bg-white/10 transition text-xs font-semibold flex items-center gap-1" title="Geschwindigkeit / Audiogerät / Sync">
              <Gauge className="w-5 h-5" /> {speed}×
            </button>
            {trackMenu === "speed" && (
              <div className="absolute bottom-12 right-0 w-64 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden fade-in max-h-96 overflow-y-auto">
                <p className="px-3 pt-2 pb-1 text-[11px] uppercase tracking-wide text-ghg-muted">Geschwindigkeit</p>
                <div className="flex flex-wrap gap-1 px-2 pb-2">
                  {SPEEDS.map((s) => (
                    <button key={s} onClick={() => changeSpeed(s)} className={`px-2 py-1 rounded text-xs ${speed === s ? "bg-ghg-red text-white" : "bg-ghg-surface2 hover:bg-ghg-elevated"}`}>
                      {s}×
                    </button>
                  ))}
                </div>
                {/* sync offsets */}
                <p className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wide text-ghg-muted border-t border-ghg-line">Synchronisation</p>
                <div className="px-3 pb-2 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span>Audio-Versatz</span>
                    <span className="flex items-center gap-1">
                      <button onClick={() => nudgeDelay("audio", -0.1)} className="px-1.5 py-0.5 rounded bg-ghg-surface2 hover:bg-ghg-bg2">−</button>
                      <span className="font-mono w-12 text-center">{audioDelay.toFixed(1)}s</span>
                      <button onClick={() => nudgeDelay("audio", 0.1)} className="px-1.5 py-0.5 rounded bg-ghg-surface2 hover:bg-ghg-bg2">+</button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span>Untertitel-Versatz</span>
                    <span className="flex items-center gap-1">
                      <button onClick={() => nudgeDelay("sub", -0.1)} className="px-1.5 py-0.5 rounded bg-ghg-surface2 hover:bg-ghg-bg2">−</button>
                      <span className="font-mono w-12 text-center">{subDelay.toFixed(1)}s</span>
                      <button onClick={() => nudgeDelay("sub", 0.1)} className="px-1.5 py-0.5 rounded bg-ghg-surface2 hover:bg-ghg-bg2">+</button>
                    </span>
                  </div>
                </div>
                {audioDevices.length > 0 && (
                  <>
                    <p className="px-3 pt-1 pb-1 text-[11px] uppercase tracking-wide text-ghg-muted border-t border-ghg-line">Audiogerät</p>
                    {audioDevices.map((d) => (
                      <button key={d.name} onClick={() => changeAudioDevice(d.name)} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-ghg-surface2 ${audioDevice === d.name ? "text-ghg-red" : ""}`}>
                        {d.description || d.name}
                      </button>
                    ))}
                  </>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <button onClick={() => setTrackMenu(trackMenu === "audio" ? null : "audio")} className="p-2 rounded-lg hover:bg-white/10 transition" title="Audiospur">
              <AudioLines className="w-5 h-5" />
            </button>
            {trackMenu === "audio" && <TrackMenu tracks={audioTracks} current={aid} onSelect={selectAudio} label={trackLabel} allowOff={false} />}
          </div>

          <div className="relative">
            <button onClick={() => setTrackMenu(trackMenu === "sub" ? null : "sub")} className="p-2 rounded-lg hover:bg-white/10 transition" title="Untertitel">
              <Captions className="w-5 h-5" />
            </button>
            {trackMenu === "sub" && <TrackMenu tracks={subTracks} current={sid} onSelect={selectSub} label={trackLabel} allowOff onAddExternal={addExternalSub} />}
          </div>

          {mediaType === "episode" && (
            <button onClick={() => setEpPanel((o) => !o)} className={`p-2 rounded-lg hover:bg-white/10 transition ${epPanel ? "text-ghg-red" : ""}`} title="Episodenliste">
              <ListVideo className="w-5 h-5" />
            </button>
          )}
          {prefsRef.current.screenshotEnabled && (
            <button onClick={() => void takeScreenshot()} className="p-2 rounded-lg hover:bg-white/10 transition" title="Screenshot (S)">
              <Camera className="w-5 h-5" />
            </button>
          )}
          <button onClick={togglePip} className={`p-2 rounded-lg hover:bg-white/10 transition ${pip ? "text-ghg-red" : ""}`} title="Bild-im-Bild">
            <PictureInPicture2 className="w-5 h-5" />
          </button>
          <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 transition" title="Vollbild">
            <Maximize className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function TrackMenu({
  tracks,
  current,
  onSelect,
  label,
  allowOff,
  onAddExternal,
}: {
  tracks: Track[];
  current: number | "no";
  onSelect: (v: number | "no") => void;
  label: (t: Track) => string;
  allowOff: boolean;
  onAddExternal?: () => void;
}) {
  return (
    <div className="absolute bottom-12 right-0 w-64 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden fade-in max-h-72 overflow-y-auto">
      {allowOff && (
        <button onClick={() => onSelect("no")} className={`w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2 flex items-center justify-between gap-2 ${current === "no" ? "text-ghg-red" : ""}`}>
          Aus {current === "no" && <Check className="w-4 h-4 shrink-0" />}
        </button>
      )}
      {tracks.length === 0 && <p className="px-3 py-2 text-sm text-ghg-muted">Keine Spuren</p>}
      {tracks.map((t) => (
        <button key={t.id} onClick={() => onSelect(t.id)} className={`w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2 flex items-center justify-between gap-2 ${current === t.id ? "text-ghg-red" : ""}`}>
          <span className="min-w-0 truncate">{label(t)}</span>
          {current === t.id && <Check className="w-4 h-4 shrink-0" />}
        </button>
      ))}
      {onAddExternal && (
        <button onClick={onAddExternal} className="w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2 border-t border-ghg-line text-ghg-muted">
          + Externe Datei …
        </button>
      )}
    </div>
  );
}

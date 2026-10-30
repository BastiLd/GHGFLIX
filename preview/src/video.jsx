import React, { useEffect, useRef } from "react";
// Echter HTML-Player für die UI-Prüfung. Android verwendet weiterhin expo-video.
export function useVideoPlayer(_source, setup) {
  const ref = useRef(null);
  if (!ref.current) {
    const el = document.createElement("video"); el.muted = true; el.playsInline = true;
    const listeners = new Map();
    const emit = (name, value) => listeners.get(name)?.forEach((fn) => fn(value));
    const p = {
      el, status: "idle", source: null,
      replace(src) { p.source = typeof src === "string" ? src : src?.uri; p.status = "loading"; el.src = typeof src === "string" ? src : src?.uri || ""; el.load(); },
      play() { el.play().catch(() => {}); }, pause() { el.pause(); },
      get playing() { return !el.paused; },
      get currentTime() { return el.currentTime; }, set currentTime(v) { el.currentTime = v; },
      get duration() { return Number.isFinite(el.duration) ? el.duration : 0; },
      get playbackRate() { return el.playbackRate; }, set playbackRate(v) { el.playbackRate = v; },
      addListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); return { remove: () => listeners.get(name)?.delete(fn) }; },
    };
    el.addEventListener("loadedmetadata", () => { p.status = "readyToPlay"; emit("sourceLoad", { videoSource: { uri: p.source }, duration: el.duration }); });
    el.addEventListener("timeupdate", () => emit("timeUpdate", { currentTime: el.currentTime }));
    el.addEventListener("play", () => emit("playingChange", { isPlaying: true }));
    el.addEventListener("pause", () => emit("playingChange", { isPlaying: false }));
    el.addEventListener("waiting", () => emit("statusChange", { status: "loading" }));
    el.addEventListener("canplay", () => emit("statusChange", { status: "readyToPlay" }));
    el.addEventListener("error", () => emit("statusChange", { status: "error" }));
    ref.current = p; setup?.(p);
  }
  useEffect(() => () => { ref.current.el.pause(); ref.current.el.removeAttribute("src"); ref.current.el.load(); }, []);
  return ref.current;
}
export function VideoView({ player, contentFit }) {
  const holder = useRef(null);
  useEffect(() => { const el = player.el; el.style.cssText = `width:100%;height:100%;object-fit:${contentFit};display:block`; holder.current.appendChild(el); return () => el.remove(); }, [player, contentFit]);
  return <div ref={holder} style={{ position: "absolute", inset: 0 }} />;
}

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { createPlayerGestures } from "../../shared/player-gestures.js";
import type { GestureSettings } from "../../shared/player-settings.js";

type Props = { settings: GestureSettings; identity: string; touchLayout: boolean; enabled: boolean; playing: boolean; speed: number; volume: number;
  onTap(): void; onSeek(seconds: number): void; onRate(rate: number): void; onVolume(value: number): void };
export function usePlayerTouch(p: Props) {
  const latest = useRef(p); latest.current = p;
  const [hud, setHud] = useState<string|null>(null), [dim, setDim] = useState(1);
  const dimRef = useRef(1), volumeRef = useRef(p.volume), heldRate = useRef<number|null>(null);
  volumeRef.current = p.volume;
  const suppressMouseUntil = useRef(0), active = useRef<number|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const flash = (text: string) => { if (timer.current) clearTimeout(timer.current); setHud(text); timer.current = setTimeout(()=>setHud(null),900); };
  const engine = useRef<ReturnType<typeof createPlayerGestures>|null>(null);
  if (!engine.current) engine.current = createPlayerGestures({
    settings: () => latest.current.settings, canHold: () => latest.current.playing,
    onTap: () => latest.current.onTap(), onSeek: s => { latest.current.onSeek(s); flash(`${s>0?"+":"−"}${Math.abs(s)} Sek`); },
    onHold: on => {
      if (on) { heldRate.current = latest.current.speed; latest.current.onRate(latest.current.settings.holdRate); setHud(`${latest.current.settings.holdRate}× · zum Beenden loslassen`); }
      else if (heldRate.current != null) { latest.current.onRate(heldRate.current); heldRate.current = null; setHud(null); }
    },
    onSwipe: (kind, delta) => {
      if (kind === "brightness") { dimRef.current = Math.max(.1,Math.min(1,dimRef.current+delta)); setDim(dimRef.current); flash(`Bildhelligkeit ${Math.round(dimRef.current*100)} %`); }
      else { volumeRef.current = Math.max(0,Math.min(100,volumeRef.current+delta*100)); latest.current.onVolume(volumeRef.current); flash(`GHGFlix ${Math.round(volumeRef.current)} %`); }
    },
  });
  useEffect(() => {
    const cancel = () => { engine.current?.cancel(); active.current = null; };
    window.addEventListener("blur",cancel); document.addEventListener("visibilitychange",cancel);
    return () => { cancel(); if(timer.current)clearTimeout(timer.current); window.removeEventListener("blur",cancel); document.removeEventListener("visibilitychange",cancel); };
  }, []);
  useEffect(() => { if (!p.enabled) engine.current?.cancel(); },[p.enabled]);
  useEffect(() => { engine.current?.cancel(); },[p.identity]);
  const start = (e: PointerEvent<HTMLDivElement>) => {
    if (!p.enabled || (!p.touchLayout && e.pointerType === "mouse")) return;
    if (active.current != null || e.isPrimary === false) { engine.current?.cancel(); return; }
    e.preventDefault(); active.current = e.pointerId; suppressMouseUntil.current = Date.now()+1200;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect(); engine.current?.start(e.clientX-r.left,e.clientY-r.top,r.width,r.height);
  };
  return { hud, dim, ignoreMouse: () => active.current != null || Date.now()<suppressMouseUntil.current, bind: {
    onPointerDown: start,
    onPointerMove: (e: PointerEvent<HTMLDivElement>) => { if(active.current!==e.pointerId)return; const r=e.currentTarget.getBoundingClientRect(); engine.current?.move(e.clientX-r.left,e.clientY-r.top); },
    onPointerUp: (e: PointerEvent<HTMLDivElement>) => { if(active.current!==e.pointerId)return; suppressMouseUntil.current=Date.now()+800; active.current=null; engine.current?.end(); },
    onPointerCancel: () => { active.current=null; engine.current?.cancel(); },
    onLostPointerCapture: () => { if(active.current!=null){active.current=null;engine.current?.cancel();} },
  } };
}

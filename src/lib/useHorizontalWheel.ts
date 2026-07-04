import { useEffect } from "react";
import { uiPrefs } from "./uiPrefs";

/** GLOBAL horizontal-wheel scrolling.
 *
 *  History: per-element listeners (v0.5–v0.7) kept dying — React re-mounts /
 *  replaced nodes silently dropped the listener, so tilt-wheel scrolling "worked
 *  once and then never again". This version installs ONE document-level,
 *  non-passive, capture-phase listener that can never go stale: on every wheel
 *  event it walks up from the target to the nearest horizontally scrollable
 *  element and eases it towards an accumulated target with requestAnimationFrame.
 *
 *  Per-element animation state lives in a WeakMap, so rows never interfere with
 *  each other and garbage collection stays clean. Speed + smoothing are user
 *  preferences (Einstellungen → Allgemein → Scrollen). */

interface Anim {
  target: number;
  raf: number;
}

const anims = new WeakMap<HTMLElement, Anim>();

function findScrollable(from: EventTarget | null): HTMLElement | null {
  let el = from instanceof Element ? (from as HTMLElement) : null;
  while (el && el !== document.body) {
    if (el.scrollWidth > el.clientWidth + 1) {
      const ox = getComputedStyle(el).overflowX;
      if (ox === "auto" || ox === "scroll") return el;
    }
    el = el.parentElement;
  }
  return null;
}

function animate(el: HTMLElement) {
  const a = anims.get(el);
  if (!a) return;
  const cur = el.scrollLeft;
  const diff = a.target - cur;
  if (Math.abs(diff) < 1) {
    el.scrollLeft = a.target;
    anims.delete(el);
    return;
  }
  // ease out — cover ~25% of the remaining distance per frame; ceil the step so
  // sub-pixel writes can't get truncated to zero and stall the loop
  const step = Math.sign(diff) * Math.max(1, Math.abs(diff) * 0.25);
  el.scrollLeft = cur + step;
  a.raf = requestAnimationFrame(() => animate(el));
}

export function installHorizontalWheel(): () => void {
  const onWheel = (e: WheelEvent) => {
    const horiz = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
    if (horiz === 0) return;
    const el = findScrollable(e.target);
    if (!el) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1;
    const max = el.scrollWidth - el.clientWidth;
    const prefs = uiPrefs();
    const delta = horiz * unit * (prefs.scrollSpeed || 1.8);
    e.preventDefault();

    if (!prefs.scrollSmooth) {
      el.scrollLeft = Math.max(0, Math.min(max, el.scrollLeft + delta));
      return;
    }
    const existing = anims.get(el);
    const base = existing ? existing.target : el.scrollLeft;
    const target = Math.max(0, Math.min(max, base + delta));
    if (existing) {
      existing.target = target;
    } else {
      const a: Anim = { target, raf: 0 };
      anims.set(el, a);
      a.raf = requestAnimationFrame(() => animate(el));
    }
  };
  // capture phase + non-passive → we always see the event first and CAN prevent
  // the WebView's own handling (back/forward swipe)
  document.addEventListener("wheel", onWheel, { passive: false, capture: true });
  return () => document.removeEventListener("wheel", onWheel, { capture: true } as EventListenerOptions);
}

/** Mount-once hook used by App. Kept as a hook so hot-reload cleans up. */
export function useGlobalHorizontalWheel() {
  useEffect(() => installHorizontalWheel(), []);
}

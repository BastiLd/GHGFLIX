// One recognizer for native responders and browser pointer events. A gesture owns
// its whole lifetime: a swipe/hold/cancel can never also become a tap.
export function createPlayerGestures(callbacks, clock = { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id), now: () => Date.now() }) {
  let active = null, lastTap = null, singleTimer = null, holdTimer = null;
  const clear = (id) => { if (id != null) clock.clearTimeout(id); };
  const clearSingle = () => { clear(singleTimer); singleTimer = null; };
  const cancel = () => {
    clear(holdTimer); holdTimer = null; clearSingle(); lastTap = null;
    if (active?.mode === "hold") callbacks.onHold(false);
    active = null;
  };
  return {
    start(x, y, width, height) {
      if (active) cancel();
      const settings = callbacks.settings();
      active = { x, y, lastY: y, width, height, mode: "tap", side: x < width / 2 ? "left" : "right" };
      if (settings.hold && callbacks.canHold()) holdTimer = clock.setTimeout(() => {
        holdTimer = null;
        if (active?.mode !== "tap") return;
        clearSingle(); lastTap = null; active.mode = "hold"; callbacks.onHold(true);
      }, 450);
    },
    move(x, y) {
      if (!active) return;
      const a = active, dx = x - a.x, dy = y - a.y, s = callbacks.settings();
      if (Math.hypot(dx, dy) > 12 && a.mode === "tap") {
        clear(holdTimer); holdTimer = null; clearSingle(); lastTap = null;
        const kind = a.side === "left" ? "brightness" : "volume";
        const allowed = kind === "brightness" ? s.swipeBrightness : s.swipeVolume;
        a.mode = allowed && Math.abs(dy) > Math.abs(dx) * 1.4 ? kind : "cancelled";
      }
      if (a.mode === "volume" || a.mode === "brightness") callbacks.onSwipe(a.mode, (a.lastY - y) / Math.max(1, a.height * .6));
      a.lastY = y;
    },
    end() {
      clear(holdTimer); holdTimer = null;
      const a = active; active = null;
      if (!a) return;
      if (a.mode === "hold") { callbacks.onHold(false); return; }
      if (a.mode !== "tap") return;
      const now = clock.now(), settings = callbacks.settings();
      if (!settings.doubleTap) { callbacks.onTap(); return; }
      if (lastTap && lastTap.side === a.side && now - lastTap.time <= 280) {
        clearSingle(); callbacks.onSeek((a.side === "left" ? -1 : 1) * settings.skipSeconds);
        lastTap = { side: a.side, time: now }; return;
      }
      // A pending tap on the other side is still a valid single tap.
      if (singleTimer != null) { clearSingle(); callbacks.onTap(); }
      lastTap = { side: a.side, time: now };
      singleTimer = clock.setTimeout(() => { singleTimer = null; lastTap = null; callbacks.onTap(); }, 280);
    }, cancel,
  };
}

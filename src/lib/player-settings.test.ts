import { afterEach, describe, expect, it, vi } from "vitest";
import { legacySubtitle, normalizeSubtitle, normalizeGestures, GESTURE_DEFAULTS } from "../../shared/player-settings.js";
import { createPlayerGestures } from "../../shared/player-gestures.js";
afterEach(() => vi.useRealTimers());
describe("player preferences", () => {
  it("migrates existing subtitle values, validates arbitrary colors and bounds", () => {
    expect(legacySubtitle({ utGroesse: 1.25, utFarbe: "#7FE07F", utHintergrund: .8, utRand: false })).toMatchObject({ sizePercent: 125, textColor: "#7fe07f", backgroundOpacity: 80, edgeStyle: "none" });
    expect(normalizeSubtitle({ sizePercent: Infinity, textColor: "url(javascript:bad)", backgroundOpacity: 900 })).toMatchObject({ sizePercent: 100, textColor: "#ffffff", backgroundOpacity: 100 });
    expect(normalizeGestures({ skipSeconds: -5, volumeTarget: "ring" })).toMatchObject({ skipSeconds: 1, volumeTarget: "player" });
    expect(normalizeSubtitle({ delaySeconds: .3 }).delaySeconds).toBe(.3);
  });
});
function fixture(settings = {}) {
  vi.useFakeTimers();
  const cb = { settings: () => ({ ...GESTURE_DEFAULTS, ...settings }), canHold: () => true, onTap: vi.fn(), onSeek: vi.fn(), onHold: vi.fn(), onSwipe: vi.fn() };
  const g = createPlayerGestures(cb);
  const tap = (x = 80) => { g.start(x, 50, 100, 100); g.end(); };
  return { cb, g, tap };
}
it("separates single taps from repeated double-tap seeking", () => {
  const { cb, tap } = fixture(); tap(); vi.advanceTimersByTime(290); expect(cb.onTap).toHaveBeenCalledTimes(1);
  tap(); vi.advanceTimersByTime(100); tap(); vi.advanceTimersByTime(100); tap(); vi.advanceTimersByTime(300);
  expect(cb.onSeek.mock.calls).toEqual([[10], [10]]); expect(cb.onTap).toHaveBeenCalledTimes(1);
});
it("restores hold tempo on release and cancellation without seeking or tapping", () => {
  const { cb, g } = fixture(); g.start(80, 50, 100, 100); vi.advanceTimersByTime(460); g.end();
  g.start(80, 50, 100, 100); vi.advanceTimersByTime(460); g.cancel();
  expect(cb.onHold.mock.calls).toEqual([[true], [false], [true], [false]]); expect(cb.onTap).not.toHaveBeenCalled(); expect(cb.onSeek).not.toHaveBeenCalled();
});
it("swipes own the gesture and horizontal/disabled swipes do not become taps", () => {
  const { cb, g } = fixture(); g.start(20, 50, 100, 100); g.move(20, 20); g.end(); vi.advanceTimersByTime(500);
  expect(cb.onSwipe).toHaveBeenCalledWith("brightness", .5); expect(cb.onHold).not.toHaveBeenCalled(); expect(cb.onTap).not.toHaveBeenCalled();
  g.start(80, 50, 100, 100); g.move(30, 50); g.end(); vi.advanceTimersByTime(500); expect(cb.onTap).not.toHaveBeenCalled();
});
it("disabled gestures leave only the single-tap controls action",()=>{
  const {cb,g,tap}=fixture({doubleTap:false,hold:false,swipeBrightness:false,swipeVolume:false});
  tap();expect(cb.onTap).toHaveBeenCalledTimes(1);
  g.start(20,50,100,100);vi.advanceTimersByTime(600);g.move(20,0);g.end();
  expect(cb.onHold).not.toHaveBeenCalled();expect(cb.onSwipe).not.toHaveBeenCalled();expect(cb.onSeek).not.toHaveBeenCalled();
  expect(cb.onTap).toHaveBeenCalledTimes(1);
});

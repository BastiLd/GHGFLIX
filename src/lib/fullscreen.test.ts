import { expect, it, vi } from "vitest";
import { createFullscreenController } from "./fullscreen";
it("exits on return even when UI missed fullscreen, then enters on first click", async () => {
  const win = { isFullscreen: vi.fn(async () => true), setFullscreen: vi.fn(async (_on: boolean) => {}) };
  const c = createFullscreenController(win);
  await c.exit();
  await c.toggle();
  expect(win.setFullscreen.mock.calls.map(([on]) => on)).toEqual([false, true]);
});
it("serializes leave behind a pending enter", async () => {
  let release!: () => void;
  const calls: boolean[] = [];
  const c = createFullscreenController({ isFullscreen: async () => false, setFullscreen: async (on) => {
    calls.push(on); if (on) await new Promise<void>(resolve => { release = resolve; });
  }});
  const enter = c.toggle(); await Promise.resolve(); await Promise.resolve();
  const leave = c.exit(); release(); await enter; await leave;
  expect(calls).toEqual([true, false]);
});
it("rejects stale state reads after a newer explicit exit", async () => {
  let resolve!: (on: boolean) => void;
  const set = vi.fn(async (_on: boolean) => {});
  const c = createFullscreenController({ isFullscreen: () => new Promise(r => { resolve = r; }), setFullscreen: set });
  const read = c.sync(); await c.exit(); resolve(true); await read; await c.toggle();
  expect(set.mock.calls.map(([on])=>on)).toEqual([false,true]);
});
it("tracks external Escape and does not publish failed changes", async () => {
  let external = true;
  const set = vi.fn(async (_on: boolean) => {});
  const c = createFullscreenController({ isFullscreen: async () => external, setFullscreen: set });
  const state = vi.fn(); c.subscribe(state);
  await c.sync(); expect(state).toHaveBeenLastCalledWith(true);
  external = false; await c.sync(); expect(state).toHaveBeenLastCalledWith(false);
  set.mockRejectedValueOnce(new Error("denied"));
  await expect(c.toggle()).rejects.toThrow("denied");
  expect(state).toHaveBeenLastCalledWith(false);
  await c.toggle(); expect(state).toHaveBeenLastCalledWith(true);
});

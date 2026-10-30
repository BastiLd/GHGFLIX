import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useKanalmeldungen } from "../src/kanalmeldungen.js";
import { appState } from "./native-dom.jsx";
afterEach(() => { cleanup(); vi.useRealTimers(); appState("active"); });

it("polls only while foregrounded and removes the timer on leaving the app", async () => {
  vi.useFakeTimers();
  const api = vi.fn().mockResolvedValue({ result: 3 });
  const { result, unmount } = renderHook(() => useKanalmeldungen(api, true, 0));
  await act(async () => {});
  expect(result.current).toBe(3); expect(api).toHaveBeenCalledTimes(1);
  act(() => appState("background"));
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(api).toHaveBeenCalledTimes(1);
  await act(async () => appState("active"));
  expect(api).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(api).toHaveBeenCalledTimes(2);
});

it("discards responses from the previous server and shows unknown on connection failure", async () => {
  let finish;
  const old = vi.fn(() => new Promise((r) => { finish = r; }));
  const next = vi.fn().mockResolvedValue({ result: 2 });
  const { result, rerender } = renderHook(({ api, revision }) => useKanalmeldungen(api, true, revision), { initialProps: { api: old, revision: 0 } });
  rerender({ api: next, revision: 0 });
  await act(async () => {}); expect(result.current).toBe(2);
  await act(async () => finish({ result: 99 })); expect(result.current).toBe(2);
  next.mockRejectedValueOnce(new Error("offline"));
  rerender({ api: next, revision: 1 });
  await act(async () => {}); expect(result.current).toBeNull();
});

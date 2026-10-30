import React from "react";
import Module from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FokusProvider, useFokusSystem } from "../src/fokus.js";
import { PlayerKnopfleiste } from "../src/playerleiste.js";
import { remoteKey } from "./native-dom.jsx";

let kern;
const originalLoad = Module._load;
function Capture() { kern = useFokusSystem().kern; return null; }
afterEach(() => { cleanup(); vi.useRealTimers(); Module._load = originalLoad; });

it("maps narrow toolbar rows to remote coordinates and updates after resizing", () => {
  const actions = Array.from({ length: 9 }, (_, i) => ({ id: String(i), label: `Action ${i}`, text: `${i}`, onPress: vi.fn() }));
  const draw = (breite) => <FokusProvider><Capture /><PlayerKnopfleiste breite={breite} knoepfe={actions} /></FokusProvider>;
  const ui = render(draw(420)); // TV mock: three 128px buttons + gaps
  expect(screen.getAllByRole("button")).toHaveLength(9);
  act(() => kern.setzen("player:knopf:1"));
  act(() => remoteKey("down"));
  expect(kern.aktiv).toBe("player:knopf:4");
  act(() => remoteKey("down"));
  act(() => remoteKey("select"));
  expect(actions[7].onPress).toHaveBeenCalledTimes(1);
  ui.rerender(draw(1400));
  expect(kern._alle().filter((e) => e.zeile === 1)).toHaveLength(9);
  expect(kern._alle().some((e) => e.zeile > 1)).toBe(false);
});

it("touch restores auto-hidden controls without pausing or reloading the player", async () => {
  vi.useFakeTimers();
  const video = { playing: true, replace: vi.fn(), play: vi.fn(), pause: vi.fn(), addListener: () => ({ remove() {} }) };
  Module._load = function (name, ...args) {
    if (name === "expo-video") return { VideoView: () => <div>Video</div>, useVideoPlayer: () => video };
    if (name === "expo-keep-awake") return { useKeepAwake() {} };
    return originalLoad.call(this, name, ...args);
  };
  const { PlayerScreen } = await import("../src/player.js");
  const api = vi.fn(async (url) => url === "/api/progress" ? [] : { duration: 90, direct: true, directUrl: "/video.mp4", transcodeUrl: "/transcode", spuren: {} });
  await act(async () => render(<FokusProvider><PlayerScreen api={api} base="http://fixture" type="movie" id={1} title="Testfilm" pop={vi.fn()} push={vi.fn()} /></FokusProvider>));
  expect(screen.getByRole("button", { name: "Pausieren" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(6000));
  expect(screen.queryByRole("button", { name: "Pausieren" })).toBeNull();
  const loads = video.replace.mock.calls.length;
  const pauses = video.pause.mock.calls.length;
  fireEvent.click(screen.getByTestId("player-wecken"));
  expect(screen.getByRole("button", { name: "Pausieren" })).toBeTruthy();
  expect(video.pause).toHaveBeenCalledTimes(pauses);
  expect(video.replace).toHaveBeenCalledTimes(loads);
  fireEvent.click(screen.getByRole("button", { name: "Pausieren" }));
  expect(video.pause).toHaveBeenCalledTimes(pauses + 1);
});

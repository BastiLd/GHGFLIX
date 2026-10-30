import React, { useRef, useState } from "react";
import Module from "node:module";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FokusProvider } from "../src/fokus.js";
import { folgenNach } from "../src/folgen.js";

const originalLoad = Module._load;
let players = [], api, PlayerScreen;
function makePlayer() {
  const listeners = new Map();
  let position = 0;
  const p = {
    playing: false, status: "idle", duration: 90, source: null, loaded: false,
    addListener(name, fn) { const set = listeners.get(name) ?? new Set(); set.add(fn); listeners.set(name, set); return { remove: () => set.delete(fn) }; },
    emit(name, data) { for (const fn of [...(listeners.get(name) ?? [])]) fn(data); },
    replace: vi.fn((source) => { p.source = source; p.loaded = false; p.status = "loading"; p.emit("statusChange", { status: "loading" }); }),
    play: vi.fn(() => { p.playing = true; p.emit("playingChange", { isPlaying: true }); }),
    pause: vi.fn(() => { p.playing = false; p.emit("playingChange", { isPlaying: false }); }),
    ready() { p.loaded = true; p.status = "readyToPlay"; p.emit("sourceLoad", { videoSource: p.source, duration: 90 }); p.emit("statusChange", { status: "readyToPlay" }); },
    time(t) { position = t; p.emit("timeUpdate", { currentTime: t }); },
    get currentTime() { return position; },
    set currentTime(t) { if (p.loaded) position = t; },
  };
  players.push(p); return p;
}
Module._load = function (name, ...args) {
  if (name === "expo-video") return {
    VideoView: () => <div>Video</div>,
    useVideoPlayer: () => { const ref = useRef(null); if (!ref.current) ref.current = makePlayer(); return ref.current; },
  };
  if (name === "expo-keep-awake") return { useKeepAwake() {} };
  return originalLoad.call(this, name, ...args);
};
({ PlayerScreen } = await import("../src/player.js"));
Module._load = originalLoad;

const info = (id = 1, direct = true) => ({ duration: 90, direct, directUrl: `/video/${id}.mp4`, transcodeUrl: `/transcode/${id}`, spuren: {} });
beforeEach(() => {
  players = []; vi.useFakeTimers();
  api = vi.fn(async (url, options) => options?.method === "POST" ? {} : url === "/api/progress" ? [] : info(Number(url.split("/").at(-1))));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
const props = { base: "http://fixture", conn: { profile: 7 }, type: "episode", id: 1, title: "Serie", pop() {}, push() {} };
const draw = (extra = {}) => <FokusProvider><PlayerScreen {...props} api={api} {...extra} /></FokusProvider>;
const flush = (fn) => act(async () => { fn?.(); });

it("starts successive episodes with fresh players and never marks a manual skip watched", async () => {
  function Journey() {
    const [route, setRoute] = useState({ id: 1, nextEp: { id: 2, next: { id: 3 } } });
    return draw({ ...route, push: setRoute });
  }
  await flush(() => render(<Journey />));
  act(() => { players[0].ready(); players[0].time(12); });
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Nächste Folge" })));
  expect(players).toHaveLength(2);
  expect(players[1].replace.mock.calls[0][0]).toContain("/video/2.mp4");
  expect(api.mock.calls.filter(([url, opt]) => url === "/api/progress" && opt?.method === "POST").every(([, opt]) => opt.body.refId === 1 && !opt.body.watched)).toBe(true);
  act(() => players[1].ready());
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Nächste Folge" })));
  expect(players).toHaveLength(3);
  expect(players[2].replace.mock.calls[0][0]).toContain("/video/3.mp4");
});

it("discards late title metadata after navigating to another episode", async () => {
  let finish;
  api.mockImplementation(async (url) => url === "/api/progress" ? [] : url.endsWith("/1") ? new Promise((r) => { finish = r; }) : info(2));
  let ui; await flush(() => { ui = render(draw()); });
  await flush(() => ui.rerender(draw({ id: 2 })));
  await flush(() => finish(info(1)));
  expect(players.at(-1).replace.mock.calls.at(-1)[0]).toContain("/video/2.mp4");
});

it("keeps transcode seeking paused and ignores time events from the replaced stream", async () => {
  api.mockImplementation(async (url, opt) => opt ? {} : url === "/api/progress" ? [] : info(1, false));
  await flush(() => render(draw()));
  const p = players[0]; act(() => { p.ready(); p.time(20); });
  fireEvent.click(screen.getByRole("button", { name: "Pausieren" }));
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Vorspulen" })));
  act(() => p.time(21));
  expect(screen.getByText("0:50")).toBeTruthy();
  act(() => { p.ready(); p.time(0); });
  expect(p.playing).toBe(false);
  expect(screen.getByRole("button", { name: "Abspielen" })).toBeTruthy();
});

it("restores a direct resume only after metadata is ready, not after a fixed timer", async () => {
  api.mockImplementation(async (url, opt) => opt ? {} : url === "/api/progress" ? [{ mediaType: "episode", refId: 1, position: 50, duration: 90 }] : info());
  await flush(() => render(draw()));
  act(() => vi.advanceTimersByTime(1500));
  act(() => players[0].ready());
  expect(players[0].currentTime).toBe(50);
});

it("shows failed metadata loading and offers retry rather than an endless spinner", async () => {
  api.mockRejectedValue(new Error("Server nicht erreichbar"));
  await flush(() => render(draw()));
  expect(screen.getByText(/Server nicht erreichbar/)).toBeTruthy();
  api.mockImplementation(async (url) => url === "/api/progress" ? [] : info());
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" })));
  expect(players.at(-1).replace).toHaveBeenCalled();
});

it("treats a JSON error response as a load failure rather than a media source", async () => {
  api.mockResolvedValue({ error: "Testserver vorübergehend nicht erreichbar" });
  await flush(() => render(draw()));
  expect(screen.getByText("Testserver vorübergehend nicht erreichbar")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Erneut versuchen" })).toBeTruthy();
  expect(players[0].replace).not.toHaveBeenCalled();
});

it("preserves all subsequent episodes across seasons and handles the end/unknown id", () => {
  const episodes = [{ id: 1, season: 1, episode: 9 }, { id: 2, season: 1, episode: 10 }, { id: 3, season: 2, episode: 1 }];
  const chain = folgenNach(episodes, 1);
  expect(chain.id).toBe(2); expect(chain.next.id).toBe(3);
  expect(chain.next.se).toBe("S02E01"); expect(chain.next.next).toBeNull();
  expect(folgenNach(episodes, 3)).toBeNull(); expect(folgenNach(episodes, -1)).toBeNull();
});

it("serializes async source replacement, skips superseded seeks, and preserves pause during loading", async () => {
  api.mockImplementation(async (url, opt) => opt ? {} : url === "/api/progress" ? [] : info(1, false));
  await flush(() => render(draw()));
  const p = players[0]; act(() => { p.ready(); p.time(10); });
  let finish;
  p.replaceAsync = vi.fn((source) => { p.replace(source); return new Promise((r) => { finish = r; }); });
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Vorspulen" })));
  const oldSource = p.source;
  fireEvent.click(screen.getByRole("button", { name: "Vorspulen" }));
  fireEvent.click(screen.getByRole("button", { name: "Zurückspulen" }));
  fireEvent.click(screen.getByRole("button", { name: "Pausieren" }));
  act(() => { p.emit("sourceLoad", { videoSource: oldSource, duration: 90 }); p.time(21); });
  expect(screen.getByText("1:00")).toBeTruthy();
  expect(p.replaceAsync).toHaveBeenCalledTimes(1);
  await flush(() => finish());
  expect(p.replaceAsync).toHaveBeenCalledTimes(2);
  expect(p.source).toContain("t=60");
  act(() => p.ready()); await flush(() => finish());
  expect(p.playing).toBe(false);
  expect(screen.getByRole("button", { name: "Abspielen" })).toBeTruthy();
});

it("uses the selected profile and saves only confirmed finite progress", async () => {
  await flush(() => render(draw()));
  const p = players[0]; expect(p.source).toContain("profile=7");
  act(() => { p.time(400); vi.advanceTimersByTime(10000); });
  expect(api.mock.calls.filter(([, opt]) => opt?.method === "POST")).toHaveLength(0);
  act(() => { p.ready(); p.time(12); p.time(Infinity); vi.advanceTimersByTime(10000); });
  const saved = api.mock.calls.filter(([, opt]) => opt?.method === "POST");
  expect(saved.at(-1)[1].body).toMatchObject({ position: 12, duration: 90, watched: false });
});

it("ignores a queued time event after direct seeking by reading the current player", async () => {
  await flush(() => render(draw()));
  const p = players[0]; act(() => { p.ready(); p.time(10); });
  fireEvent.click(screen.getByRole("button", { name: "Vorspulen" }));
  act(() => p.emit("timeUpdate", { currentTime: 11 }));
  expect(screen.getByText("0:40")).toBeTruthy();
});

it("loads the remaining series for continue/history playback and retries a failed list", async () => {
  let fail = true;
  api.mockImplementation(async (url) => {
    if (url === "/api/shows/9") {
      if (fail) throw new Error("temporarily offline");
      return { seasons: [{ episodes: [{ id: 1, season: 1, episode: 1 }, { id: 2, season: 1, episode: 2 }, { id: 3, season: 2, episode: 1 }] }] };
    }
    return url === "/api/progress" ? [] : info();
  });
  const push = vi.fn();
  await flush(() => render(draw({ showId: 9, push })));
  expect(screen.getByText("Folgenliste konnte nicht geladen werden.")).toBeTruthy();
  fail = false;
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Folgenliste erneut laden" })));
  await flush(() => fireEvent.click(screen.getByRole("button", { name: "Nächste Folge" })));
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ id: 2, showId: 9, nextEp: expect.objectContaining({ id: 3 }) }));
});

it("timed out streams cannot revive from late events and retry gets a fresh player", async () => {
  await flush(() => render(draw()));
  const old = players[0];
  await flush(() => vi.advanceTimersByTime(45001));
  expect(screen.getByRole("alert").textContent).toContain("45 Sekunden");
  const calls = old.play.mock.calls.length;
  act(() => { old.ready(); old.time(50); old.emit("statusChange", {status:"error"}); });
  expect(old.play).toHaveBeenCalledTimes(calls);
  expect(screen.getByRole("alert").textContent).toContain("45 Sekunden");
  await flush(() => fireEvent.click(screen.getByRole("button", {name:"Erneut versuchen"})));
  expect(players).toHaveLength(2);
  act(() => players[1].ready());
  expect(screen.queryByRole("alert")).toBeNull();
});

import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ observe: vi.fn(), get: vi.fn(), un: vi.fn() }));
vi.mock("./platform", () => ({ IS_TAURI: true, withToken: (s: string) => s }));
vi.mock("./backend", () => ({ invoke: vi.fn() }));
vi.mock("tauri-plugin-mpv-api", () => ({ observeProperties: mocks.observe, getProperty: mocks.get }));
import { observeProperties } from "./mpv";
it("hydrates unchanged duration when reattaching to a running native player", async () => {
  mocks.observe.mockResolvedValue(mocks.un);
  mocks.get.mockImplementation(async (name) => name === "duration" ? 7200 : 345);
  const cb = vi.fn();
  const un = await observeProperties(["duration", "time-pos", "eof-reached"], cb);
  expect(cb).toHaveBeenCalledWith({ name: "duration", data: 7200 });
  expect(cb).toHaveBeenCalledWith({ name: "time-pos", data: 345 });
  expect(mocks.get).not.toHaveBeenCalledWith("eof-reached");
  un(); expect(mocks.un).toHaveBeenCalled();
});
it("does not overwrite a fresh event with an older pending snapshot", async () => {
  let event: (e: any) => void;
  mocks.observe.mockImplementation(async (_p, cb) => { event = cb; return mocks.un; });
  mocks.get.mockImplementation(async () => { event({ name: "duration", data: 800 }); return 100; });
  const cb = vi.fn();
  await observeProperties(["duration"], cb);
  expect(cb).toHaveBeenCalledExactlyOnceWith({ name: "duration", data: 800 });
});

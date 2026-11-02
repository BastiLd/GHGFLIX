// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
vi.mock("./mpv", () => ({ setProperty: vi.fn() }));
vi.mock("./api", () => ({ listShowEpisodes: vi.fn(), listProgress: vi.fn() }));
import { playback } from "./playback";
it("plays a selected queue entry without discarding unrelated entries", () => {
  playback().clearQueue();
  playback().enqueue({kind:"movie", mediaType:"movie", label:"Film", ids:[1]});
  playback().enqueue({kind:"season", mediaType:"episode", label:"Staffel", ids:[5,6]});
  const key = playback().queue[1].key;
  expect(playback().takeQueued(key)).toEqual({mediaType:"episode", id:5});
  expect(playback().queue.map(q=>q.ids)).toEqual([[1],[6]]);
  expect(playback().takeQueued(key)).toEqual({mediaType:"episode", id:6});
  expect(playback().queue.map(q=>q.ids)).toEqual([[1]]);
  expect(playback().takeQueued(key)).toBeNull();
});
it("keeps previous/next history within a profile and truncates abandoned forward history",()=>{
  const p=playback();
  p.rememberPlayed("a","movie",1);p.rememberPlayed("a","movie",2);p.rememberPlayed("a","episode",3);
  p.rememberPlayed("a","movie",2);expect(playback().history.cursor).toBe(1);
  p.rememberPlayed("a","movie",4);expect(playback().history.items.map(x=>x.id)).toEqual([1,2,4]);
  p.rememberPlayed("b","movie",8);expect(playback().history.items).toEqual([{mediaType:"movie",id:8}]);
  expect(playback().history.cursor).toBe(0);
});

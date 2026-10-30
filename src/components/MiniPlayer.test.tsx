// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {MemoryRouter} from "react-router-dom";
const mocks=vi.hoisted(()=>({getMovie:vi.fn(),command:vi.fn(),toast:vi.fn()}));
vi.mock("../lib/mpv",()=>({command:mocks.command,destroy:vi.fn().mockResolvedValue(undefined),observeProperties:vi.fn().mockResolvedValue(()=>{}),setProperty:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../lib/api",()=>({getMovie:mocks.getMovie,getEpisode:vi.fn(),setProgress:vi.fn().mockResolvedValue(undefined)}));
vi.mock("../lib/store",()=>({useStore:(f:any)=>f({profileId:"local",toast:mocks.toast})}));
vi.mock("../lib/uiPrefs",()=>({uiPrefs:()=>({watchedThreshold:95}),useUiPrefs:(f:any)=>f({miniSize:"md"})}));
import {playback} from "../lib/playback";
import {MiniPlayer} from "./MiniPlayer";
beforeEach(()=>{
  mocks.getMovie.mockReset();mocks.command.mockReset();mocks.command.mockResolvedValue(undefined);mocks.toast.mockReset();
  playback().clearQueue();playback().setMini({mediaType:"movie",mediaId:1,title:"Current",path:"one"});
  playback().enqueue({kind:"movie",mediaType:"movie",label:"Next",ids:[2]});
});
afterEach(()=>{cleanup();playback().setMini(null);playback().clearQueue();});
const mount=()=>render(<MemoryRouter><MiniPlayer/></MemoryRouter>);
it("failed queue lookup keeps the entry and the current mini session",async()=>{
  mocks.getMovie.mockRejectedValue(new Error("Offline"));mount();
  fireEvent.click(screen.getByTitle("Nächstes aus der Warteschlange"));
  await waitFor(()=>expect(mocks.toast).toHaveBeenCalled());
  expect(playback().queue[0]?.ids).toEqual([2]);
  expect(playback().mini?.mediaId).toBe(1);
});
it("closing during queue lookup prevents late playback and preserves the queue",async()=>{
  let resolve!:(v:unknown)=>void;
  mocks.getMovie.mockImplementation(()=>new Promise(r=>resolve=r));mount();
  fireEvent.click(screen.getByTitle("Nächstes aus der Warteschlange"));
  fireEvent.click(screen.getByTitle("Schließen"));
  resolve({id:2,title:"Next",path:"two"});
  await new Promise(r=>setTimeout(r,0));
  expect(mocks.command).not.toHaveBeenCalled();
  expect(playback().mini).toBeNull();
  expect(playback().queue[0]?.ids).toEqual([2]);
});
it("successful queue switch consumes one episode only after loading",async()=>{
  let loaded!:()=>void;
  mocks.getMovie.mockResolvedValue({id:2,title:"Next",path:"two"});
  mocks.command.mockImplementation(()=>new Promise<void>(r=>loaded=r));mount();
  fireEvent.click(screen.getByTitle("Nächstes aus der Warteschlange"));
  await waitFor(()=>expect(mocks.command).toHaveBeenCalled());
  expect(playback().queue[0]?.ids).toEqual([2]);
  loaded();await waitFor(()=>expect(playback().mini?.mediaId).toBe(2));
  expect(playback().queue).toHaveLength(0);
});

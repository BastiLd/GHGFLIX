// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock("./platform",()=>({IS_TAURI:false,withToken:(s:string)=>s}));
vi.mock("./backend",()=>({invoke:mocks.invoke}));
vi.mock("tauri-plugin-mpv-api",()=>({}));
import {command,destroy,init,getProperty,observeProperties,cancelPendingLoad} from "./mpv";
const info=(id:number,direct=true)=>({id,mediaType:"episode",duration:id*100,direct,directUrl:`/video${id}`,transcodeUrl:`/transcode?id=${id}`,audioStreams:[],subtitleStreams:[],chapters:[]});
beforeEach(()=>{
  mocks.invoke.mockReset();
  vi.spyOn(HTMLMediaElement.prototype,"play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype,"pause").mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,"load").mockImplementation(()=>{});
});
afterEach(async()=>{await destroy();vi.restoreAllMocks();});
it("latest requested media wins when probe responses arrive backwards",async()=>{
  const pending=new Map<string,(v:unknown)=>void>();
  mocks.invoke.mockImplementation((_cmd,{path})=>new Promise(r=>pending.set(path,r)));
  const old=command("loadfile",["old"]);const next=command("loadfile",["new"]);
  pending.get("new")!(info(2));await next;
  pending.get("old")!(info(1));await old;
  expect(document.querySelector("video")?.getAttribute("src")).toBe("/video2");
  expect(await getProperty("duration")).toBe(200);
});
it("closing during a probe cannot resurrect playback",async()=>{
  let resolve!:(v:unknown)=>void;
  mocks.invoke.mockImplementation(()=>new Promise(r=>resolve=r));
  const loading=command("loadfile",["old"]);await destroy();resolve(info(1));await loading;
  expect(document.querySelector("video")).toBeNull();
});
it("explicitly starting another title plays even if previous title was paused",async()=>{
  mocks.invoke.mockResolvedValue(info(1));await init();
  const v=document.querySelector("video")!;v.currentTime=40;
  await command("loadfile",["new"]);
  expect(v.play).toHaveBeenCalled();
});
it("seeking a paused transcode at zero never briefly starts playback",async()=>{
  mocks.invoke.mockResolvedValue(info(1,false));await command("loadfile",["one"]);
  const v=document.querySelector("video")!;vi.mocked(v.play).mockClear();
  v.currentTime=0;await command("seek",[20,"absolute"]);
  expect(v.play).not.toHaveBeenCalled();
});

it("late completion of an earlier transcode seek cannot publish an obsolete position",async()=>{
  mocks.invoke.mockResolvedValue(info(1,false));await command("loadfile",["one"]);
  const v=document.querySelector("video")!;
  Object.defineProperty(v,"paused",{configurable:true,value:false});
  let finish! :()=>void;
  vi.mocked(v.play).mockImplementationOnce(()=>new Promise<void>(r=>finish=r));
  const events:number[]=[];
  const un=await observeProperties(["time-pos"],e=>events.push(Number(e.data)));
  const old=command("seek",[20,"absolute"]);
  await command("seek",[40,"absolute"]);
  finish();await old;
  expect(events[events.length - 1]).toBe(40);
  un();
});

it("canceling a pending probe preserves the currently playing source",async()=>{
  mocks.invoke.mockResolvedValue(info(1));await command("loadfile",["current"]);
  let resolve!:(v:unknown)=>void;
  mocks.invoke.mockImplementation(()=>new Promise(r=>resolve=r));
  const loading=command("loadfile",["next"]);
  cancelPendingLoad();resolve(info(2));await loading;
  expect(document.querySelector("video")?.getAttribute("src")).toBe("/video1");
});
it("publishes the real pause state after a seek replaces the source",async()=>{
  mocks.invoke.mockResolvedValue(info(1,false));await command("loadfile",["one"]);
  const events:boolean[]=[];
  const un=await observeProperties(["pause"],e=>{if(e.name==="pause") events.push(Boolean(e.data));});
  events.length=0;
  await command("seek",[20,"absolute"]);
  expect(events[events.length-1]).toBe(true);
  un();
});

it("playback and quality changes work when browser storage is blocked", async()=>{
  vi.stubGlobal("localStorage", { getItem(){ throw new DOMException("Blocked", "SecurityError"); }, setItem(){ throw new DOMException("Blocked", "SecurityError"); } });
  try {
    mocks.invoke.mockResolvedValue({...info(1), height:2160});
    await command("loadfile",["blocked-storage"]);
    const {setProperty, webStreamQuality}=await import("./mpv");
    await setProperty("ghg-quality","low");
    expect(webStreamQuality()).toBe("low");
    expect(document.querySelector("video")?.src).toContain("q=low");
    await setProperty("ghg-quality","original");
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/video1");
    await setProperty("ghg-quality","high");
  } finally { vi.unstubAllGlobals(); }
});

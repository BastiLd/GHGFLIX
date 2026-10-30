// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const mock = vi.hoisted(() => ({invoke:vi.fn()}));
vi.mock("../lib/backend", () => ({invoke:mock.invoke}));
vi.mock("../lib/platform", () => ({IS_WEB:true}));
import { PushSettings } from "./PushSettings";
const key = new Uint8Array([1,2,3]);
let subscription: any;
const subscribe = vi.fn();
const getSubscription = vi.fn();
const registration = {pushManager:{getSubscription,subscribe}};
beforeEach(() => {
  mock.invoke.mockReset();subscribe.mockReset();getSubscription.mockReset();
  subscription = {endpoint:"https://fcm.googleapis.com/old",options:{applicationServerKey:key.buffer},unsubscribe:vi.fn().mockResolvedValue(true),toJSON:()=>({endpoint:"https://fcm.googleapis.com/old"})};
  getSubscription.mockImplementation(async()=>subscription);
  vi.stubGlobal("isSecureContext",true);
  vi.stubGlobal("PushManager",class {});
  vi.stubGlobal("Notification",{permission:"granted",requestPermission:vi.fn().mockResolvedValue("granted")});
  Object.defineProperty(navigator,"serviceWorker",{configurable:true,value:{getRegistration:vi.fn().mockResolvedValue(registration),register:vi.fn().mockResolvedValue(registration),ready:Promise.resolve(registration)}});
  mock.invoke.mockImplementation(async(cmd:string)=> cmd==="push_status" ? {configured:true,publicKey:"AQID",registered:false} : true);
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it("does not report enabled when only the browser still knows the subscription",async()=>{
  render(<PushSettings/>);
  await waitFor(()=>expect(mock.invoke).toHaveBeenCalledWith("push_status",{endpoint:subscription.endpoint}));
  expect(screen.getByRole("button",{name:"Geräte-Push einschalten"})).toBeDefined();
});
it("replaces a browser subscription when the server key has changed",async()=>{
  subscription.options.applicationServerKey = new Uint8Array([9]).buffer;
  const old = subscription;
  const next = {...subscription,endpoint:"https://fcm.googleapis.com/new",options:{applicationServerKey:key.buffer},toJSON:()=>({endpoint:"https://fcm.googleapis.com/new"})};
  old.unsubscribe.mockImplementation(async()=>{subscription=null;return true;});
  subscribe.mockImplementation(async()=>{subscription=next;return next;});
  render(<PushSettings/>);
  const button=await screen.findByRole("button",{name:"Geräte-Push einschalten"});
  fireEvent.click(button);
  await waitFor(()=>expect(subscribe).toHaveBeenCalled());
  expect(old.unsubscribe).toHaveBeenCalled();
  expect(mock.invoke).toHaveBeenCalledWith("push_subscribe",{subscription:{endpoint:next.endpoint}});
});
it("shows unknown status and a retry after server failure",async()=>{
  mock.invoke.mockRejectedValue(new Error("Offline"));render(<PushSettings/>);
  await screen.findByRole("button",{name:"Status erneut prüfen"});
  expect(screen.queryByRole("button",{name:"Geräte-Push ausschalten"})).toBeNull();
});
it("does not request permission or subscribe just by opening settings",async()=>{
  subscription=null;render(<PushSettings/>);
  await screen.findByRole("button",{name:"Geräte-Push einschalten"});
  expect(Notification.requestPermission).not.toHaveBeenCalled();
  expect(subscribe).not.toHaveBeenCalled();
});
it("keeps the active registration when server-side opt-out fails",async()=>{
  mock.invoke.mockImplementation(async(cmd:string)=>{
    if(cmd==="push_status") return {configured:true,publicKey:"AQID",registered:true};
    throw new Error("Offline");
  });
  render(<PushSettings/>);
  fireEvent.click(await screen.findByRole("button",{name:"Geräte-Push ausschalten"}));
  await screen.findByRole("status");
  expect(subscription.unsubscribe).not.toHaveBeenCalled();
  expect(screen.getByRole("button",{name:"Geräte-Push ausschalten"})).toBeDefined();
});
it("does not claim failed browser cleanup re-enabled server delivery",async()=>{
  subscription.unsubscribe.mockResolvedValue(false);
  mock.invoke.mockImplementation(async(cmd:string)=> cmd==="push_status" ? {configured:true,publicKey:"AQID",registered:true} : true);
  render(<PushSettings/>);
  fireEvent.click(await screen.findByRole("button",{name:"Geräte-Push ausschalten"}));
  await screen.findByRole("button",{name:"Geräte-Push einschalten"});
  expect(screen.getByRole("status").textContent).toContain("am Server ausgeschaltet");
});
it("cleans up a newly created subscription when registration fails",async()=>{
  const created=subscription;subscription=null;subscribe.mockResolvedValue(created);
  mock.invoke.mockImplementation(async(cmd:string)=>{
    if(cmd==="push_status") return {configured:true,publicKey:"AQID",registered:false};
    throw new Error("Offline");
  });
  render(<PushSettings/>);
  fireEvent.click(await screen.findByRole("button",{name:"Geräte-Push einschalten"}));
  await waitFor(()=>expect(created.unsubscribe).toHaveBeenCalled());
  expect(screen.queryByRole("button",{name:"Geräte-Push ausschalten"})).toBeNull();
});

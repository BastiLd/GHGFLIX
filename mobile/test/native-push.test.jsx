import { beforeEach, expect, it, vi } from "vitest";
import { nativePushClient, notificationBelongsHere } from "../src/native-push-core.js";

const projectId="b14ed30d-3ecc-4465-ac79-7988b90ab0d8", token="ExpoPushToken[abcdefghijklm]", old="ExpoPushToken[oldabcdefghijk]";
let n, storage, call, client, records, registered;
beforeEach(() => {
  records=new Map(); registered=new Set();
  storage={getItem:vi.fn(async k=>records.get(k)||null),setItem:vi.fn(async(k,v)=>{records.set(k,v);}),removeItem:vi.fn(async k=>{records.delete(k);})};
  n={getPermissionsAsync:vi.fn(async()=>({granted:true})),requestPermissionsAsync:vi.fn(async()=>({granted:true})),
    setNotificationChannelAsync:vi.fn(async()=>{}),getNotificationChannelAsync:vi.fn(async()=>({importance:3})),
    getExpoPushTokenAsync:vi.fn(async()=>({data:token})),AndroidImportance:{DEFAULT:3}};
  call=vi.fn(async(cmd,args)=>{
    if(cmd==="native_push_status") return {configured:true,projectId,registered:args.tokens.some(t=>registered.has(t))};
    if(cmd==="native_push_subscribe") { for(const t of args.previousTokens) registered.delete(t);registered.add(args.token); }
    if(cmd==="native_push_unsubscribe") for(const t of args.tokens) registered.delete(t);
    return true;
  });
  client=nativePushClient({notifications:n,storage,platform:{OS:"android"},projectId,serverId:"local",call});
});
it("never requests permission or a device token while checking status",async()=>{
  expect(await client.status()).toMatchObject({enabled:false,configured:true});
  expect(n.requestPermissionsAsync).not.toHaveBeenCalled();expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
it("checks server configuration before asking the OS for permission",async()=>{
  call.mockResolvedValue({configured:false});
  await expect(client.enable()).rejects.toThrow(/nicht eingerichtet/);
  expect(n.requestPermissionsAsync).not.toHaveBeenCalled();expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
it("preserves a blocked permission and never registers a device",async()=>{
  n.getPermissionsAsync.mockResolvedValue({granted:false});n.requestPermissionsAsync.mockResolvedValue({granted:false});
  await expect(client.enable()).rejects.toThrow(/Geräteeinstellungen/);
  expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled();expect(registered.size).toBe(0);
});
it("shows an individually blocked Android channel even when OS permission is granted",async()=>{
  n.getNotificationChannelAsync.mockResolvedValue({importance:0});
  await expect(client.enable()).rejects.toThrow(/Kanal/);expect(n.getExpoPushTokenAsync).not.toHaveBeenCalled();
});
it("renews a token and removes its previous registration",async()=>{
  records.set("ghgflix.push.local",JSON.stringify([old]));registered.add(old);
  await client.enable();expect([...registered]).toEqual([token]);
  expect(JSON.parse(records.get("ghgflix.push.local"))).toEqual([token]);
  await client.disable();expect(registered.size).toBe(0);expect(records.size).toBe(0);
});
it("keeps recovery information when a registration response is lost",async()=>{
  records.set("ghgflix.push.local",JSON.stringify([old]));registered.add(old);
  const original=call.getMockImplementation();
  call.mockImplementation(async(cmd,args)=>{const r=await original(cmd,args);if(cmd==="native_push_subscribe")throw new Error("Antwort verloren");return r;});
  await expect(client.enable()).rejects.toThrow(/verloren/);
  expect(await client.status()).toMatchObject({enabled:true});
  expect(JSON.parse(records.get("ghgflix.push.local"))).toEqual([token,old]);
  await client.disable();expect(registered.size).toBe(0);
});
it("does not discard the local token if server unsubscription fails",async()=>{
  await client.enable();call.mockRejectedValue(new Error("offline"));
  await expect(client.disable()).rejects.toThrow("offline");expect(records.size).toBe(1);
});
it("does not contact push services on TV or without native support",async()=>{
  for(const notifications of [null,n]) {
    const c=nativePushClient({notifications,storage,platform:{OS:"android",isTV:true},projectId,serverId:"local",call});
    expect(await c.status()).toEqual({supported:false,enabled:false});
  }
  expect(call).not.toHaveBeenCalled();
});
it("a notification can open only the channel view of its original server",()=>{
  const r={notification:{request:{content:{data:{screen:"channels",serverId:"one"}}}}};
  expect(notificationBelongsHere(r,"one")).toBe(true);expect(notificationBelongsHere(r,"two")).toBe(false);
  expect(notificationBelongsHere(r,null)).toBe(false);
});

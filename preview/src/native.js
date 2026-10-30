export * from "react-native-web";
import { Platform as WebPlatform } from "react-native-web";
const events = new Map();
export const DeviceEventEmitter = {
  addListener(name, fn) {
    if (!events.has(name)) events.set(name, new Set());
    events.get(name).add(fn);
    return { remove: () => events.get(name)?.delete(fn) };
  },
  emit(name, value) { events.get(name)?.forEach((fn) => fn(value)); },
};
export const Platform = { ...WebPlatform, OS: "web", isTV: globalThis.__GHG_DEVICE__ === "tv" };
const back = new Set();
export const BackHandler = {
  addEventListener(_name, fn) { back.add(fn); return { remove: () => back.delete(fn) }; },
  exitApp() {},
};
export function backPress() { for (const fn of [...back].reverse()) if (fn()) return true; return false; }
const keys = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "select", " ": "playPause" };
export function remoteKey(key, action = 1) {
  if (key === "Escape") return backPress();
  const eventType = keys[key];
  if (eventType) DeviceEventEmitter.emit("onHWKeyEvent", { eventType, eventKeyAction: action });
}
window.addEventListener("keydown", (event) => {
  if (/INPUT|TEXTAREA/.test(event.target.tagName) && event.target.dataset.focusAnchor !== "true") {
    if (event.key === "Escape" || event.key === "Enter") { event.target.blur(); event.preventDefault(); }
    return;
  }
  if (keys[event.key] || event.key === "Escape") { event.preventDefault(); remoteKey(event.key, 0); }
});
window.addEventListener("keyup", (event) => {
  if (/INPUT|TEXTAREA/.test(event.target.tagName) && event.target.dataset.focusAnchor !== "true") return;
  if (keys[event.key]) { event.preventDefault(); remoteKey(event.key, 1); }
});
window.addEventListener("message", (event) => {
  if (event.origin === location.origin && event.data?.ghgRemote) remoteKey(event.data.ghgRemote);
});

import { Platform } from "react-native";
// Loading is optional in web preview / old APKs. Availability is shown honestly.
let brightness = null, volume = null, androidBrightness = null;
if (Platform.OS !== "web") {
  try { brightness = require("expo-brightness"); } catch (e) { console.warn("GHGFlix brightness module unavailable:", e?.message); }
  try { volume = require("react-native-volume-manager").VolumeManager; } catch (e) { console.warn("GHGFlix system-volume module unavailable:", e?.message); }
  if (Platform.OS === "android") {
    try { androidBrightness = require("expo-modules-core").requireOptionalNativeModule("GHGFlixPlayerDevice"); } catch {}
  }
}
export const playerDevice = {
  brightnessAvailable: !!brightness?.setBrightnessAsync,
  systemVolumeAvailable: !!volume?.setVolume,
  async getBrightness() {
    try { return await (androidBrightness || brightness)?.getBrightnessAsync?.(); }
    catch(e) { console.warn("GHGFlix brightness read failed:", e?.message); throw e; }
  },
  async setBrightness(value) { return brightness?.setBrightnessAsync?.(value); },
  async restoreBrightness(original) {
    if (Platform.OS === "android") await brightness?.restoreSystemBrightnessAsync?.();
    else if (original != null) await brightness?.setBrightnessAsync?.(original);
  },
  async getVolume() { return (await volume?.getVolume?.())?.volume; },
  observeVolume(callback) { try { return volume?.addVolumeListener?.(v => callback(v.volume)) || { remove() {} }; } catch { return { remove() {} }; } },
  async setVolume(value) { return volume?.setVolume?.(value, { type: "music", showUI: false }); },
};

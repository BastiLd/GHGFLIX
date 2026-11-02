import { useEffect, useSyncExternalStore } from "react";
import { legacySubtitle, normalizeGestures, normalizeSubtitle, type SubtitleStyle, type GestureSettings } from "../../shared/player-settings.js";
import { uiPrefs, useUiPrefs } from "./uiPrefs";

const KEY = "ghgflix.player.preferences.v1";
type Preferences = { subtitle: SubtitleStyle; gestures: GestureSettings };
let state: Preferences | undefined;
let hasSubtitle = false;
const listeners = new Set<() => void>();
function read(): Preferences {
  if (state) return state;
  let saved: Partial<Preferences> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { /* blocked or corrupt storage */ }
  hasSubtitle = !!saved.subtitle;
  state = { subtitle: saved.subtitle ? normalizeSubtitle(saved.subtitle) : legacySubtitle({ subScale: uiPrefs().subScale }), gestures: normalizeGestures(saved.gestures) };
  return state;
}
function update(next: Preferences) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* settings remain usable for this session */ }
  for (const listener of listeners) listener();
}
export function setSubtitleStyle(patch: Partial<SubtitleStyle>) {
  hasSubtitle = true;
  const subtitle = normalizeSubtitle({ ...read().subtitle, ...patch });
  update({ ...read(), subtitle });
  if (patch.sizePercent != null) useUiPrefs.getState().setPref("subScale", subtitle.sizePercent / 100);
}
export function setGestureSettings(patch: Partial<GestureSettings>) {
  update({ ...read(), gestures: normalizeGestures({ ...read().gestures, ...patch }) });
}
export function usePlayerPreferences() {
  const scale = useUiPrefs(s => s.subScale), loaded = useUiPrefs(s => s.loaded);
  const preferences = useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, read);
  useEffect(() => { if(loaded && !hasSubtitle) { hasSubtitle=true; update({ ...read(), subtitle: legacySubtitle({subScale:scale}) }); } },[loaded,scale]);
  return preferences;
}

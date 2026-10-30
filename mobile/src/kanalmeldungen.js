import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { kanalAufruf } from "./kanaele-api.js";

/** In-app badge only. Pauses in the background and never requests OS permissions. */
export function useKanalmeldungen(api, enabled, revision) {
  const [unread, setUnread] = useState(null);
  useEffect(() => {
    setUnread(null);
    if (!enabled) return;
    let cancelled = false, inFlight = false;
    let active = !AppState.currentState || AppState.currentState === "active";
    const refresh = async () => {
      if (!active || cancelled || inFlight) return;
      inFlight = true;
      try {
        const value = await kanalAufruf(api, "feed_unread");
        if (!cancelled) setUnread(Number.isFinite(value) && value >= 0 ? value : null);
      } catch { if (!cancelled) setUnread(null); }
      finally { inFlight = false; }
    };
    void refresh();
    const timer = setInterval(refresh, 60000);
    const listener = AppState.addEventListener("change", (state) => {
      active = state === "active";
      if (active) void refresh();
    });
    return () => { cancelled = true; clearInterval(timer); listener.remove(); };
  }, [api, enabled, revision]);
  return unread;
}

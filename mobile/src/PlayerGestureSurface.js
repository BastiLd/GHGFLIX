import React, { useEffect, useRef } from "react";
import { AppState, View } from "react-native";
import { createPlayerGestures } from "../../shared/player-gestures.js";

export function PlayerGestureSurface({ callbacks, visible, width, height, enabled = true }) {
  const latest = useRef(callbacks); latest.current = callbacks;
  const origin = useRef(null);
  const engine = useRef(null);
  if (!engine.current) engine.current = createPlayerGestures({
    settings: () => latest.current.settings(), canHold: () => latest.current.canHold(),
    onTap: () => latest.current.onTap(), onSeek: s => latest.current.onSeek(s),
    onHold: v => latest.current.onHold(v), onSwipe: (kind, delta) => latest.current.onSwipe(kind, delta),
  });
  useEffect(() => {
    const sub = AppState.addEventListener("change", state => { if(state !== "active")engine.current.cancel(); });
    return () => { sub.remove();engine.current.cancel(); };
  }, []);
  useEffect(() => { if (!enabled) engine.current.cancel(); }, [enabled]);
  return <View testID="player-wecken" accessible accessibilityRole="button" accessibilityLabel={visible ? "Bedienelemente ausblenden" : "Bedienelemente anzeigen"}
    focusable={false} onAccessibilityTap={() => callbacks.onTap()}
    onStartShouldSetResponder={() => enabled}
    onResponderGrant={e => {
      if (e.nativeEvent.touches?.length > 1) { engine.current.cancel(); return; }
      origin.current = { x: e.nativeEvent.pageX-e.nativeEvent.locationX, y: e.nativeEvent.pageY-e.nativeEvent.locationY };
      engine.current.start(e.nativeEvent.locationX, e.nativeEvent.locationY, width, height);
    }}
    onResponderMove={e => {
      if (e.nativeEvent.touches?.length > 1) { engine.current.cancel(); return; }
      if (origin.current) engine.current.move(e.nativeEvent.pageX-origin.current.x, e.nativeEvent.pageY-origin.current.y);
    }}
    onResponderRelease={() => { engine.current.end(); origin.current = null; }}
    onResponderTerminate={() => { engine.current.cancel(); origin.current = null; }} onResponderTerminationRequest={() => true}
    style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, touchAction: "none" }}/>
}

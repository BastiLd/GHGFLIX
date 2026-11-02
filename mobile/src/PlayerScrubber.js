import React, { useRef, useState } from "react";
import { Image, Text, View } from "react-native";
import { fmtZeit } from "./bausteine.js";
import { st } from "./stile.js";

export function PlayerScrubber({ position, duration, onSeek, onDragging, onPreview, sprite, spriteUrl, focused }) {
  const [width, setWidth] = useState(0), [target, setTarget] = useState(null), [imageFailed, setImageFailed] = useState(false);
  const drag = useRef(null);
  const timeAt = e => {
    const x = e.nativeEvent.pageX - drag.current.left;
    return Math.max(0, Math.min(duration, x / Math.max(1, width) * duration));
  };
  const finish = (e, commit) => {
    if (!drag.current) return;
    const t = commit ? timeAt(e) : null;
    drag.current = null; setTarget(null); onDragging(false);
    if (commit) onSeek(t);
  };
  const shown = target ?? position, ratio = duration > 0 ? Math.max(0, Math.min(1, shown / duration)) : 0;
  const validSprite = spriteUrl && !imageFailed && [sprite?.interval, sprite?.tileWidth, sprite?.tileHeight, sprite?.cols, sprite?.rows, sprite?.count].every(v => Number.isFinite(v) && v > 0);
  const previewW = Math.min(160, Math.max(80, width)), scale = validSprite ? previewW / sprite.tileWidth : 1;
  const tile = validSprite ? Math.max(0, Math.min(sprite.count-1, Math.floor(shown / sprite.interval))) : 0;
  return <View style={{ flex: 1, minWidth: 45 }}>
    {target != null && <View pointerEvents="none" style={{ position: "absolute", bottom: 40, width: previewW, left: Math.max(0, Math.min(width-previewW, width*ratio-previewW/2)), padding: 4, borderRadius: 8, backgroundColor: "#17171f", alignItems: "center" }}>
      {validSprite && <View style={{ width: previewW, height: sprite.tileHeight*scale, overflow: "hidden" }}><Image source={{ uri: spriteUrl }} onError={() => setImageFailed(true)} style={{ position: "absolute", width: sprite.cols*previewW, height: sprite.rows*sprite.tileHeight*scale, left: -(tile%sprite.cols)*previewW, top: -Math.floor(tile/sprite.cols)*sprite.tileHeight*scale }}/></View>}
      <Text style={{ color: "white", fontWeight: "700", fontVariant: ["tabular-nums"], padding: 4 }}>{fmtZeit(shown)}</Text>
      {!validSprite && <Text style={{ color: "#bbb", fontSize: 10 }}>Keine Bildvorschau verfügbar</Text>}
    </View>}
    <View testID="player-zeitleiste" accessible focusable={false} accessibilityRole="adjustable" accessibilityLabel="Wiedergabeposition"
      accessibilityValue={{ min: 0, max: duration || 0, now: shown, text: fmtZeit(shown) }}
      accessibilityActions={[{ name: "increment", label: "10 Sekunden vor" }, { name: "decrement", label: "10 Sekunden zurück" }]}
      onAccessibilityAction={e => onSeek(Math.max(0, Math.min(duration, position + (e.nativeEvent.actionName === "increment" ? 10 : -10))))}
      onLayout={e => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => width > 0 && duration > 0}
      onResponderGrant={e => { drag.current = { left: e.nativeEvent.pageX - e.nativeEvent.locationX }; setImageFailed(false); setTarget(timeAt(e)); onDragging(true); onPreview?.(); }}
      onResponderMove={e => { if (drag.current) setTarget(timeAt(e)); }}
      onResponderRelease={e => finish(e, true)} onResponderTerminate={e => finish(e, false)} onResponderTerminationRequest={() => true}
      style={{ minHeight: 44, justifyContent: "center", touchAction: "none" }}>
      <View pointerEvents="none" style={[st.balkenSpur, { flex: 0, width: "100%" }]}>
        <View style={[st.balkenVoll, { width: `${ratio*100}%` }]}/>
        <View style={[st.balkenGriff, { left: `${ratio*100}%`, transform: [{ scale: focused || target != null ? 1.35 : 1 }] }]}/>
      </View>
    </View>
  </View>;
}

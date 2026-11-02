import React, { useEffect, useState } from "react";
import { Platform, Text, View } from "react-native";
import { FKnopf, FokusReihe } from "./fokus.js";
import { FFeld } from "./bausteine.js";
import { gross, st } from "./stile.js";
import { SUBTITLE_DEFAULTS, SUBTITLE_FIELDS, GESTURE_FIELDS, rgba } from "../../shared/player-settings.js";

export function SubtitleText({ text, value, baseSize = 18 }) {
  const s = value;
  const fontFamily = s.fontFamily === "mono" ? (Platform.OS === "ios" ? "Menlo" : "monospace") : s.fontFamily === "serif" ? (Platform.OS === "ios" ? "Georgia" : "serif") : undefined;
  const textStyle = { fontSize: baseSize * s.sizePercent / 100, lineHeight: baseSize * 1.4 * s.sizePercent / 100,
    fontFamily, fontWeight: s.bold ? "700" : "400", textAlign: "center", paddingHorizontal: 10, paddingVertical: 3 };
  const outline = s.edgeStyle === "outline" && s.edgeWidth > 0;
  return <View pointerEvents="none" style={{ maxWidth: "100%", backgroundColor: rgba(s.backgroundColor, s.backgroundOpacity), borderRadius: 3 }}>
    {outline && [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].map(([x,y]) => <Text key={`${x}:${y}`} accessible={false} style={[textStyle, { position: "absolute", left: x*s.edgeWidth, right: -x*s.edgeWidth, top: y*s.edgeWidth, color: s.edgeColor }]}>{text}</Text>)}
    <Text style={[textStyle, { color: rgba(s.textColor, s.textOpacity) }, s.edgeStyle === "shadow" && { textShadowColor: s.edgeColor, textShadowOffset: { width: 0, height: s.edgeWidth }, textShadowRadius: s.edgeWidth * 2 }]}>{text}</Text>
  </View>;
}
function ValueField({ field: f, value, onChange, row, area }) {
  const [draft, setDraft] = useState(String(value)), [error, setError] = useState("");
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    const valid = f.type === "color" ? /^#[0-9a-f]{6}$/i.test(draft) : draft.trim() !== "" && Number.isFinite(n) && n >= f.min && n <= f.max;
    if (valid) { onChange(f.type === "color" ? draft : n); setError(""); }
    else { setDraft(String(value)); setError(f.type === "color" ? "Bitte #RRGGBB eingeben." : `Bitte einen Wert von ${f.min} bis ${f.max} eingeben.`); }
  };
  return <FokusReihe zeile={row}>
    <View style={{ marginVertical: 7 }}>
      <Text style={[st.fliess, { marginBottom: 5 }]}>{f.label}</Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {f.type === "number" && <FKnopf bereich={area} spalte={0} accessibilityLabel={`${f.label} verringern`} onPress={() => onChange(Math.max(f.min, +(value - f.step).toFixed(2)))} style={[st.knopf, { minWidth: 44, minHeight: 44 }]} fokusStil={st.fokus}><Text style={st.knopfText}>−</Text></FKnopf>}
        {f.type === "color" && <View style={{ width: 28, height: 28, borderRadius: 5, borderWidth: 1, borderColor: "#fff", backgroundColor: value }} />}
        <FFeld bereich={area} spalte={1} wert={draft} aufWert={v => { setDraft(v); setError(""); }} accessibilityLabel={f.label} autoCapitalize="none" autoCorrect={false} keyboardType={f.type === "number" ? "numbers-and-punctuation" : "default"} onBlur={commit} style={{ flex: 1, minWidth: 80 }}/>
        <FKnopf bereich={area} spalte={2} accessibilityLabel={f.type === "number" ? `${f.label} erhöhen` : `${f.label} übernehmen`} onPress={() => f.type === "number" ? onChange(Math.min(f.max, +(value + f.step).toFixed(2))) : commit()} style={[st.knopf, { minWidth: 44, minHeight: 44 }]} fokusStil={st.fokus}><Text style={st.knopfText}>{f.type === "number" ? "+" : "OK"}</Text></FKnopf>
      </View>
      {!!error && <Text accessibilityRole="alert" style={{ color: "#ffca85" }}>{error}</Text>}
    </View>
  </FokusReihe>;
}
export function NativePreferenceFields({ fields, values, onChange, area = "dialog", startRow = 1, systemVolume = false }) {
  return fields.filter(f => !f.nativeOnly || systemVolume).map((f, index) => {
    const value = values[f.key], row = startRow + index;
    if (f.type === "choice" || f.type === "boolean") {
      const choices = f.type === "boolean" ? [[true,"An"],[false,"Aus"]] : f.choices;
      return <FokusReihe key={f.key} zeile={row}><FKnopf bereich={area} spalte={0} accessibilityLabel={f.label} onPress={() => { const i = choices.findIndex(([v]) => v === value); onChange({ [f.key]: choices[(i + 1) % choices.length][0] }); }} style={[st.knopf, { marginVertical: 5, minHeight: 48, flexDirection: "row", justifyContent: "space-between", gap: 12 }]} fokusStil={st.fokus}><Text style={[st.knopfText, { flex: 1 }]}>{f.label}</Text><Text style={{ color: "#ff6871", fontWeight: "700" }}>{choices.find(([v]) => v === value)?.[1]}</Text></FKnopf></FokusReihe>;
    }
    return <ValueField key={f.key} field={f} value={value} row={row} area={area} onChange={v => onChange({ [f.key]: v })}/>;
  });
}
export function NativeSubtitleEditor({ value, onChange, area = "dialog", startRow = 1 }) {
  return <>
    <View style={{ alignItems: "center", backgroundColor: "#303b4a", borderRadius: 12, padding: 18, marginBottom: 14 }}><SubtitleText value={value} baseSize={gross ? 24 : 18} text={"So sehen deine Untertitel aus.\nAuch über zwei Zeilen."}/></View>
    <NativePreferenceFields fields={SUBTITLE_FIELDS} values={value} onChange={onChange} area={area} startRow={startRow}/>
    <FokusReihe zeile={startRow+SUBTITLE_FIELDS.length}><FKnopf bereich={area} spalte={0} onPress={() => onChange({ ...SUBTITLE_DEFAULTS })} style={[st.knopf, { marginVertical: 10 }]} fokusStil={st.fokus}><Text style={st.knopfText}>Untertitel zurücksetzen</Text></FKnopf></FokusReihe>
    <Text style={st.gedaempft}>Eigener GHGFlix-Stil · sofortige Vorschau · auf diesem Gerät gespeichert. Positiver Zeitversatz zeigt den Text später. Bilduntertitel lassen sich nicht umfärben.</Text>
  </>;
}
export { GESTURE_FIELDS };

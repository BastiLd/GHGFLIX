// Platform-neutral values. UI adapters and renderers share validation and defaults.
export const SUBTITLE_DEFAULTS = Object.freeze({
  sizePercent: 100, textColor: "#ffffff", textOpacity: 100,
  backgroundColor: "#000000", backgroundOpacity: 55,
  fontFamily: "sans", bold: true, edgeStyle: "shadow", edgeColor: "#000000",
  edgeWidth: 2, bottomPercent: 8, delaySeconds: 0,
});
export const GESTURE_DEFAULTS = Object.freeze({
  doubleTap: true, skipSeconds: 10, hold: true, holdRate: 2,
  swipeBrightness: true, swipeVolume: true, volumeTarget: "player",
});
export const SUBTITLE_FIELDS = [
  { key: "sizePercent", label: "Schriftgröße (%)", type: "number", min: 50, max: 300, step: 1 },
  { key: "textColor", label: "Schriftfarbe", type: "color" },
  { key: "textOpacity", label: "Schriftdeckkraft (%)", type: "number", min: 0, max: 100, step: 1 },
  { key: "backgroundColor", label: "Hintergrundfarbe", type: "color" },
  { key: "backgroundOpacity", label: "Hintergrunddeckkraft (%)", type: "number", min: 0, max: 100, step: 1 },
  { key: "fontFamily", label: "Schriftart", type: "choice", choices: [["sans", "Sans Serif"], ["serif", "Serif"], ["mono", "Monospace"]] },
  { key: "bold", label: "Fettschrift", type: "boolean" },
  { key: "edgeStyle", label: "Schriftrand", type: "choice", choices: [["none", "Ohne"], ["outline", "Kontur"], ["shadow", "Schatten"]] },
  { key: "edgeColor", label: "Randfarbe", type: "color" },
  { key: "edgeWidth", label: "Randstärke", type: "number", min: 0, max: 5, step: 0.5 },
  { key: "bottomPercent", label: "Abstand unten (%)", type: "number", min: 0, max: 40, step: 1 },
  { key: "delaySeconds", label: "Zeitversatz (Sekunden)", type: "number", min: -30, max: 30, step: 0.1 },
];
export const GESTURE_FIELDS = [
  { key: "doubleTap", label: "Doppeltippen zum Spulen", type: "boolean" },
  { key: "skipSeconds", label: "Doppeltipp-Sprung (Sekunden)", type: "number", min: 1, max: 120, step: 1 },
  { key: "hold", label: "Halten für schnelleres Abspielen", type: "boolean" },
  { key: "holdRate", label: "Tempo beim Halten (×)", type: "number", min: 1.25, max: 3, step: 0.25 },
  { key: "swipeBrightness", label: "Links wischen: Helligkeit", type: "boolean" },
  { key: "swipeVolume", label: "Rechts wischen: Lautstärke", type: "boolean" },
  { key: "volumeTarget", label: "Lautstärke steuern", type: "choice", choices: [["player", "Nur GHGFlix"], ["system", "System-Medienlautstärke"]], nativeOnly: true },
];
export function normalizeFields(values, fields, defaults) {
  const result = { ...defaults };
  for (const field of fields) {
    const v = values?.[field.key];
    if (field.type === "number" && typeof v === "number" && Number.isFinite(v)) {
      result[field.key] = Math.min(field.max, Math.max(field.min, Number((Math.round(v / field.step) * field.step).toFixed(6))));
    } else if (field.type === "color" && typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) result[field.key] = v.toLowerCase();
    else if (field.type === "boolean" && typeof v === "boolean") result[field.key] = v;
    else if (field.type === "choice" && field.choices.some(([key]) => key === v)) result[field.key] = v;
  }
  return result;
}
export const normalizeSubtitle = (v) => normalizeFields(v, SUBTITLE_FIELDS, SUBTITLE_DEFAULTS);
export const normalizeGestures = (v) => normalizeFields(v, GESTURE_FIELDS, GESTURE_DEFAULTS);
export function legacySubtitle(v = {}) {
  return normalizeSubtitle({ sizePercent: (v.utGroesse ?? v.subScale ?? 1) * 100,
    textColor: v.utFarbe, backgroundOpacity: (v.utHintergrund ?? .55) * 100,
    bottomPercent: (v.utPosition ?? .08) * 100, delaySeconds: v.utVersatz ?? 0,
    edgeStyle: v.utRand === false ? "none" : "shadow", ...v.subtitleStyle });
}
export function rgba(hex, percent = 100) {
  const valid = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "#000000";
  return `rgba(${parseInt(valid.slice(1, 3), 16)},${parseInt(valid.slice(3, 5), 16)},${parseInt(valid.slice(5, 7), 16)},${Math.min(100, Math.max(0, percent)) / 100})`;
}

import { useEffect, useRef, useState } from "react";
import { GESTURE_FIELDS, SUBTITLE_DEFAULTS, SUBTITLE_FIELDS, rgba, type PlayerField } from "../../shared/player-settings.js";
import { setGestureSettings, setSubtitleStyle, usePlayerPreferences } from "../lib/playerPreferences";

function ValueField({ field: f, value, onChange }: { field: PlayerField; value: unknown; onChange: (v: unknown) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState("");
  const cancelBlur = useRef(false);
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    if (f.type === "number" ? draft.trim() !== "" && Number.isFinite(n) && n >= f.min! && n <= f.max! : /^#[0-9a-f]{6}$/i.test(draft)) {
      onChange(f.type === "number" ? n : draft); setError("");
    } else { setDraft(String(value)); setError(f.type === "number" ? `Wert zwischen ${f.min} und ${f.max} eingeben.` : "Farbe als #RRGGBB eingeben."); }
  };
  return <div className="player-value-field">
    <label><span>{f.label}</span>
      <span className="player-value-inputs">
        {f.type === "color" && <input type="color" aria-label={`${f.label} auswählen`} value={String(value)} onChange={e => onChange(e.target.value)}/>}
        <input aria-label={f.label} aria-invalid={!!error} type="text" inputMode={f.type === "number" ? "decimal" : "text"} value={draft}
          onChange={e => { setDraft(e.target.value); setError(""); }} onBlur={() => { if(cancelBlur.current)cancelBlur.current=false;else commit(); }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } if (e.key === "Escape") { e.preventDefault(); cancelBlur.current=true; setDraft(String(value)); setError(""); e.currentTarget.blur(); } }}/>
      </span>
    </label>
    {f.type === "number" && <input type="range" aria-label={`${f.label} Schieberegler`} min={f.min} max={f.max} step={f.step} value={Number(value)} onChange={e => onChange(Number(e.target.value))}/>}
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
  </div>;
}
export function PlayerSettingsEditor({ section = "all" }: { section?: "all" | "subtitle" | "gestures" }) {
  const p = usePlayerPreferences();
  const fields = (items: PlayerField[], values: object, change: (patch: Record<string, unknown>) => void) => items.filter(f => !f.nativeOnly).map(f => {
    const value = (values as Record<string, unknown>)[f.key];
    if (f.type === "choice" || f.type === "boolean") return <label className="player-choice-field" key={f.key}><span>{f.label}</span>
      <select aria-label={f.label} value={String(value)} onChange={e => change({ [f.key]: f.type === "boolean" ? e.target.value === "true" : e.target.value })}>
        {(f.type === "boolean" ? [["true", "An"], ["false", "Aus"]] : f.choices!).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select></label>;
    return <ValueField key={f.key} field={f} value={value} onChange={v => change({ [f.key]: v })}/>;
  });
  const s = p.subtitle;
  const shadow = s.edgeStyle === "none" ? "none" : s.edgeStyle === "shadow" ? `0 ${s.edgeWidth}px ${s.edgeWidth * 2}px ${s.edgeColor}` : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]].map(([x,y]) => `${x*s.edgeWidth}px ${y*s.edgeWidth}px 0 ${s.edgeColor}`).join(",");
  return <div className="player-settings-editor">
    {section !== "gestures" && <>
      <div className="player-subtitle-preview" aria-label="Untertitelvorschau"><span style={{ fontSize: `${s.sizePercent}%`, color: rgba(s.textColor,s.textOpacity), background: rgba(s.backgroundColor,s.backgroundOpacity), fontFamily: s.fontFamily === "mono" ? "monospace" : s.fontFamily === "serif" ? "serif" : "sans-serif", fontWeight: s.bold ? 700 : 400, textShadow: shadow }}>So sehen deine Untertitel aus.<br/>Auch über zwei Zeilen.</span></div>
      {fields(SUBTITLE_FIELDS, s, setSubtitleStyle)}
      <button className="touch-secondary" onClick={() => setSubtitleStyle({ ...SUBTITLE_DEFAULTS })}>Untertitel zurücksetzen</button>
      <p className="text-sm text-white/60">Änderungen gelten sofort und bleiben auf diesem Gerät gespeichert. Ein positiver Zeitversatz zeigt den Text später. Bilduntertitel lassen sich nicht umfärben.</p>
    </>}
    {section !== "subtitle" && <><h3 className="font-semibold mt-4">Touch-Gesten</h3>{fields(GESTURE_FIELDS, p.gestures, setGestureSettings)}
      <p className="text-sm text-white/60">Tippen: Bedienung ein/aus. Doppeltippen: links zurück, rechts vor. Links vertikal wischen: Bild abdunkeln; rechts: Player-Lautstärke. Maus und Tastatur behalten ihre Befehle.</p></>}
  </div>;
}

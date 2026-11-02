import { Captions, Check, ListVideo, PictureInPicture2, Maximize, Pause, Play, RotateCcw, RotateCw, Settings2, SkipBack, SkipForward, X } from "lucide-react";
import { PlayerSettingsEditor } from "./PlayerSettingsEditor";
import { useDialogFocus } from "../lib/useDialogFocus";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
type Choice = { id: number; label: string };
type Props = {
  paused: boolean; onPause: () => void; onSeek: (seconds: number) => void;
  fullscreen: boolean; onFullscreen: () => void; onQueue?: () => void; onPip: () => void; onNext?: () => void; onPrevious?: () => void; onAspect: () => void;
  previousLabel?: string; nextLabel?: string;
  audio: Choice[]; subtitles: Choice[]; aid: number | "no"; sid: number | "no";
  onAudio: (id: number) => void; onSubtitle: (id: number | "no") => void;
  speed: number; onSpeed: (v: number) => void;
  quality: string; onQuality: (v: string) => void;
  onDialog: (v: boolean) => void;
};
export function MobilePlayerControls(p: Props) {
  const [panel, setPanel] = useState<"language" | "options" | null>(null);
  const [tab, setTab] = useState("audio");
  const [search, setSearch] = useState("");
  useDialogFocus(!!panel, panel === "language" ? "Sprache & Untertitel" : "Wiedergabeoptionen");
  useEffect(() => { p.onDialog(!!panel); return () => p.onDialog(false); }, [panel]);
  useEffect(() => {
    if (!panel) return;
    const back = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input, textarea")) { e.stopImmediatePropagation(); setPanel(null); } };
    window.addEventListener("keydown", back, true);
    return () => window.removeEventListener("keydown", back, true);
  }, [panel]);
  const close = () => setPanel(null);
  const audioName = p.audio.find(t => t.id === p.aid)?.label || "Audio";
  const subName = p.subtitles.find(t => t.id === p.sid)?.label || "Aus";
  const choices = (tab === "audio" ? p.audio : p.subtitles).filter(t => tab === "audio" || t.label.toLowerCase().includes(search.toLowerCase())).slice().sort((a,b) => {
    const rank = (v: string) => v.startsWith("Deutsch") ? 0 : v.startsWith("Englisch") ? 1 : 2;
    return rank(a.label) - rank(b.label) || a.label.localeCompare(b.label, "de");
  });
  return <>
    <div className="touch-control-row"><div className="touch-transport">
      <button aria-label="10 Sekunden zurück" onClick={() => p.onSeek(-10)}><RotateCcw size={20}/><span>10</span></button>
      <button className="touch-play" aria-label={p.paused ? "Abspielen" : "Pausieren"} onClick={p.onPause}>{p.paused ? <Play size={24}/> : <Pause size={24}/>}</button>
      <button aria-label="30 Sekunden vor" onClick={() => p.onSeek(30)}><RotateCw size={20}/><span>30</span></button>
      {p.onPrevious && <button aria-label={p.previousLabel || "Vorherige Folge"} onClick={p.onPrevious}><SkipBack size={20}/></button>}
      {p.onNext && <button aria-label={p.nextLabel || "Nächste Folge"} onClick={p.onNext}><SkipForward size={20}/></button>}
      <button aria-label={p.fullscreen ? "Vollbild beenden" : "Vollbild"} aria-pressed={p.fullscreen} onClick={p.onFullscreen}><Maximize size={20}/></button>
      {p.onQueue && <button aria-label="Wiedergabeliste" title="Wiedergabeliste" onClick={p.onQueue}><ListVideo size={20}/></button>}
      <button aria-label="Bild-im-Bild" onClick={p.onPip}><PictureInPicture2 size={20}/></button>
    </div>
    <div className="touch-player-actions"><button onClick={() => setPanel("language")}><Captions size={20}/><span><strong>Sprache & Untertitel</strong><small>{audioName} · UT: {subName}</small></span></button><button aria-label="Wiedergabeoptionen" onClick={() => setPanel("options")}><Settings2 size={20}/><span>Optionen</span></button></div></div>
    {panel && createPortal(<div className="touch-sheet-backdrop" onClick={close}><section role="dialog" aria-modal="true" aria-label={panel === "language" ? "Sprache & Untertitel" : "Wiedergabeoptionen"} className="touch-sheet" onClick={e => e.stopPropagation()}>
      <header><h2>{panel === "language" ? "Sprache & Untertitel" : "Wiedergabeoptionen"}</h2><button aria-label="Schließen" onClick={close}><X size={20}/></button></header>
      {panel === "language" ? <>
        <div className="touch-tabs" role="tablist" aria-label="Spuren"><button role="tab" aria-selected={tab === "audio"} onClick={() => setTab("audio")}>Audio</button><button role="tab" aria-selected={tab === "sub"} onClick={() => setTab("sub")}>Untertitel</button></div>
        {(tab === "audio" ? p.audio : p.subtitles).length > 6 && <input className="touch-track-search" type="search" aria-label="Sprachen filtern" placeholder="Sprache suchen" value={search} onChange={e => setSearch(e.target.value)} />}
        <div className="touch-track-list" role="tabpanel">
          {tab === "sub" && <button aria-pressed={p.sid === "no"} onClick={() => p.onSubtitle("no")}><span>Aus</span>{p.sid === "no" && <Check size={20}/>}</button>}
          {choices.map(t => <button key={t.id} aria-pressed={(tab === "audio" ? p.aid : p.sid) === t.id} onClick={() => tab === "audio" ? p.onAudio(t.id) : p.onSubtitle(t.id)}><span>{t.label}</span>{(tab === "audio" ? p.aid : p.sid) === t.id && <Check size={20}/>}</button>)}
          {search && !choices.length && <p>Keine passende Sprache in dieser Datei.</p>}
          {tab === "audio" && p.audio.length <= 1 && <p>{p.audio.length ? "Diese Datei enthält nur diese Tonspur." : "Diese Datei enthält keine Tonspur."}</p>}
          {tab === "sub" && !p.subtitles.length && <p>Für diesen Titel sind keine unterstützten Textuntertitel vorhanden.</p>}
        </div>
        <button className="touch-secondary" onClick={() => setPanel("options")}>Untertitel-Darstellung & Tempo</button>
      </> : <div className="touch-options">
        <label>Streaming-Qualität<select value={p.quality} onChange={e => p.onQuality(e.target.value)}><option value="high">Bis 1080p</option><option value="medium">Bis 720p</option><option value="low">Bis 480p</option><option value="original">Originalauflösung</option></select></label>
        <label>Tempo<select value={p.speed} onChange={e => p.onSpeed(Number(e.target.value))}>{[.5,.75,1,1.25,1.5,1.75,2].map(n => <option key={n} value={n}>{n}×</option>)}</select></label>
        <PlayerSettingsEditor />
        <button className="touch-secondary" onClick={p.onAspect}>Bildformat wechseln</button>
        <p>Positiver Zeitversatz zeigt Untertitel später. Qualität und Tempo werden auf diesem Gerät gespeichert. Die Untertitelgröße folgt deinen GHGFlix-Einstellungen.</p>
      </div>}
    </section></div>, document.body)}
  </>;
}

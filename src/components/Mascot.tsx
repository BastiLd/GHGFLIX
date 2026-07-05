import { useQuery } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { continueWatching, scanLibraries } from "../lib/api";
import { useStore } from "../lib/store";
import { useUiPrefs } from "../lib/uiPrefs";
import type { ScanProgress } from "../lib/types";

/** GHGFlix mascot — a small companion in the corner. It is not just deco:
 *  it wiggles while a scan runs (live status), announces when the scan is done,
 *  and a click opens quick actions + a rotating tip. Character + visibility are
 *  configurable in Einstellungen → Allgemein. */

const FACES: Record<string, { idle: string; busy: string; happy: string; name: string }> = {
  blitz: { idle: "⚡", busy: "🌩️", happy: "✨", name: "Blitzi" },
  katze: { idle: "🐱", busy: "🙀", happy: "😸", name: "Kino-Katze" },
  robo: { idle: "🤖", busy: "⚙️", happy: "🎉", name: "Robo" },
  geist: { idle: "👻", busy: "😱", happy: "🥳", name: "Flixi" },
  drache: { idle: "🐲", busy: "🔥", happy: "🎊", name: "Drako" },
  pinguin: { idle: "🐧", busy: "❄️", happy: "🎬", name: "Pingu" },
};

const TIPS = [
  "Tipp: Mit Strg+F springst du direkt in die Suche.",
  "Tipp: Rechtsklick auf eine Karte öffnet das Schnellmenü.",
  "Tipp: Im Player springst du mit den Tasten 0–9 zu 0–90 %.",
  "Tipp: „Zuordnung dauerhaft merken“ beim Identifizieren überlebt sogar einen Neuaufbau.",
  "Tipp: Shift+Mausrad scrollt Reihen seitwärts.",
  "Tipp: Die Taste M schaltet im Player stumm.",
  "Tipp: Mit J/L spulst du im Player zurück/vor.",
  "Tipp: Im Theme-Store gibt es 25 Farbwelten.",
  "Tipp: Doppelklick im Player = Vollbild.",
  "Tipp: Externe Untertitel neben der Datei werden automatisch geladen.",
];

export function Mascot() {
  const mascot = useUiPrefs((s) => s.mascot);
  const tipsOn = useUiPrefs((s) => s.mascotTips);
  const toast = useStore((s) => s.toast);
  const profileId = useStore((s) => s.profileId);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [happy, setHappy] = useState(false);
  const [open, setOpen] = useState(false);
  const [tip, setTip] = useState(0);
  const happyTimer = useRef<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // the most recent in-progress item, so the mascot can actually DO something
  // useful: one-click resume of what you last watched
  const resume = useQuery({
    queryKey: ["continue", profileId],
    queryFn: () => continueWatching(profileId),
    enabled: mascot !== "off",
  });
  const nextUp = (resume.data ?? [])[0];

  useEffect(() => {
    const un = listen<ScanProgress>("scan://progress", (e) => {
      const st = e.payload.stage;
      if (st === "done") {
        setBusy(false);
        setHappy(true);
        if (happyTimer.current) window.clearTimeout(happyTimer.current);
        happyTimer.current = window.setTimeout(() => setHappy(false), 4000);
      } else if (st === "error") {
        setBusy(false);
      } else {
        setBusy(true);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);

  if (mascot === "off") return null;
  const face = FACES[mascot] ?? FACES.blitz;
  const emoji = happy ? face.happy : busy ? face.busy : face.idle;

  return (
    <div ref={ref} className="fixed bottom-5 left-5 z-[120] select-none">
      {open && (
        <div className="absolute bottom-14 left-0 w-64 bg-ghg-elevated border border-ghg-line rounded-xl shadow-2xl p-3 pop-in space-y-2">
          <p className="text-sm font-bold">{face.name}</p>
          {/* one-click resume of the last in-progress item */}
          {!busy && nextUp && (
            <button
              onClick={() => {
                setOpen(false);
                navigate(`/play/${nextUp.mediaType}/${nextUp.refId}`);
              }}
              className="w-full text-left rounded-lg bg-ghg-red/15 hover:bg-ghg-red/25 border border-ghg-red/30 px-2.5 py-2 transition"
            >
              <p className="text-[11px] text-ghg-red font-semibold">▶ Weiterschauen</p>
              <p className="text-xs font-semibold truncate">{nextUp.title}</p>
              {nextUp.subtitle && <p className="text-[11px] text-ghg-muted truncate">{nextUp.subtitle}</p>}
            </button>
          )}
          {busy ? (
            <p className="text-xs text-ghg-muted">Ich scanne gerade deine Bibliothek …</p>
          ) : (
            tipsOn && <p className="text-xs text-ghg-muted">{TIPS[tip % TIPS.length]}</p>
          )}
          <div className="flex gap-1.5 flex-wrap pt-1">
            <button
              onClick={() => {
                setTip((t) => t + 1);
              }}
              className="px-2 py-1 rounded-md bg-ghg-surface2 hover:bg-ghg-bg2 text-xs"
            >
              Nächster Tipp
            </button>
            <button
              onClick={() => {
                setOpen(false);
                void scanLibraries()
                  .then(() => toast("Scan gestartet", "info"))
                  .catch((e) => toast(String(e), "error"));
              }}
              className="px-2 py-1 rounded-md bg-ghg-surface2 hover:bg-ghg-bg2 text-xs"
            >
              Scan starten
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/search?q=");
              }}
              className="px-2 py-1 rounded-md bg-ghg-surface2 hover:bg-ghg-bg2 text-xs"
            >
              Suche
            </button>
            <button
              onClick={() => {
                setOpen(false);
                navigate("/settings");
              }}
              className="px-2 py-1 rounded-md bg-ghg-surface2 hover:bg-ghg-bg2 text-xs"
            >
              Einstellungen
            </button>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        title={busy ? "Scan läuft …" : face.name}
        className={`w-11 h-11 rounded-full bg-ghg-surface2/90 border border-ghg-line shadow-xl flex items-center justify-center text-2xl hover:scale-110 transition ${busy ? "mascot-busy" : "mascot-idle"}`}
      >
        <span>{emoji}</span>
      </button>
    </div>
  );
}

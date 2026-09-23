/* Ein Reiter mit Bonusmaterial einer Serie (Bloopers, Hinter den Kulissen …).
 *
 * Aufbau nach Wunsch: NICHT direkt die Dateien, sondern erst eine KACHEL PRO
 * STAFFEL — ein Klick öffnet die Dateien darin, der Pfeil links oben führt
 * zurück. Weil die Kachelansicht nicht überall passt (Specials und Filme
 * wollen die Liste direkt), lässt sie sich pro Reiter umschalten; die
 * Einstellung merkt sich die Serie.
 */
import { useMemo, useState } from "react";
import { ArrowLeft, LayoutGrid, List, Pencil, Play } from "lucide-react";
import type { Extra } from "../lib/types";
import { setNote } from "../lib/api";
import { Button } from "./ui";

/** Staffel-Überschrift; `null` sammelt alles ohne Staffelangabe. */
function staffelLabel(s: number | null | undefined) {
  if (s === null || s === undefined) return "Ohne Staffel";
  return s === 0 ? "Specials" : `Staffel ${s}`;
}

export default function ExtrasTab({
  items,
  kachelnDefault,
  speicherSchluessel,
  onPlay,
  onAendern,
  onNotizGespeichert,
}: {
  items: Extra[];
  /** Voreinstellung: Kacheln an? (bei Bloopers ja, bei Specials/Filme nein) */
  kachelnDefault: boolean;
  /** z.B. "ghgflix.kacheln.12.blooper" — merkt die Wahl pro Serie und Reiter */
  speicherSchluessel: string;
  onPlay: (e: Extra) => void;
  onAendern: (e: Extra) => void;
  onNotizGespeichert: () => void;
}) {
  const [kacheln, setKacheln] = useState(() => {
    const gespeichert = localStorage.getItem(speicherSchluessel);
    return gespeichert === null ? kachelnDefault : gespeichert === "1";
  });
  const [offeneStaffel, setOffeneStaffel] = useState<number | null | undefined>(undefined);

  const gruppen = useMemo(() => {
    const m = new Map<string, { staffel: number | null; items: Extra[] }>();
    for (const e of items) {
      const s = e.staffel ?? null;
      const k = String(s);
      if (!m.has(k)) m.set(k, { staffel: s, items: [] });
      m.get(k)!.items.push(e);
    }
    return [...m.values()].sort((a, b) => (a.staffel ?? 9999) - (b.staffel ?? 9999));
  }, [items]);

  const umschalten = () => {
    const neu = !kacheln;
    setKacheln(neu);
    localStorage.setItem(speicherSchluessel, neu ? "1" : "0");
    setOffeneStaffel(undefined);
  };

  const kopf = (
    <div className="flex items-center gap-2 mb-4">
      {kacheln && offeneStaffel !== undefined && (
        <button
          onClick={() => setOffeneStaffel(undefined)}
          title="Zurück zur Übersicht"
          className="p-2 rounded-lg bg-ghg-surface2 hover:bg-ghg-line text-ghg-text"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
      )}
      <span className="text-sm text-ghg-muted flex-1">
        {kacheln && offeneStaffel !== undefined
          ? staffelLabel(offeneStaffel)
          : `${items.length} Einträge`}
      </span>
      {/* Notausgang: Kacheln passen nicht überall — hier umstellbar. */}
      <Button variant="ghost" onClick={umschalten}>
        {kacheln ? <List className="w-4 h-4" /> : <LayoutGrid className="w-4 h-4" />}
        {kacheln ? "Als Liste" : "Als Kacheln"}
      </Button>
    </div>
  );

  // Liste (keine Kacheln) — oder eine geöffnete Kachel
  const sichtbar =
    !kacheln || offeneStaffel === undefined
      ? items
      : gruppen.find((g) => g.staffel === offeneStaffel)?.items ?? [];

  return (
    <div className="mb-6">
      {kopf}

      {kacheln && offeneStaffel === undefined ? (
        <div className="flex gap-4 flex-wrap">
          {gruppen.map((g) => (
            <button
              key={String(g.staffel)}
              onClick={() => setOffeneStaffel(g.staffel)}
              className="w-44 rounded-xl border border-ghg-line bg-ghg-bg2 hover:border-ghg-red transition p-4 text-left"
            >
              <div className="text-base font-bold">{staffelLabel(g.staffel)}</div>
              <div className="text-xs text-ghg-muted mt-1">{g.items.length} Einträge</div>
              <div className="mt-3 text-[11px] text-ghg-muted/70 line-clamp-3">
                {g.items.slice(0, 3).map((e) => e.titel).join(" · ")}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {sichtbar.map((e) => (
            <ExtraZeile
              key={e.id}
              extra={e}
              zeigeStaffel={!kacheln}
              onPlay={() => onPlay(e)}
              onAendern={() => onAendern(e)}
              onNotizGespeichert={onNotizGespeichert}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ExtraZeile({
  extra,
  zeigeStaffel,
  onPlay,
  onAendern,
  onNotizGespeichert,
}: {
  extra: Extra;
  zeigeStaffel: boolean;
  onPlay: () => void;
  onAendern: () => void;
  onNotizGespeichert: () => void;
}) {
  const [bearbeite, setBearbeite] = useState(false);
  const [text, setText] = useState(extra.notiz ?? "");

  return (
    <div className="flex items-center gap-3 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2">
      <button
        onClick={onPlay}
        className="p-2 rounded-full bg-ghg-red text-white shrink-0"
        title="Abspielen"
      >
        <Play className="w-3.5 h-3.5" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{extra.titel}</span>
          {zeigeStaffel && extra.staffel != null && (
            <span className="text-[11px] text-ghg-muted">· {staffelLabel(extra.staffel)}</span>
          )}
        </div>
        {/* Notiz: klein und orange direkt am Eintrag */}
        {extra.notiz && !bearbeite && (
          <p className="text-xs text-orange-400 italic mt-0.5">📝 {extra.notiz}</p>
        )}
        {bearbeite && (
          <div className="flex gap-2 mt-1">
            <input
              autoFocus
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder="z. B. „ca. S6 zwischen Ep 4 und 5“"
              className="flex-1 bg-ghg-surface2 border border-ghg-line rounded px-2 py-1 text-xs"
              onKeyDown={async (ev) => {
                if (ev.key === "Enter") {
                  await setNote(extra.path, text);
                  setBearbeite(false);
                  onNotizGespeichert();
                }
                if (ev.key === "Escape") setBearbeite(false);
              }}
            />
            <button
              className="text-xs text-ghg-red px-2"
              onClick={async () => {
                await setNote(extra.path, text);
                setBearbeite(false);
                onNotizGespeichert();
              }}
            >
              Sichern
            </button>
          </div>
        )}
      </div>
      <button
        onClick={() => setBearbeite((b) => !b)}
        title="Notiz hinzufügen/ändern"
        className="p-1.5 rounded-md hover:bg-ghg-surface2 text-ghg-muted shrink-0"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onAendern}
        title="Art/Staffel ändern"
        className="text-xs text-ghg-muted hover:text-ghg-text px-2 shrink-0"
      >
        Ändern
      </button>
    </div>
  );
}

import { useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Copy, Download, Trash2 } from "lucide-react";
import { useStore, type ToastKind } from "../lib/store";
import { webDownload } from "../lib/backend";
import { Button, Modal } from "./ui";

/**
 * Meldungs-Protokoll.
 *
 * WARUM ES DAS GIBT: Die kurzen Meldungen unten rechts verschwinden nach
 * wenigen Sekunden, lassen sich nicht markieren und schneiden mehrzeilige
 * Fehlertexte ab. Wer nachlesen will, WARUM etwas schiefging — etwa welche
 * Adressen beim Abonnieren eines Blogs vergeblich probiert wurden —, hatte
 * keine Chance dazu.
 *
 * Hier steht jede Meldung vollständig, mit Uhrzeit, über Seitenwechsel und
 * Neustarts hinweg. Und sie lässt sich als Text herauskopieren oder als
 * Datei sichern — genau das braucht man, um einen Fehler weiterzugeben.
 */
export function Protokoll({ open, onClose }: { open: boolean; onClose: () => void }) {
  const protokoll = useStore((s) => s.protokoll);
  const leeren = useStore((s) => s.protokollLeeren);
  const toast = useStore((s) => s.toast);
  const [filter, setFilter] = useState<"alle" | ToastKind>("alle");
  const [kopiert, setKopiert] = useState(false);

  const sichtbar = useMemo(
    () => [...protokoll].reverse().filter((e) => (filter === "alle" ? true : e.kind === filter)),
    [protokoll, filter],
  );

  const alsText = useMemo(
    () =>
      [...protokoll]
        .map((e) => {
          const t = new Date(e.zeit).toLocaleString("de-DE");
          const art = e.kind === "error" ? "FEHLER " : e.kind === "success" ? "OK     " : "INFO   ";
          const wdh = e.anzahl > 1 ? ` (${e.anzahl}×)` : "";
          return `[${t}] ${art} ${e.message}${wdh}`;
        })
        .join("\n"),
    [protokoll],
  );

  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(alsText);
      setKopiert(true);
      setTimeout(() => setKopiert(false), 2000);
    } catch {
      // Ohne Zwischenablage-Erlaubnis: der Text steht ohnehin markierbar da.
      toast("Kopieren nicht erlaubt — bitte den Text unten markieren", "error");
    }
  };

  const zahl = (k: ToastKind) => protokoll.filter((e) => e.kind === k).length;

  return (
    <Modal open={open} onClose={onClose} title="Meldungen" wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex rounded-lg overflow-hidden border border-ghg-line">
            {(
              [
                ["alle", `Alle (${protokoll.length})`],
                ["error", `Fehler (${zahl("error")})`],
                ["success", `Erfolg (${zahl("success")})`],
                ["info", `Hinweise (${zahl("info")})`],
              ] as [typeof filter, string][]
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setFilter(v)}
                className={clsx(
                  "px-3 py-1.5 text-sm transition",
                  filter === v ? "bg-ghg-red text-white font-semibold" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => void kopieren()} disabled={protokoll.length === 0}>
              {kopiert ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              {kopiert ? "Kopiert" : "Alles kopieren"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => webDownload(`ghgflix-meldungen-${new Date().toISOString().slice(0, 10)}.txt`, alsText, "text/plain")}
              disabled={protokoll.length === 0}
            >
              <Download className="w-4 h-4" /> Als Datei
            </Button>
            <Button variant="danger" onClick={leeren} disabled={protokoll.length === 0}>
              <Trash2 className="w-4 h-4" /> Leeren
            </Button>
          </div>
        </div>

        {protokoll.length === 0 ? (
          <p className="text-sm text-ghg-muted py-8 text-center">Noch keine Meldungen.</p>
        ) : (
          /* `select-text` und ein echtes <pre>: der Text muss sich mit der
             Maus markieren lassen, auch mehrzeilig. Genau daran ist es bei
             den kurzen Meldungen gescheitert. */
          <div className="max-h-[55vh] overflow-y-auto border border-ghg-line rounded-lg divide-y divide-ghg-line select-text">
            {sichtbar.map((e) => (
              <div key={e.id} className="px-3 py-2 flex gap-3">
                <span className="text-[11px] text-ghg-muted tabular-nums shrink-0 pt-0.5">
                  {new Date(e.zeit).toLocaleTimeString("de-DE")}
                </span>
                <span
                  className={clsx(
                    "text-[10px] font-bold uppercase shrink-0 pt-0.5 w-14",
                    e.kind === "error" ? "text-ghg-red" : e.kind === "success" ? "text-emerald-400" : "text-ghg-muted",
                  )}
                >
                  {e.kind === "error" ? "Fehler" : e.kind === "success" ? "OK" : "Info"}
                </span>
                <pre className="flex-1 text-sm whitespace-pre-wrap break-words font-sans m-0">{e.message}</pre>
                {e.anzahl > 1 && (
                  <span className="text-[11px] text-ghg-muted shrink-0 pt-0.5">{e.anzahl}×</span>
                )}
              </div>
            ))}
          </div>
        )}

        <p className="text-xs text-ghg-muted">
          Die letzten {300} Meldungen bleiben erhalten — auch nach einem Neustart der App.
        </p>
      </div>
    </Modal>
  );
}

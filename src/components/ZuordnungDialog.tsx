/* Zuordnungs-Fenster — „Was ist diese Datei wirklich?"
 *
 * WARUM ES DAS GIBT: Bis hierher ließ sich an einer Datei nur Staffel und Folge
 * ändern. Man konnte nicht sagen „das ist gar keine Folge, sondern ein Film",
 * „das gehört zu einer anderen Serie" oder „das ist ein Blooper" — und eine
 * versehentlich zugeordnete Sprach-/Qualitätsfassung wurde man gar nicht mehr
 * los. Hier geht beides, für JEDE Datei, mit vollem Pfad zum Nachschauen.
 *
 * Die Entscheidung landet in der Tabelle `zuordnung` (am Dateipfad) und
 * überlebt damit auch „Bibliothek neu aufbauen".
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, FileQuestion, Hand, RotateCcw, Search, X } from "lucide-react";
import { assignFile, assignmentList, clearAssignment, listShows, setNote } from "../lib/api";
import type { ExtraArt, ZuordnungEintrag, ZuordnungZiel } from "../lib/types";
import { Button, Modal, Spinner } from "./ui";
import { useStore } from "../lib/store";

const ARTEN: { wert: ExtraArt; label: string }[] = [
  { wert: "special", label: "Special" },
  { wert: "blooper", label: "Bloopers" },
  { wert: "behind", label: "Hinter den Kulissen" },
  { wert: "deleted", label: "Gelöschte Szene" },
  { wert: "featurette", label: "Featurette" },
  { wert: "interview", label: "Interview" },
  { wert: "trailer", label: "Trailer" },
  { wert: "sonstiges", label: "Sonstiges" },
];

const BADGE: Record<string, string> = {
  film: "Film",
  folge: "Folge",
  extra: "Zusatz",
  nirgends: "Ausgeblendet",
};

export default function ZuordnungDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  const [nurUnsichere, setNurUnsichere] = useState(true);
  const [suche, setSuche] = useState("");
  const [offen, setOffen] = useState<string | null>(null);

  const liste = useQuery({
    queryKey: ["zuordnung", nurUnsichere],
    queryFn: () => assignmentList(nurUnsichere),
    enabled: open,
  });
  const shows = useQuery({ queryKey: ["shows"], queryFn: listShows, enabled: open });

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const alle = liste.data ?? [];
    if (!q) return alle;
    return alle.filter(
      (e) => e.dateiname.toLowerCase().includes(q) || e.path.toLowerCase().includes(q) || e.beschreibung.toLowerCase().includes(q),
    );
  }, [liste.data, suche]);

  const anwenden = async (path: string, ziel: ZuordnungZiel) => {
    try {
      await assignFile(path, ziel);
      toast("Zuordnung gespeichert", "success");
      setOffen(null);
      void liste.refetch();
      qc.invalidateQueries({ queryKey: ["movies"] });
      qc.invalidateQueries({ queryKey: ["shows"] });
      qc.invalidateQueries({ queryKey: ["showDetail"] });
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Zuordnung prüfen" wide>
      <div className="space-y-3">
        <p className="text-sm text-ghg-muted">
          Hier steht jede Datei mit vollem Pfad. „Unsicher“ heißt: die automatische Erkennung hat geraten — nicht
          zwangsläufig falsch, aber einen Blick wert. Du kannst jede Datei zu einer Folge, einem Film, zu
          Bonusmaterial machen oder ganz ausblenden. Die Entscheidung bleibt auch nach „Bibliothek neu aufbauen“.
        </p>

        <div className="flex gap-2 flex-wrap items-center">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={nurUnsichere}
              onChange={(e) => setNurUnsichere(e.target.checked)}
              className="w-4 h-4 accent-ghg-red"
            />
            Nur Unsicheres zeigen
          </label>
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-ghg-muted" />
            <input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="Nach Dateiname oder Pfad suchen …"
              className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg pl-8 pr-3 py-1.5 text-sm"
            />
          </div>
          <span className="text-xs text-ghg-muted">{gefiltert.length} Einträge</span>
        </div>

        {liste.isLoading && <Spinner />}

        <div className="max-h-[55vh] overflow-y-auto space-y-2 pr-1">
          {gefiltert.length === 0 && !liste.isLoading && (
            <p className="text-sm text-ghg-muted py-6 text-center">
              {nurUnsichere ? "Nichts Unsicheres — alles sauber zugeordnet. 🎉" : "Nichts gefunden."}
            </p>
          )}
          {gefiltert.map((e) => (
            <Zeile
              key={e.path}
              eintrag={e}
              shows={shows.data ?? []}
              offen={offen === e.path}
              onToggle={() => setOffen(offen === e.path ? null : e.path)}
              onAnwenden={(z) => anwenden(e.path, z)}
              onZuruecksetzen={async () => {
                await clearAssignment(e.path);
                toast("Handentscheidung aufgehoben — beim nächsten Scan entscheidet die Automatik", "info");
                void liste.refetch();
              }}
              onNotiz={async (text) => {
                await setNote(e.path, text);
                void liste.refetch();
                qc.invalidateQueries({ queryKey: ["notes"] });
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Zeile({
  eintrag,
  shows,
  offen,
  onToggle,
  onAnwenden,
  onZuruecksetzen,
  onNotiz,
}: {
  eintrag: ZuordnungEintrag;
  shows: { id: number; title: string; tmdbId?: number | null }[];
  offen: boolean;
  onToggle: () => void;
  onAnwenden: (z: ZuordnungZiel) => void;
  onZuruecksetzen: () => void;
  onNotiz: (text: string) => void;
}) {
  const [ziel, setZiel] = useState<ZuordnungZiel["ziel"]>("folge");
  const [showTmdb, setShowTmdb] = useState<number | null>(null);
  const [staffel, setStaffel] = useState("");
  const [folge, setFolge] = useState("");
  const [art, setArt] = useState<ExtraArt>("special");
  const [notiz, setNotiz] = useState(eintrag.notiz ?? "");

  const mitTmdb = shows.filter((s) => s.tmdbId);

  return (
    <div
      className={`border rounded-lg p-3 ${
        eintrag.unsicher ? "border-amber-500/40 bg-amber-500/5" : "border-ghg-line bg-ghg-bg2"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs px-1.5 py-0.5 rounded bg-ghg-surface2 text-ghg-muted uppercase">
              {BADGE[eintrag.aktuell] ?? eintrag.aktuell}
            </span>
            {eintrag.vonHand && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-ghg-red/20 text-ghg-red flex items-center gap-1">
                <Hand className="w-3 h-3" /> von Hand
              </span>
            )}
            <span className="font-medium text-sm truncate">{eintrag.dateiname}</span>
          </div>
          <p className="text-xs text-ghg-muted mt-1">{eintrag.beschreibung}</p>
          {/* Der VOLLE Pfad — genau der Punkt, an dem man selbst nachschauen kann. */}
          <p className="text-[11px] text-ghg-muted/70 mt-1 break-all font-mono">{eintrag.path}</p>
          {eintrag.unsicher && (
            <p className="text-xs text-amber-400 mt-1 flex items-start gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {eintrag.unsicher}
            </p>
          )}
          {eintrag.notiz && !offen && (
            <p className="text-xs text-orange-400 mt-1 italic">📝 {eintrag.notiz}</p>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {eintrag.vonHand && (
            <button
              onClick={onZuruecksetzen}
              title="Handentscheidung aufheben"
              className="p-1.5 rounded-md hover:bg-ghg-surface2 text-ghg-muted"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          )}
          <Button variant="ghost" onClick={onToggle}>
            {offen ? <X className="w-4 h-4" /> : <FileQuestion className="w-4 h-4" />}
            {offen ? "Zu" : "Ändern"}
          </Button>
        </div>
      </div>

      {offen && (
        <div className="mt-3 pt-3 border-t border-ghg-line space-y-3">
          <div className="flex gap-2 flex-wrap">
            {(
              [
                ["folge", "Folge einer Serie"],
                ["film", "Eigenständiger Film"],
                ["extra", "Bonusmaterial"],
                ["ignorieren", "Ausblenden"],
              ] as const
            ).map(([w, l]) => (
              <button
                key={w}
                onClick={() => setZiel(w)}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  ziel === w ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted"
                }`}
              >
                {l}
              </button>
            ))}
          </div>

          {(ziel === "folge" || ziel === "extra") && (
            <select
              value={showTmdb ?? ""}
              onChange={(e) => setShowTmdb(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
            >
              <option value="">Serie wählen …</option>
              {mitTmdb.map((s) => (
                <option key={s.id} value={s.tmdbId!}>
                  {s.title}
                </option>
              ))}
            </select>
          )}

          {ziel === "folge" && (
            <div className="flex gap-2">
              <input
                value={staffel}
                onChange={(e) => setStaffel(e.target.value)}
                placeholder="Staffel"
                inputMode="numeric"
                className="w-28 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
              />
              <input
                value={folge}
                onChange={(e) => setFolge(e.target.value)}
                placeholder="Folge"
                inputMode="numeric"
                className="w-28 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          )}

          {ziel === "extra" && (
            <div className="flex gap-2 flex-wrap">
              <select
                value={art}
                onChange={(e) => setArt(e.target.value as ExtraArt)}
                className="bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
              >
                {ARTEN.map((a) => (
                  <option key={a.wert} value={a.wert}>
                    {a.label}
                  </option>
                ))}
              </select>
              <input
                value={staffel}
                onChange={(e) => setStaffel(e.target.value)}
                placeholder="Staffel (optional)"
                inputMode="numeric"
                className="w-44 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
          )}

          {/* Notiz — klein und orange an der Folge sichtbar, z.B. „ca. S6 zwischen Ep 4 und 5" */}
          <div className="flex gap-2">
            <input
              value={notiz}
              onChange={(e) => setNotiz(e.target.value)}
              placeholder="Kurze Notiz (z. B. „ca. S6 zwischen Ep 4 und 5“)"
              className="flex-1 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-1.5 text-sm"
            />
            <Button variant="ghost" onClick={() => onNotiz(notiz)}>
              Notiz sichern
            </Button>
          </div>

          <Button
            onClick={() =>
              onAnwenden({
                ziel,
                showTmdb: ziel === "folge" || ziel === "extra" ? showTmdb : null,
                staffel: staffel ? Number(staffel) : null,
                episode: ziel === "folge" && folge ? Number(folge) : null,
                extraArt: ziel === "extra" ? art : null,
              })
            }
            disabled={(ziel === "folge" && (!showTmdb || !staffel || !folge)) || (ziel === "extra" && !showTmdb)}
          >
            <Check className="w-4 h-4" /> Übernehmen
          </Button>
        </div>
      )}
    </div>
  );
}

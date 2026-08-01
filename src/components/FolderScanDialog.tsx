import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Film, RefreshCw, Tv, X } from "lucide-react";
import clsx from "clsx";
import { applyFolderSelection, mediaThumbnail, previewFolder } from "../lib/api";
import { useStore } from "../lib/store";
import { Button, Modal, Spinner } from "./ui";
import type { FolderHit, LibraryKind } from "../lib/types";

/** Entscheidung pro Fund. "offen" heißt: es passiert nichts damit. */
type Wahl = "offen" | "ja" | "nein";

/* Vorschaubilder werden vom Server per ffmpeg aus dem Video geschnitten. Bei
   hunderten Funden würde ein Bild pro Zeile gleichzeitig das NAS in die Knie
   zwingen — deshalb eine winzige Warteschlange mit höchstens drei parallel. */
let laufend = 0;
const warteschlange: (() => void)[] = [];
function nächsterAusWarteschlange() {
  if (laufend >= 3) return;
  const fn = warteschlange.shift();
  if (!fn) return;
  laufend++;
  fn();
}
function mitBremse<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    warteschlange.push(() => {
      fn()
        .then(resolve, reject)
        .finally(() => {
          laufend--;
          nächsterAusWarteschlange();
        });
    });
    nächsterAusWarteschlange();
  });
}

function größe(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Auswahl-Fenster für Ordner (Punkt 1 der Übergabe).
 *
 * Der Nutzer hat einen Ordner gewählt; hier sieht er JEDEN gefundenen Film und
 * jede gefundene Folge einzeln mit Vorschaubild und entscheidet — einzeln oder
 * für alle auf einmal — was in die Bibliothek soll und was nicht.
 *
 * Abgelehntes wird dauerhaft gemerkt (Ignorierliste), sonst wäre die
 * Entscheidung beim nächsten Scan wieder weg.
 */
export function FolderScanDialog({
  open,
  root,
  defaultKind = "tv",
  onClose,
  onDone,
}: {
  open: boolean;
  root: string;
  defaultKind?: LibraryKind;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const [laden, setLaden] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [funde, setFunde] = useState<FolderHit[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [wahl, setWahl] = useState<Record<string, Wahl>>({});
  const [kind, setKind] = useState<LibraryKind>(defaultKind);
  const [nurNeue, setNurNeue] = useState(true);
  const [speichert, setSpeichert] = useState(false);

  useEffect(() => {
    if (!open || !root) return;
    setLaden(true);
    setFehler(null);
    previewFolder(root)
      .then((r) => {
        setFunde(r.hits);
        setSkipped(r.skipped);
        setTruncated(r.truncated);
        // Vorbelegung: Neues ist vorgeschlagen, früher Abgelehntes bleibt
        // abgelehnt, schon Vorhandenes bleibt offen (da ist nichts zu tun).
        const start: Record<string, Wahl> = {};
        for (const h of r.hits) start[h.path] = h.ignored ? "nein" : h.inLibrary ? "offen" : "ja";
        setWahl(start);
        // Die Mehrheit der Funde entscheidet, ob es Serien oder Filme sind.
        const folgen = r.hits.filter((h) => h.kind === "episode").length;
        setKind(folgen * 2 >= r.hits.length ? "tv" : "movie");
      })
      .catch((e) => setFehler(String(e)))
      .finally(() => setLaden(false));
  }, [open, root]);

  const sichtbar = useMemo(
    () => (nurNeue ? funde.filter((h) => !h.inLibrary) : funde),
    [funde, nurNeue],
  );

  const zählung = useMemo(() => {
    let ja = 0;
    let nein = 0;
    for (const h of funde) {
      // Schon vorhandene Dateien noch einmal zu "bestätigen" ändert nichts —
      // sie zählen deshalb nicht mit, sonst verspricht der Knopf zu viel.
      if (wahl[h.path] === "ja" && !h.inLibrary) ja++;
      if (wahl[h.path] === "nein") nein++;
    }
    return { ja, nein };
  }, [funde, wahl]);

  const alleSetzen = (w: Wahl) => {
    const next = { ...wahl };
    for (const h of sichtbar) next[h.path] = w;
    setWahl(next);
  };

  const übernehmen = async () => {
    const accept = funde.filter((h) => wahl[h.path] === "ja" && !h.inLibrary).map((h) => h.path);
    const reject = funde.filter((h) => wahl[h.path] === "nein").map((h) => h.path);
    if (accept.length === 0 && reject.length === 0) {
      toast("Nichts ausgewählt", "info");
      return;
    }
    setSpeichert(true);
    try {
      const r = await applyFolderSelection(root, kind, accept, reject);
      const teile: string[] = [];
      if (r.accepted > 0) teile.push(`${r.accepted} übernommen`);
      if (r.rejected > 0) teile.push(`${r.rejected} abgelehnt`);
      if (r.removed > 0) teile.push(`${r.removed} aus der Bibliothek entfernt`);
      if (r.libraryCreated) teile.push("Ordner als neue Bibliothek angelegt");
      toast(`${teile.join(" · ")} — Scan läuft`, "success");
      onDone?.();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setSpeichert(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Gefundene Videos auswählen" wide>
      <div className="space-y-3">
        <p className="text-xs text-ghg-muted break-all">{root}</p>

        {laden && (
          <div className="flex items-center gap-2 text-sm text-ghg-muted py-6">
            <Spinner className="w-4 h-4" /> Ordner wird durchsucht …
          </div>
        )}
        {fehler && <p className="text-sm text-ghg-red">{fehler}</p>}

        {!laden && !fehler && (
          <>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <span className="text-ghg-muted">
                {funde.length} Video{funde.length === 1 ? "" : "s"} gefunden
                {skipped > 0 && ` · ${skipped} Schnipsel übersprungen`}
              </span>
              {truncated && (
                <span className="px-2 py-0.5 rounded bg-ghg-red/20 border border-ghg-red/40 text-ghg-red text-[11px] font-semibold">
                  Liste bei 2000 abgeschnitten — engeren Ordner wählen
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex rounded-lg overflow-hidden border border-ghg-line">
                <button
                  onClick={() => setKind("tv")}
                  className={clsx(
                    "px-3 py-1.5 text-sm flex items-center gap-1.5",
                    kind === "tv" ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted",
                  )}
                >
                  <Tv className="w-4 h-4" /> Serien
                </button>
                <button
                  onClick={() => setKind("movie")}
                  className={clsx(
                    "px-3 py-1.5 text-sm flex items-center gap-1.5",
                    kind === "movie" ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted",
                  )}
                >
                  <Film className="w-4 h-4" /> Filme
                </button>
              </div>
              <Button variant="ghost" onClick={() => alleSetzen("ja")}>
                <Check className="w-4 h-4" /> Alle bestätigen
              </Button>
              <Button variant="ghost" onClick={() => alleSetzen("nein")}>
                <X className="w-4 h-4" /> Alle ablehnen
              </Button>
              <Button variant="ghost" onClick={() => alleSetzen("offen")}>
                Alle offen lassen
              </Button>
              <label className="flex items-center gap-2 text-sm cursor-pointer ml-auto">
                <input
                  type="checkbox"
                  checked={nurNeue}
                  onChange={(e) => setNurNeue(e.target.checked)}
                  className="w-4 h-4 accent-ghg-red"
                />
                Nur neue zeigen
              </label>
            </div>

            <p className="text-xs text-ghg-muted">
              Die Bibliotheksart gilt für den Ordner als Ganzes. „Ablehnen“ merkt sich der Server dauerhaft — die Datei
              taucht auch nach einem erneuten Scan nicht wieder auf (rückgängig in Einstellungen → Abgelehnte Dateien).
            </p>

            <div className="max-h-[46vh] overflow-y-auto border border-ghg-line rounded-lg divide-y divide-ghg-line">
              {sichtbar.length === 0 && (
                <p className="px-3 py-6 text-sm text-ghg-muted text-center">
                  {funde.length === 0 ? "In diesem Ordner liegen keine Videos." : "Alle Funde sind bereits in der Bibliothek."}
                </p>
              )}
              {sichtbar.map((h) => (
                <FundZeile
                  key={h.path}
                  hit={h}
                  wahl={wahl[h.path] ?? "offen"}
                  onWahl={(w) => setWahl((v) => ({ ...v, [h.path]: w }))}
                />
              ))}
            </div>
          </>
        )}

        <div className="flex justify-between items-center gap-2 pt-1">
          <span className="text-sm text-ghg-muted">
            {zählung.ja} übernehmen · {zählung.nein} ablehnen
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={() => void übernehmen()} disabled={speichert || laden}>
              {speichert ? <Spinner className="w-4 h-4" /> : <Check className="w-4 h-4" />} Auswahl übernehmen
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function FundZeile({ hit, wahl, onWahl }: { hit: FolderHit; wahl: Wahl; onWahl: (w: Wahl) => void }) {
  const [bild, setBild] = useState<string | null>(null);
  const [fehlt, setFehlt] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Vorschaubild erst holen, wenn die Zeile wirklich sichtbar wird — bei
  // hunderten Funden würde sonst für jede Datei sofort ffmpeg starten.
  useEffect(() => {
    if (bild || fehlt) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        void mitBremse(() => mediaThumbnail(hit.path, 240, 320))
          .then(setBild)
          .catch(() => setFehlt(true));
      },
      { rootMargin: "150px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hit.path, bild, fehlt]);

  const marke =
    hit.kind === "episode" && hit.season != null && hit.episode != null
      ? `S${String(hit.season).padStart(2, "0")}E${String(hit.episode).padStart(2, "0")}`
      : hit.year
        ? String(hit.year)
        : null;

  return (
    <div
      ref={ref}
      className={clsx(
        "flex gap-3 p-2.5 items-center transition",
        wahl === "ja" && "bg-emerald-500/10",
        wahl === "nein" && "bg-ghg-red/10 opacity-60",
      )}
    >
      <div className="w-28 aspect-video shrink-0 rounded-md overflow-hidden bg-ghg-bg2 flex items-center justify-center">
        {bild ? (
          <img src={bild} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[10px] text-ghg-muted px-1 text-center">{fehlt ? "kein Bild" : "…"}</span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">
          {marke && <span className="text-ghg-red mr-2">{marke}</span>}
          {hit.title || hit.name}
        </p>
        <p className="text-xs text-ghg-muted truncate" title={hit.path}>
          {hit.name}
        </p>
        <p className="text-[11px] text-ghg-muted mt-0.5 flex gap-2 flex-wrap">
          <span>{größe(hit.sizeBytes)}</span>
          {hit.inLibrary && <span className="text-emerald-400">bereits in der Bibliothek</span>}
          {hit.ignored && <span className="text-ghg-red">früher abgelehnt</span>}
        </p>
      </div>

      <div className="flex gap-1 shrink-0">
        <button
          onClick={() => onWahl(wahl === "ja" ? "offen" : "ja")}
          title="Übernehmen"
          className={clsx(
            "p-1.5 rounded-lg border transition",
            wahl === "ja"
              ? "bg-emerald-500 border-emerald-500 text-white"
              : "border-ghg-line text-ghg-muted hover:text-ghg-text hover:bg-ghg-surface2",
          )}
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={() => onWahl(wahl === "nein" ? "offen" : "nein")}
          title="Ablehnen (wird dauerhaft gemerkt)"
          className={clsx(
            "p-1.5 rounded-lg border transition",
            wahl === "nein"
              ? "bg-ghg-red border-ghg-red text-white"
              : "border-ghg-line text-ghg-muted hover:text-ghg-text hover:bg-ghg-surface2",
          )}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Kleiner Helfer für die Einstellungen: Liste der abgelehnten Dateien. */
export function IgnoredFilesList({
  paths,
  onUnignore,
}: {
  paths: string[];
  onUnignore: (p: string) => void;
}) {
  if (paths.length === 0) return <p className="text-sm text-ghg-muted">Nichts abgelehnt.</p>;
  return (
    <div className="max-h-56 overflow-y-auto border border-ghg-line rounded-lg divide-y divide-ghg-line">
      {paths.map((p) => (
        <div key={p} className="flex items-center gap-2 px-3 py-2">
          <span className="flex-1 text-xs truncate" title={p}>
            {p}
          </span>
          <button
            onClick={() => onUnignore(p)}
            title="Wieder zulassen (beim nächsten Scan aufnehmen)"
            className="p-1 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      ))}
    </div>
  );
}

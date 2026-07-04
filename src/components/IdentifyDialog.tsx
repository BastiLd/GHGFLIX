import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { identifyMovie, identifyShow, searchTmdb, setEpisodeNumbers } from "../lib/api";
import { posterUrl } from "../lib/img";
import { useStore } from "../lib/store";
import type { TmdbResult } from "../lib/types";
import { Button, Modal, Spinner, TextInput } from "./ui";

export type IdentifyTarget =
  | { type: "movie"; id: number; title: string }
  | { type: "show"; id: number; title: string }
  | { type: "episode"; id: number; season: number; episode: number; showTitle?: string };

export function IdentifyDialog({
  open,
  onClose,
  target,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  target: IdentifyTarget;
  onDone: () => void;
}) {
  const toast = useStore((s) => s.toast);
  const navigate = useNavigate();

  // movie/show search state
  const initialTitle = target.type === "episode" ? target.showTitle ?? "" : target.title;
  const [query, setQuery] = useState(initialTitle);
  const [searchKind, setSearchKind] = useState<"movie" | "tv">(target.type === "show" ? "tv" : "movie");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // permanent identity: re-applied on every rescan AND after "Bibliothek neu aufbauen"
  const [remember, setRemember] = useState(true);
  const debounceRef = useRef<number | null>(null);
  const searchSeq = useRef(0);

  // episode state
  const [season, setSeason] = useState(target.type === "episode" ? String(target.season) : "1");
  const [episode, setEpisode] = useState(target.type === "episode" ? String(target.episode) : "1");

  const runSearch = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    const seq = ++searchSeq.current;
    setLoading(true);
    try {
      const res = await searchTmdb(term, searchKind);
      if (seq === searchSeq.current) setResults(res); // ignore stale responses
    } catch (e) {
      if (seq === searchSeq.current) toast(String(e), "error");
    } finally {
      if (seq === searchSeq.current) setLoading(false);
    }
  };

  // Auto-search the moment the dialog opens and whenever the user flips
  // movie/series, so a forgotten "Suchen" click never looks like "no matches".
  useEffect(() => {
    if (!open || target.type === "episode") return;
    if (query.trim()) void runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, searchKind]);

  // live search while typing (debounced) — no need to press "Suchen" anymore
  const onQueryChange = (v: string) => {
    setQuery(v);
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => void runSearch(v), 450);
  };
  useEffect(
    () => () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    },
    [],
  );

  const apply = async (r: TmdbResult) => {
    const wantTv = searchKind === "tv";
    if (target.type === "movie" && !wantTv) {
      await run(async () => {
        await identifyMovie(target.id, r.tmdbId, remember);
      }, "Film zugeordnet");
    } else if (target.type === "show" && wantTv) {
      await run(async () => {
        const surviving = await identifyShow(target.id, r.tmdbId, remember);
        // identifying can merge this show into an existing entry → follow it
        if (surviving !== target.id) navigate(`/show/${surviving}`, { replace: true });
      }, "Serie zugeordnet");
    } else {
      toast(
        "Typänderung (Film ↔ Serie) wird in v1 nicht unterstützt. Lege die Datei in den passenden Bibliotheksordner.",
        "info",
      );
    }
  };

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg, "success");
      onDone();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const saveEpisode = () =>
    run(
      () => setEpisodeNumbers(target.id, parseInt(season || "0", 10), parseInt(episode || "0", 10)),
      "Folge aktualisiert",
    );

  const dialogTitle =
    target.type === "episode" ? "Folge zuordnen" : target.type === "show" ? "Serie identifizieren" : "Film identifizieren";

  return (
    <Modal open={open} onClose={onClose} title={dialogTitle} wide>
      {target.type === "episode" ? (
        <div className="space-y-4">
          <p className="text-sm text-ghg-muted">
            Lege fest, welche Staffel und Folge diese Datei ist. Die Metadaten werden beim nächsten Scan bzw. beim
            erneuten Identifizieren der Serie übernommen.
          </p>
          <div className="flex gap-4">
            <label className="flex-1">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Staffel</span>
              <TextInput value={season} onChange={setSeason} type="number" />
            </label>
            <label className="flex-1">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Folge</span>
              <TextInput value={episode} onChange={setEpisode} type="number" />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={saveEpisode} disabled={busy}>
              {busy ? <Spinner className="w-4 h-4" /> : "Speichern"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-1 bg-ghg-bg2 rounded-lg p-1 w-fit">
            {(["movie", "tv"] as const).map((k) => (
              <button
                key={k}
                onClick={() => setSearchKind(k)}
                className={clsx(
                  "px-4 py-1.5 rounded-md text-sm font-semibold transition",
                  searchKind === k ? "bg-ghg-red text-white" : "text-ghg-muted hover:text-ghg-text",
                )}
              >
                {k === "movie" ? "Film" : "Serie"}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <TextInput value={query} onChange={onQueryChange} placeholder="Titel suchen …" autoFocus onEnter={() => void runSearch()} />
            <Button onClick={() => void runSearch()} disabled={loading}>
              {loading ? <Spinner className="w-4 h-4" /> : "Suchen"}
            </Button>
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="w-4 h-4 accent-ghg-red"
            />
            <span className="text-sm">
              Zuordnung dauerhaft merken
              <span className="text-ghg-muted"> – wird bei jedem Scan und auch nach „Bibliothek neu aufbauen“ automatisch wieder angewendet</span>
            </span>
          </label>

          <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
            {results.map((r) => {
              const poster = posterUrl(r.posterPath, "w185");
              return (
                <div
                  key={`${r.mediaType}-${r.tmdbId}`}
                  className="flex gap-3 p-2 rounded-lg hover:bg-ghg-surface2 transition border border-transparent hover:border-ghg-line"
                >
                  <div className="w-14 h-20 shrink-0 rounded-md overflow-hidden bg-ghg-bg2">
                    {poster && <img src={poster} alt="" className="w-full h-full object-cover" draggable={false} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm">
                      {r.title} {r.year ? <span className="text-ghg-muted">({r.year})</span> : null}
                    </p>
                    <p className="text-xs text-ghg-muted line-clamp-3 mt-0.5">{r.overview || "Keine Beschreibung."}</p>
                  </div>
                  <Button variant="ghost" className="self-center" onClick={() => apply(r)} disabled={busy}>
                    Auswählen
                  </Button>
                </div>
              );
            })}
            {!loading && results.length === 0 && (
              <p className="text-sm text-ghg-muted text-center py-8">Suche nach einem Titel, um Treffer zu sehen.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { reassignEpisode, reassignSeason, searchTmdb } from "../lib/api";
import { posterUrl } from "../lib/img";
import { useStore } from "../lib/store";
import type { TmdbResult } from "../lib/types";
import { Button, Modal, Spinner, TextInput } from "./ui";

/** "This season/episode actually belongs to a DIFFERENT series." Searches TMDb
 *  for the correct show and moves the episodes onto it. The move is remembered
 *  per file, so it survives rescans and "Bibliothek neu aufbauen". */
export type ReassignTarget =
  | { kind: "season"; showId: number; season: number; showTitle: string }
  | { kind: "episode"; episodeId: number; season: number; episode: number; showTitle: string };

export function ReassignDialog({
  open,
  onClose,
  target,
  suggest,
}: {
  open: boolean;
  onClose: () => void;
  target: ReassignTarget;
  /** prefill the search box (usually the current show title) */
  suggest?: string;
}) {
  const toast = useStore((s) => s.toast);
  const navigate = useNavigate();
  const [query, setQuery] = useState(suggest ?? target.showTitle ?? "");
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const debounce = useRef<number | null>(null);

  const runSearch = async (q?: string) => {
    const term = (q ?? query).trim();
    if (!term) return;
    const s = ++seq.current;
    setLoading(true);
    try {
      const res = await searchTmdb(term, "tv");
      if (s === seq.current) setResults(res);
    } catch (e) {
      if (s === seq.current) toast(String(e), "error");
    } finally {
      if (s === seq.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void runSearch(suggest ?? target.showTitle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onQuery = (v: string) => {
    setQuery(v);
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => void runSearch(v), 400);
  };
  useEffect(() => () => void (debounce.current && window.clearTimeout(debounce.current)), []);

  const choose = async (r: TmdbResult) => {
    setBusy(true);
    try {
      let surviving: number;
      if (target.kind === "season") {
        surviving = await reassignSeason(target.showId, target.season, r.tmdbId);
        toast(`Staffel ${target.season} zu „${r.title}" verschoben`, "success");
      } else {
        surviving = await reassignEpisode(target.episodeId, r.tmdbId, target.season, target.episode);
        toast(`Folge zu „${r.title}" verschoben`, "success");
      }
      onClose();
      navigate(`/show/${surviving}`, { replace: true });
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const title =
    target.kind === "season" ? `Staffel ${target.season} zu anderer Serie verschieben` : "Folge zu anderer Serie verschieben";

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="space-y-4">
        <p className="text-sm text-ghg-muted">
          Wähle die <span className="text-ghg-text">richtige Serie</span>. Die
          {target.kind === "season" ? " ganze Staffel" : " Folge"} wird dorthin verschoben und bleibt es dauerhaft –
          auch nach „Bibliothek neu aufbauen". Dein Gesehen-Stand wandert mit.
        </p>
        <div className="flex gap-2">
          <TextInput value={query} onChange={onQuery} placeholder="Richtige Serie suchen …" autoFocus onEnter={() => void runSearch()} />
          <Button onClick={() => void runSearch()} disabled={loading}>
            {loading ? <Spinner className="w-4 h-4" /> : "Suchen"}
          </Button>
        </div>
        <div className="space-y-2 max-h-[52vh] overflow-y-auto pr-1 min-h-[8rem]">
          {results.map((r) => {
            const poster = posterUrl(r.posterPath, "w185");
            return (
              <button
                key={r.tmdbId}
                onClick={() => void choose(r)}
                disabled={busy}
                className="w-full flex gap-3 p-2 rounded-lg text-left transition border border-transparent hover:bg-ghg-surface2 hover:border-ghg-red/50 disabled:opacity-50"
              >
                <div className="w-12 h-18 shrink-0 rounded-md overflow-hidden bg-ghg-bg2" style={{ height: "4.5rem" }}>
                  {poster && <img src={poster} alt="" className="w-full h-full object-cover" draggable={false} />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-sm">
                    {r.title} {r.year ? <span className="text-ghg-muted">({r.year})</span> : null}
                  </p>
                  <p className="text-xs text-ghg-muted line-clamp-2 mt-0.5">{r.overview || "Keine Beschreibung."}</p>
                </div>
                <span className="self-center text-xs font-semibold text-ghg-muted px-2 shrink-0">Hierher</span>
              </button>
            );
          })}
          {!loading && results.length === 0 && (
            <p className="text-sm text-ghg-muted text-center py-8">Suche nach der richtigen Serie.</p>
          )}
        </div>
      </div>
    </Modal>
  );
}

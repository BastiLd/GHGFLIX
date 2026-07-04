import clsx from "clsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  assignEpisodesSequential,
  identifyMovie,
  identifyShow,
  searchTmdb,
  setEpisodeNumbers,
  tmdbSeasonList,
  type TmdbEpisodeInfo,
} from "../lib/api";
import { posterUrl } from "../lib/img";
import { useStore } from "../lib/store";
import type { TmdbResult } from "../lib/types";
import { Button, Modal, Spinner, TextInput } from "./ui";

export type IdentifyTarget =
  | { type: "movie"; id: number; title: string }
  | { type: "show"; id: number; title: string }
  | {
      type: "episode";
      id: number;
      season: number;
      episode: number;
      showTitle?: string;
      showId?: number;
      showTmdbId?: number | null;
    };

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
  const [season, setSeason] = useState(target.type === "episode" ? String(Math.max(1, target.season)) : "1");
  const [episode, setEpisode] = useState(target.type === "episode" ? String(Math.max(1, target.episode)) : "1");
  const [seasonEps, setSeasonEps] = useState<TmdbEpisodeInfo[]>([]);
  const [sequential, setSequential] = useState(false);
  // when the show itself is unmatched, the dialog can flip into show-identify mode
  const [identifyShowFirst, setIdentifyShowFirst] = useState(false);
  const showTmdbId = target.type === "episode" ? target.showTmdbId ?? null : null;

  // load the REAL episode list of the chosen season from TMDb, so the user picks
  // the actual episode by name instead of blindly typing numbers
  useEffect(() => {
    if (!open || target.type !== "episode" || !showTmdbId) return;
    const s = parseInt(season || "1", 10) || 1;
    let stale = false;
    tmdbSeasonList(showTmdbId, s)
      .then((eps) => {
        if (!stale) setSeasonEps(eps);
      })
      .catch(() => {
        if (!stale) setSeasonEps([]);
      });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, season, showTmdbId]);

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
    if (target.type === "episode" && wantTv && target.showId) {
      // identify the parent show from inside the episode dialog
      await run(async () => {
        const surviving = await identifyShow(target.showId!, r.tmdbId, remember);
        if (surviving !== target.showId) navigate(`/show/${surviving}`, { replace: true });
      }, "Serie zugeordnet – öffne die Folge jetzt erneut zum Zuordnen");
      return;
    }
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

  const saveEpisode = () => {
    const s = parseInt(season || "0", 10);
    const e = parseInt(episode || "0", 10);
    if (sequential) {
      return run(async () => {
        const n = await assignEpisodesSequential(target.id, s, e);
        toast(`${n} Folgen fortlaufend zugeordnet – Titel & Bilder werden geladen`, "success");
      }, "Folgen zugeordnet");
    }
    return run(() => setEpisodeNumbers(target.id, s, e), "Folge aktualisiert – Titel & Bild werden geladen");
  };

  const dialogTitle =
    target.type === "episode"
      ? identifyShowFirst
        ? "Serie identifizieren"
        : "Folge zuordnen"
      : target.type === "show"
        ? "Serie identifizieren"
        : "Film identifizieren";

  return (
    <Modal open={open} onClose={onClose} title={dialogTitle} wide>
      {target.type === "episode" && !identifyShowFirst ? (
        <div className="space-y-4">
          {!showTmdbId ? (
            <div className="bg-ghg-bg2 border border-ghg-line rounded-xl p-4 space-y-3">
              <p className="text-sm">
                Die Serie <span className="font-semibold">{target.showTitle || ""}</span> ist noch keiner TMDb-Serie
                zugeordnet. Ordne zuerst die Serie zu – danach kannst du hier die echten Folgen mit Namen auswählen.
              </p>
              {target.showId ? (
                <Button
                  onClick={() => {
                    setIdentifyShowFirst(true);
                    setSearchKind("tv");
                    setQuery(target.showTitle || query);
                    setTimeout(() => void runSearch(target.showTitle || query), 0);
                  }}
                >
                  Serie jetzt identifizieren
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ghg-muted">
              Wähle Staffel und die <span className="text-ghg-text">echte Folge</span> (mit Titel) aus TMDb. Titel,
              Beschreibung und Bild werden sofort übernommen.
            </p>
          )}
          <div className="flex gap-4">
            <label className="w-28 shrink-0">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Staffel</span>
              <TextInput value={season} onChange={setSeason} type="number" />
            </label>
            {showTmdbId && seasonEps.length > 0 ? (
              <label className="flex-1 min-w-0">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Folge (echte Titel aus TMDb)</span>
                <select
                  value={episode}
                  onChange={(e) => setEpisode(e.target.value)}
                  className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
                >
                  {seasonEps.map((ep) => (
                    <option key={ep.episode} value={String(ep.episode)}>
                      E{String(ep.episode).padStart(2, "0")} · {ep.title || "Ohne Titel"}
                      {ep.airDate ? ` (${ep.airDate.slice(0, 4)})` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex-1">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Folge</span>
                <TextInput value={episode} onChange={setEpisode} type="number" />
              </label>
            )}
          </div>
          <label className="flex items-start gap-2.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={sequential}
              onChange={(e) => setSequential(e.target.checked)}
              className="w-4 h-4 accent-ghg-red mt-0.5"
            />
            <span className="text-sm">
              Das ist die gewählte Folge – <span className="font-semibold">alle folgenden Dateien automatisch fortlaufend zuordnen</span>
              <span className="text-ghg-muted block text-xs mt-0.5">
                Die Dateien nach dieser (in Dateireihenfolge) werden E{parseInt(episode || "1", 10) + 1}, E
                {parseInt(episode || "1", 10) + 2} … und laufen automatisch in die nächste Staffel über. Alle bekommen
                ihre echten Titel und Bilder.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={saveEpisode} disabled={busy}>
              {busy ? <Spinner className="w-4 h-4" /> : sequential ? "Ab hier zuordnen" : "Speichern"}
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

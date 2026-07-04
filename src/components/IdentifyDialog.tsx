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
  tmdbSeasonNumbers,
  type TmdbEpisodeInfo,
} from "../lib/api";
import { posterUrl, stillUrl } from "../lib/img";
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
  const [season, setSeason] = useState(target.type === "episode" ? Math.max(1, target.season) : 1);
  const [episode, setEpisode] = useState(target.type === "episode" ? Math.max(1, target.episode) : 1);
  const [seasonEps, setSeasonEps] = useState<TmdbEpisodeInfo[]>([]);
  const [seasonNums, setSeasonNums] = useState<number[]>([]);
  const [epsLoading, setEpsLoading] = useState(false);
  const [sequential, setSequential] = useState(false);
  // when the show itself is unmatched, the dialog can flip into show-identify mode
  const [identifyShowFirst, setIdentifyShowFirst] = useState(false);
  const showTmdbId = target.type === "episode" ? target.showTmdbId ?? null : null;

  // load the show's real season numbers once (so the dropdown offers only valid seasons)
  useEffect(() => {
    if (!open || target.type !== "episode" || !showTmdbId) return;
    let stale = false;
    tmdbSeasonNumbers(showTmdbId)
      .then((nums) => {
        if (stale || nums.length === 0) return;
        setSeasonNums(nums);
        // snap to a real season if the detected one doesn't exist on TMDb
        if (!nums.includes(season)) setSeason(nums[0]);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, showTmdbId]);

  // load the REAL episode list (name + still image) of the chosen season so the
  // user picks the actual episode visually instead of typing blind numbers
  useEffect(() => {
    if (!open || target.type !== "episode" || !showTmdbId) return;
    let stale = false;
    setEpsLoading(true);
    tmdbSeasonList(showTmdbId, season)
      .then((eps) => {
        if (!stale) setSeasonEps(eps);
      })
      .catch(() => {
        if (!stale) setSeasonEps([]);
      })
      .finally(() => {
        if (!stale) setEpsLoading(false);
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

  // assign THIS file to a concrete episode number (from the clicked list item or
  // the number field). With "sequential" on, everything after it follows.
  const assignTo = (ep: number) => {
    if (sequential) {
      return run(async () => {
        const n = await assignEpisodesSequential(target.id, season, ep);
        toast(`${n} Folgen ab hier zugeordnet – Titel & Bilder werden geladen`, "success");
      }, "Folgen zugeordnet");
    }
    return run(
      () => setEpisodeNumbers(target.id, season, ep),
      "Folge zugeordnet – Titel & Bild übernommen",
    );
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
        !showTmdbId ? (
          <div className="bg-ghg-bg2 border border-ghg-line rounded-xl p-4 space-y-3">
            <p className="text-sm">
              Die Serie <span className="font-semibold">{target.showTitle || ""}</span> ist noch keiner TMDb-Serie
              zugeordnet. Ordne zuerst die Serie zu – danach kannst du hier die echten Folgen mit Bild und Namen anklicken.
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
          <div className="space-y-3">
            {/* season picker + sequential toggle, fixed at the top */}
            <div className="flex items-end gap-4 flex-wrap">
              <label className="w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Staffel</span>
                {seasonNums.length > 0 ? (
                  <select
                    value={season}
                    onChange={(e) => setSeason(parseInt(e.target.value, 10))}
                    className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
                  >
                    {seasonNums.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? "Specials" : `Staffel ${n}`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <TextInput
                    value={String(season)}
                    onChange={(v) => setSeason(Math.max(0, parseInt(v || "1", 10) || 1))}
                    type="number"
                  />
                )}
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none pb-2">
                <input
                  type="checkbox"
                  checked={sequential}
                  onChange={(e) => setSequential(e.target.checked)}
                  className="w-4 h-4 accent-ghg-red"
                />
                <span className="text-sm">Ab der gewählten Folge alle weiteren Dateien fortlaufend zuordnen</span>
              </label>
            </div>

            <p className="text-sm text-ghg-muted">
              Klick die Folge an, die dieser Datei entspricht – Titel, Beschreibung und Bild werden direkt übernommen.
              {sequential && (
                <span className="text-ghg-text"> Alle Dateien danach werden automatisch weiternummeriert.</span>
              )}
            </p>

            {/* the real TMDb episodes as a clickable list with still thumbnails */}
            <div className="space-y-1.5 max-h-[52vh] overflow-y-auto pr-1 min-h-[8rem]">
              {epsLoading && (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-ghg-muted">
                  <Spinner className="w-5 h-5" /> Folgen werden geladen …
                </div>
              )}
              {!epsLoading && seasonEps.length === 0 && (
                <div className="py-8 text-center text-sm text-ghg-muted">
                  Für diese Staffel wurden keine Folgen gefunden.
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <span>Nummer manuell:</span>
                    <input
                      type="number"
                      defaultValue={episode}
                      onChange={(e) => setEpisode(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                      className="w-20 bg-ghg-bg2 border border-ghg-line rounded-lg px-2 py-1 text-sm"
                    />
                    <Button onClick={() => void assignTo(episode)} disabled={busy}>
                      {busy ? <Spinner className="w-4 h-4" /> : "Zuordnen"}
                    </Button>
                  </div>
                </div>
              )}
              {!epsLoading &&
                seasonEps.map((ep) => {
                  const still = stillUrl(ep.stillPath, "w300");
                  const isCurrent = ep.episode === target.episode && season === target.season;
                  return (
                    <button
                      key={ep.episode}
                      onClick={() => void assignTo(ep.episode)}
                      disabled={busy}
                      className={clsx(
                        "w-full flex gap-3 p-2 rounded-lg text-left transition border disabled:opacity-50",
                        "hover:bg-ghg-surface2 hover:border-ghg-red/50",
                        isCurrent ? "border-ghg-red/40 bg-ghg-red/5" : "border-transparent",
                      )}
                    >
                      <div className="w-28 aspect-video shrink-0 rounded-md overflow-hidden bg-ghg-bg2 relative">
                        {still ? (
                          <img src={still} alt="" className="w-full h-full object-cover" draggable={false} loading="lazy" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-ghg-muted text-xs">
                            E{String(ep.episode).padStart(2, "0")}
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 py-0.5">
                        <p className="text-sm font-semibold">
                          <span className="text-ghg-red mr-1.5">E{String(ep.episode).padStart(2, "0")}</span>
                          {ep.title || "Ohne Titel"}
                          {ep.airDate ? <span className="text-ghg-muted font-normal"> · {ep.airDate.slice(0, 4)}</span> : null}
                        </p>
                        <p className="text-xs text-ghg-muted line-clamp-2 mt-0.5">{ep.overview || "Keine Beschreibung."}</p>
                      </div>
                      <span className="self-center shrink-0 text-xs font-semibold text-ghg-muted px-2">
                        {sequential ? "Ab hier →" : "Wählen"}
                      </span>
                    </button>
                  );
                })}
            </div>

            <div className="flex justify-end pt-1">
              <Button variant="ghost" onClick={onClose}>
                Schließen
              </Button>
            </div>
          </div>
        )
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

import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Check, ImageIcon, MoreVertical, Pencil, Play, Plus, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { listShows } from "../lib/api";
import { ShowCardItem } from "../components/cards";
import { MediaRow } from "../components/MediaRow";
import { detectIntros, getSeasonArt, getShowDetail, listFavorites, listProgress, mediaThumbnail, repairSeasonTitles, revealInExplorer, setSeasonWatched, setShowIntro, setShowWatched, setWatched, toggleFavorite } from "../lib/api";
import { openCtx } from "../lib/contextmenu";
import { enqueueSeasonRest, playback } from "../lib/playback";
import { useUiPrefs } from "../lib/uiPrefs";
import { certAllowed, formatRuntime, formatTime, parseGenres, quality, ratingText, seasonEpisodeLabel } from "../lib/format";
import { backdropUrl, posterUrl, stillUrl } from "../lib/img";
import { useStore } from "../lib/store";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { Extras } from "../components/Extras";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { ReassignDialog, type ReassignTarget } from "../components/ReassignDialog";
import { Button, EmptyState, Modal, SkeletonDetail, TextInput } from "../components/ui";
import type { ArtworkTarget, Episode, Progress } from "../lib/types";

export default function ShowDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const profileId = useStore((s) => s.profileId);
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);
  const [artwork, setArtwork] = useState<ArtworkTarget | null>(null);
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);
  const [introDialog, setIntroDialog] = useState(false);
  const [introFrom, setIntroFrom] = useState("0");
  const [introTo, setIntroTo] = useState("60");
  const [reassign, setReassign] = useState<ReassignTarget | null>(null);
  const [artworkTab, setArtworkTab] = useState<"poster" | "backdrop" | undefined>(undefined);

  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  const detail = useQuery({ queryKey: ["show", sid], queryFn: () => getShowDetail(sid) });
  const seasonArtQ = useQuery({ queryKey: ["seasonArt", sid], queryFn: () => getSeasonArt(sid) });
  const seasonArt = useMemo(() => new Map(seasonArtQ.data ?? []), [seasonArtQ.data]);
  const prog = useQuery({ queryKey: ["progress", "list", profileId], queryFn: () => listProgress(profileId) });
  const allShowsQ = useQuery({ queryKey: ["shows"], queryFn: listShows });
  const kidsMaxCert = useUiPrefs((s) => s.kidsMaxCert);

  const similar = useMemo(() => {
    const me = detail.data?.show;
    if (!me) return [];
    const mine = new Set(parseGenres(me.genres));
    if (mine.size === 0) return [];
    return (allShowsQ.data ?? [])
      .filter((x) => x.id !== me.id && (me.tmdbId == null || x.tmdbId !== me.tmdbId))
      .filter((x) => certAllowed(x.cert, kidsMaxCert)) // Kindersicherung gilt überall
      .map((x) => ({ s: x, overlap: parseGenres(x.genres).filter((g) => mine.has(g)).length }))
      .filter((x) => x.overlap >= 1)
      .sort((a, b) => b.overlap - a.overlap || (b.s.rating ?? 0) - (a.s.rating ?? 0))
      .slice(0, 12)
      .map((x) => x.s);
  }, [detail.data, allShowsQ.data, kidsMaxCert]);
  const favs = useQuery({ queryKey: ["favorites", profileId], queryFn: () => listFavorites(profileId) });
  const isFav = (favs.data ?? []).some((f) => f.mediaType === "show" && f.refId === sid);
  const toggleFav = () =>
    void toggleFavorite(profileId, "show", sid).then(() => qc.invalidateQueries({ queryKey: ["favorites"] }));
  // every watched-mutation must refresh the progress-derived UI (badges, bar,
  // "Fortsetzen", season checkmarks) — don't rely solely on the backend event
  const refreshProgress = () => {
    qc.invalidateQueries({ queryKey: ["progress"] });
    qc.invalidateQueries({ queryKey: ["continue"] });
    qc.invalidateQueries({ queryKey: ["recentlyWatched"] });
  };
  const markShowWatched = () =>
    void setShowWatched(profileId, sid, true).then(() => {
      refreshProgress();
      toast("Serie als gesehen markiert", "success");
    });

  const progMap = useMemo(() => {
    const map = new Map<number, Progress>();
    (prog.data ?? []).filter((p) => p.mediaType === "episode").forEach((p) => map.set(p.refId, p));
    return map;
  }, [prog.data]);

  const seasons = detail.data?.seasons ?? [];

  // Initial season tab: ?season=N in the URL (set by the player's back button)
  // wins, then the last tab the user had open on THIS show, then the first
  // season — so coming back from S6E3 lands on Staffel 6, never Staffel 1.
  useEffect(() => {
    if (selectedSeason === null && seasons.length > 0) {
      const has = (n: number) => seasons.some((s) => s.season === n);
      const fromUrl = parseInt(searchParams.get("season") ?? "", 10);
      const fromLast = parseInt(sessionStorage.getItem(`ghgflix.season.${sid}`) ?? "", 10);
      const firstReal = seasons.find((s) => s.season > 0) ?? seasons[0];
      const pick = has(fromUrl) ? fromUrl : has(fromLast) ? fromLast : firstReal.season;
      setSelectedSeason(pick);
    }
  }, [seasons, selectedSeason, searchParams, sid]);

  // remember the open tab so plain browser-back also restores it
  useEffect(() => {
    if (selectedSeason !== null) sessionStorage.setItem(`ghgflix.season.${sid}`, String(selectedSeason));
  }, [selectedSeason, sid]);

  if (detail.isLoading) return <SkeletonDetail />;

  if (!detail.data) return <EmptyState title="Serie nicht gefunden" />;

  const { show } = detail.data;
  const genres = parseGenres(show.genres);
  const rating = ratingText(show.rating);
  const currentSeason = seasons.find((s) => s.season === selectedSeason);
  // watched progress across the whole show
  const watchedCount = seasons.flatMap((s) => s.episodes).filter((e) => progMap.get(e.id)?.watched).length;
  const totalCount = seasons.reduce((n, s) => n + s.episodes.length, 0);
  const seasonAllWatched = (season: number) => {
    const eps = seasons.find((s) => s.season === season)?.episodes ?? [];
    return eps.length > 0 && eps.every((e) => progMap.get(e.id)?.watched);
  };
  const statusLabel =
    show.status === "Ended" ? "Beendet" : show.status === "Canceled" ? "Abgesetzt" : show.status ? "Laufend" : null;
  const yearRange =
    show.year && show.lastYear && show.lastYear !== show.year ? `${show.year}–${show.lastYear}` : show.year ? String(show.year) : null;

  const saveIntroWindow = async () => {
    const from = parseFloat(introFrom || "0") || 0;
    const to = parseFloat(introTo || "0") || 0;
    if (to <= from + 2) {
      toast("Intro-Ende muss nach dem Start liegen", "error");
      return;
    }
    await setShowIntro(sid, from, to).catch((e) => toast(String(e), "error"));
    toast(`Intro festgelegt (${formatTime(from)} – ${formatTime(to)}) – gilt für alle Folgen ohne eigene Erkennung`, "success");
    setIntroDialog(false);
  };

  const playRandom = () => {
    const eps = seasons.flatMap((s) => s.episodes);
    if (eps.length === 0) return;
    const pick = eps[Math.floor(Math.random() * eps.length)];
    navigate(`/play/episode/${pick.id}`);
  };

  // first not-yet-finished episode — an episode with a tiny bit of progress
  // (<30s) counts as unwatched too (the old check skipped those by mistake)
  const allEpisodes = seasons.flatMap((s) => s.episodes);
  const nextEpisode = allEpisodes.find((e) => !progMap.get(e.id)?.watched) ?? allEpisodes[0];
  const nextStarted = nextEpisode ? (progMap.get(nextEpisode.id)?.positionSec ?? 0) > 30 : false;
  const anyProgress = allEpisodes.some((e) => progMap.has(e.id));

  return (
    <div className="relative pb-12">
      <div className="relative h-[42vh] min-h-[300px]">
        {backdropUrl(show.backdropPath) ? (
          <img src={backdropUrl(show.backdropPath)!} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ghg-surface2 to-ghg-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ghg-bg via-ghg-bg/50 to-transparent" />
        <button
          onClick={() => navigate("/shows")}
          title="Zur Übersicht"
          className="absolute top-5 left-5 p-2 rounded-lg bg-black/50 hover:bg-ghg-red transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="px-10 -mt-32 relative flex gap-8">
        <div className="w-52 shrink-0 aspect-[2/3] rounded-xl overflow-hidden border border-ghg-line shadow-2xl bg-ghg-bg2">
          {posterUrl(show.posterPath, "w500") ? (
            // object-contain: a custom image in a different aspect ratio is
            // letterboxed instead of cropped ("nichts wird abgeschnitten")
            <img src={posterUrl(show.posterPath, "w500")!} alt="" className="w-full h-full object-contain" />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-3 text-center text-ghg-muted">{show.title}</div>
          )}
        </div>

        <div className="flex-1 pt-32">
          <h1 className="text-4xl font-black text-glow">{show.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-ghg-muted flex-wrap">
            {yearRange && <span>{yearRange}</span>}
            <span>· {show.seasonCount} Staffeln · {show.episodeCount} Folgen</span>
            {show.runtime ? <span>· ~{show.runtime} Min/Folge</span> : null}
            {rating && (
              <span className="flex items-center gap-1">
                · <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" /> {rating}
              </span>
            )}
            {statusLabel && (
              <span
                className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${statusLabel === "Laufend" ? "border-emerald-500/50 text-emerald-400" : "border-ghg-line text-ghg-muted"}`}
              >
                {statusLabel}
              </span>
            )}
            {show.cert && (
              <span className="px-2 py-0.5 rounded border border-ghg-line text-[11px] font-semibold" title="Altersfreigabe">
                {show.cert}
              </span>
            )}
            {!show.tmdbId && <span className="zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase">Nicht erkannt</span>}
          </div>

          {/* watched progress */}
          {totalCount > 0 && watchedCount > 0 && (
            <div className="mt-3 max-w-sm">
              <div className="flex justify-between text-xs text-ghg-muted mb-1">
                <span>{watchedCount} / {totalCount} Folgen gesehen</span>
                <span>{Math.round((watchedCount / totalCount) * 100)}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-ghg-surface2 overflow-hidden">
                <div className="h-full bg-ghg-red rounded-full" style={{ width: `${(watchedCount / totalCount) * 100}%` }} />
              </div>
            </div>
          )}

          {genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {genres.map((g) => (
                <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-ghg-surface2 border border-ghg-line text-ghg-muted">
                  {g}
                </span>
              ))}
            </div>
          )}

          <p className="mt-4 max-w-3xl text-ghg-text/80 leading-relaxed line-clamp-4">
            {show.overview || "Keine Beschreibung verfügbar."}
          </p>

          <div className="flex gap-3 mt-6 flex-wrap">
            {nextEpisode && (
              <Button onClick={() => navigate(`/play/episode/${nextEpisode.id}`)}>
                <Play className="w-4 h-4 fill-white" />{" "}
                {nextStarted || anyProgress
                  ? `Fortsetzen · ${seasonEpisodeLabel(nextEpisode.season, nextEpisode.episode)}`
                  : "Abspielen"}
              </Button>
            )}
            <Button variant="ghost" onClick={toggleFav}>
              {isFav ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Meine Liste
            </Button>
            {watchedCount < totalCount && (
              <Button variant="ghost" onClick={markShowWatched}>
                <Check className="w-4 h-4" /> Alle gesehen
              </Button>
            )}
            {watchedCount > 0 && (
              <Button
                variant="ghost"
                onClick={() =>
                  void setShowWatched(profileId, sid, false).then(() => {
                    refreshProgress();
                    toast("Serie als ungesehen markiert", "success");
                  })
                }
              >
                Alle ungesehen
              </Button>
            )}
            <Button
              variant="ghost"
              onClick={() =>
                void enqueueSeasonRest(profileId, sid, show.title, null, null).then((n) =>
                  toast(n > 0 ? `${n} ungesehene Folgen in die Warteschlange gelegt` : "Keine ungesehenen Folgen", n > 0 ? "success" : "info"),
                )
              }
            >
              + Warteschlange
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setArtworkTab("poster");
                setArtwork({ target: "show", id: show.id, tmdbId: show.tmdbId, title: show.title });
              }}
            >
              <ImageIcon className="w-4 h-4" /> Poster ändern
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setArtworkTab("backdrop");
                setArtwork({ target: "show", id: show.id, tmdbId: show.tmdbId, title: show.title });
              }}
            >
              <ImageIcon className="w-4 h-4" /> Banner ändern
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                // open the show's folder on disk: parent of the current season
                // folder (falls back to the season folder for flat layouts)
                const ep = seasons.find((s) => s.season === selectedSeason)?.episodes[0] ?? seasons[0]?.episodes[0];
                if (!ep) return;
                const parts = ep.path.split("\\");
                const dir = parts.length > 3 ? parts.slice(0, -2).join("\\") : parts.slice(0, -1).join("\\");
                void revealInExplorer(dir).catch((e) => toast(String(e), "error"));
              }}
            >
              Ordner öffnen
            </Button>
            <Button variant="ghost" onClick={() => setIdentify({ type: "show", id: show.id, title: show.title })}>
              <Pencil className="w-4 h-4" /> Identifizieren
            </Button>
            <Button
              variant="ghost"
              onClick={() => void detectIntros(show.id).then(() => toast("Intro-Erkennung gestartet", "info")).catch((e) => toast(String(e), "error"))}
            >
              Intros erkennen
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setIntroFrom(show.introStart != null ? String(Math.round(show.introStart)) : "0");
                setIntroTo(show.introEnd != null ? String(Math.round(show.introEnd)) : "60");
                setIntroDialog(true);
              }}
            >
              Intro festlegen
            </Button>
            <Button variant="ghost" onClick={playRandom}>
              🎲 Zufällige Folge
            </Button>
          </div>
        </div>
      </div>

      {/* season tabs */}
      <div className="px-10 mt-10">
        <div className="flex gap-2 flex-wrap mb-5">
          {seasons.map((s) => (
            <button
              key={s.season}
              onClick={() => setSelectedSeason(s.season)}
              className={clsx(
                "px-4 py-2 rounded-lg text-sm font-semibold transition",
                selectedSeason === s.season
                  ? "bg-ghg-red text-white"
                  : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
              )}
            >
              {s.season === 0 ? "Specials" : `Staffel ${s.season}`}
              {seasonAllWatched(s.season) && <Check className="w-3.5 h-3.5 inline-block ml-1.5 -mt-0.5" />}
            </button>
          ))}
        </div>

        {currentSeason && selectedSeason !== null && (
          <div className="flex items-center gap-3 mb-4">
            {seasonArt.get(selectedSeason) && (
              <img
                src={posterUrl(seasonArt.get(selectedSeason), "w185")!}
                alt=""
                className="w-10 rounded-md object-cover border border-ghg-line"
                style={{ height: "3.75rem" }}
              />
            )}
            <h3 className="text-lg font-bold">
              {selectedSeason === 0 ? "Specials" : `Staffel ${selectedSeason}`}
              <span className="text-ghg-muted font-normal text-sm ml-2">{currentSeason.episodes.length} Folgen</span>
            </h3>
            <button
              onClick={() => {
                const allSeen = seasonAllWatched(selectedSeason);
                void setSeasonWatched(profileId, show.id, selectedSeason, !allSeen).then(() => {
                  refreshProgress();
                  toast(allSeen ? "Staffel als ungesehen markiert" : "Staffel als gesehen markiert", "success");
                });
              }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              <Check className="w-4 h-4" /> {seasonAllWatched(selectedSeason) ? "Staffel ungesehen" : "Staffel gesehen"}
            </button>
            <button
              onClick={() =>
                void enqueueSeasonRest(profileId, show.id, show.title, selectedSeason, null).then((n) =>
                  toast(
                    n > 0 ? `Staffel ${selectedSeason}: ${n} Folgen in die Warteschlange gelegt` : "Keine ungesehenen Folgen in dieser Staffel",
                    n > 0 ? "success" : "info",
                  ),
                )
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              + Warteschlange
            </button>
            <button
              onClick={() =>
                setReassign({ kind: "season", showId: show.id, season: selectedSeason, showTitle: show.title })
              }
              title="Diese Staffel gehört eigentlich zu einer anderen Serie"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              <Pencil className="w-4 h-4" /> Staffel → andere Serie
            </button>
            <button
              onClick={() => {
                toast("Titel-Abgleich läuft – Dateinamen werden mit den echten Folgentiteln verglichen …", "info");
                void repairSeasonTitles(show.id, selectedSeason)
                  .then(([m, t]) =>
                    toast(
                      m > 0
                        ? `${m} von ${t} Folgen anhand der Titel korrigiert (bleibt dauerhaft)`
                        : "Keine eindeutigen Titel-Treffer in den Dateinamen gefunden",
                      m > 0 ? "success" : "info",
                    ),
                  )
                  .catch((e) => toast(String(e), "error"));
              }}
              title="Folgen-Nummern anhand der ECHTEN Titel in den Dateinamen korrigieren (wenn SxxEyy im Dateinamen falsch ist)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              Titel-Abgleich
            </button>
            <button
              onClick={() => {
                const ep = currentSeason?.episodes[0];
                if (!ep) return;
                const dir = ep.path.split("\\").slice(0, -1).join("\\");
                void revealInExplorer(dir).catch((e) => toast(String(e), "error"));
              }}
              title="Staffel-Ordner im Explorer öffnen"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              Ordner
            </button>
            <button
              onClick={() =>
                setArtwork({
                  target: "season",
                  id: show.id,
                  tmdbId: show.tmdbId,
                  season: selectedSeason,
                  title: show.title,
                })
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
            >
              <ImageIcon className="w-4 h-4" /> Staffelbild ändern
            </button>
          </div>
        )}

        <div className="space-y-2">
          {currentSeason?.episodes.map((ep) => (
            <EpisodeRow
              key={ep.id}
              ep={ep}
              showTitle={show.title}
              progress={progMap.get(ep.id)}
              onToggleWatched={(w) =>
                void setWatched(profileId, "episode", ep.id, w).then(() => {
                  refreshProgress();
                  toast(w ? "Als gesehen markiert" : "Als ungesehen markiert", "success");
                })
              }
              onPlay={() => navigate(`/play/episode/${ep.id}`)}
              onIdentify={() =>
                setIdentify({
                  type: "episode",
                  id: ep.id,
                  season: ep.season,
                  episode: ep.episode,
                  showTitle: show.title,
                  showId: show.id,
                  showTmdbId: show.tmdbId,
                })
              }
              onArtwork={() =>
                setArtwork({
                  target: "episode",
                  id: ep.id,
                  tmdbId: show.tmdbId,
                  season: ep.season,
                  episode: ep.episode,
                  title: `${seasonEpisodeLabel(ep.season, ep.episode)}${ep.title ? " · " + ep.title : ""}`,
                })
              }
              onReassign={() =>
                setReassign({
                  kind: "episode",
                  episodeId: ep.id,
                  season: ep.season,
                  episode: ep.episode,
                  showTitle: show.title,
                })
              }
            />
          ))}
        </div>
      </div>

      <div className="px-10 mt-10">
        <Extras mediaType="tv" tmdbId={show.tmdbId} />
      </div>

      {similar.length >= 3 && (
        <div className="mt-8">
          <MediaRow title="Ähnliche Serien aus deiner Bibliothek">
            {similar.map((s) => (
              <ShowCardItem key={s.id} show={s} onIdentify={setIdentify} />
            ))}
          </MediaRow>
        </div>
      )}

      {identify && (
        <IdentifyDialog open onClose={() => setIdentify(null)} target={identify} onDone={() => {}} />
      )}

      {artwork && (
        <ArtworkDialog
          open
          onClose={() => {
            setArtwork(null);
            setArtworkTab(undefined);
          }}
          target={artwork}
          initialTab={artworkTab}
        />
      )}

      {reassign && (
        <ReassignDialog open onClose={() => setReassign(null)} target={reassign} suggest={show.title} />
      )}

      <Modal open={introDialog} onClose={() => setIntroDialog(false)} title="Intro für diese Serie festlegen">
        <div className="space-y-4">
          <p className="text-sm text-ghg-muted">
            Gilt als Standard für alle Folgen dieser Serie, die kein eigenes (erkanntes oder manuell gesetztes) Intro haben.
            Tipp: Noch genauer geht es direkt im Player per Rechtsklick → „Intro: Start/Ende hier setzen“.
          </p>
          <div className="flex gap-4">
            <label className="flex-1">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Intro-Start (Sekunden)</span>
              <TextInput value={introFrom} onChange={setIntroFrom} type="number" />
            </label>
            <label className="flex-1">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Intro-Ende (Sekunden)</span>
              <TextInput value={introTo} onChange={setIntroTo} type="number" />
            </label>
          </div>
          <div className="flex justify-between gap-2 pt-2">
            <Button
              variant="danger"
              onClick={() => {
                void setShowIntro(sid, null, null).then(() => {
                  toast("Serien-Intro entfernt", "success");
                  setIntroDialog(false);
                });
              }}
            >
              Entfernen
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setIntroDialog(false)}>
                Abbrechen
              </Button>
              <Button onClick={() => void saveIntroWindow()}>Speichern</Button>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function EpisodeRow({
  ep,
  progress,
  onPlay,
  onIdentify,
  onArtwork,
  onToggleWatched,
  onReassign,
  showTitle,
}: {
  ep: Episode;
  progress?: Progress;
  onPlay: () => void;
  onIdentify: () => void;
  onArtwork: () => void;
  onToggleWatched: (watched: boolean) => void;
  onReassign: () => void;
  showTitle?: string;
}) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const toast = useStore((s) => s.toast);
  const epLocalStills = useUiPrefs((s) => s.epLocalStills);
  const [localStill, setLocalStill] = useState<string | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [menu]);

  // No TMDb still? Extract a frame from the actual video file (lazy, only when
  // the row scrolls into view; the backend disk cache makes repeats instant).
  useEffect(() => {
    if (!epLocalStills || ep.stillPath || localStill) return;
    const el = rowRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          const t = ep.runtime ? Math.max(60, ep.runtime * 60 * 0.25) : 300;
          mediaThumbnail(ep.path, t)
            .then(setLocalStill)
            .catch(() => {});
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [epLocalStills, ep.stillPath, ep.path, ep.runtime, localStill]);

  const pct = progress && progress.durationSec > 0 ? (progress.positionSec / progress.durationSec) * 100 : 0;
  const still = stillUrl(ep.stillPath) ?? localStill;

  // shared action set for both the "…" menu and right-click on the whole row
  const rowActions = [
    { label: "Abspielen", onClick: onPlay },
    { label: progress?.watched ? "Als ungesehen markieren" : "Als gesehen markieren", onClick: () => onToggleWatched(!progress?.watched) },
    { label: "Bild ändern", onClick: onArtwork },
    { label: "Identifizieren (Staffel/Folge)", onClick: onIdentify },
    { label: "Folge → andere Serie verschieben", onClick: onReassign },
    {
      label: "▶ Als Nächstes abspielen",
      onClick: () => {
        playback().enqueue(
          { kind: "episode" as const, mediaType: "episode" as const, label: `${showTitle || "Folge"} · ${seasonEpisodeLabel(ep.season, ep.episode)}`, sub: ep.title || undefined, ids: [ep.id] },
          true,
        );
        toast("Wird als Nächstes abgespielt", "success");
      },
    },
    {
      label: "+ Zur Warteschlange",
      onClick: () => {
        playback().enqueue({
          kind: "episode" as const,
          mediaType: "episode" as const,
          label: `${showTitle || "Folge"} · ${seasonEpisodeLabel(ep.season, ep.episode)}`,
          sub: ep.title || undefined,
          ids: [ep.id],
        });
        toast("Zur Warteschlange hinzugefügt", "success");
      },
    },
    {
      label: "In Ordner anzeigen",
      onClick: () => void revealInExplorer(ep.path).catch((e) => toast(String(e), "error")),
    },
  ];

  return (
    <div
      ref={rowRef}
      className="group flex gap-4 p-3 rounded-xl hover:bg-ghg-surface2 transition border border-transparent hover:border-ghg-line"
      onContextMenu={(e) => openCtx(e, rowActions)}
    >
      <div
        className="relative w-44 aspect-video shrink-0 rounded-lg overflow-hidden bg-ghg-bg2 cursor-pointer"
        onClick={onPlay}
      >
        {still ? (
          <img src={still} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-ghg-muted text-xs">
            {seasonEpisodeLabel(ep.season, ep.episode)}
          </div>
        )}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition">
          <Play className="w-8 h-8 fill-white" />
        </div>
        {pct > 0 && !progress?.watched && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div className="h-full bg-ghg-red" style={{ width: `${Math.min(100, pct)}%` }} />
          </div>
        )}
        {progress?.watched && (
          <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-ghg-red flex items-center justify-center shadow" title="Gesehen">
            <Check className="w-3.5 h-3.5 text-white" />
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0 cursor-pointer" onClick={onPlay}>
        <p className="font-semibold">
          <span className="text-ghg-red mr-2">{seasonEpisodeLabel(ep.season, ep.episode)}</span>
          {ep.title || "Folge"}
          {quality(ep) && (
            <span className="ml-2 px-1.5 py-0.5 rounded bg-ghg-surface2 border border-ghg-line text-[10px] font-semibold align-middle">
              {quality(ep)}
            </span>
          )}
          {(ep.fileCount ?? 0) > 1 && (
            <span className="ml-1.5 px-1.5 py-0.5 rounded bg-ghg-red/20 border border-ghg-red/40 text-ghg-red text-[10px] font-semibold align-middle">
              {ep.fileCount}× Qualität
            </span>
          )}
        </p>
        <p className="text-sm text-ghg-muted line-clamp-2 mt-1">{ep.overview || ""}</p>
        {ep.runtime ? <p className="text-xs text-ghg-muted mt-1">{formatRuntime(ep.runtime)}</p> : null}
      </div>

      <div ref={ref} className="relative self-start flex items-center gap-0.5">
        {/* always-visible identify shortcut — the user asked for a BUTTON, not
            just a hidden menu entry */}
        <button
          onClick={onIdentify}
          title="Folge identifizieren (echten Titel & Bild zuordnen)"
          className="p-1.5 rounded-lg hover:bg-ghg-elevated text-ghg-muted hover:text-ghg-red opacity-0 group-hover:opacity-100 transition"
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => setMenu((o) => !o)}
          className="p-1.5 rounded-lg hover:bg-ghg-elevated text-ghg-muted hover:text-ghg-text opacity-0 group-hover:opacity-100 transition"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
        {menu && (
          <div className="absolute right-0 mt-1 w-56 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden z-20 fade-in">
            {rowActions.map((a, i) => (
              <button
                key={i}
                onClick={() => {
                  setMenu(false);
                  a.onClick();
                }}
                className="w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2"
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

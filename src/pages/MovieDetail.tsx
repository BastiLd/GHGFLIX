import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, ImageIcon, Pencil, Play, Plus, Star } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fileInfo, getMovie, getProgress, listFavorites, listMovies, movieVersions, revealInExplorer, setWatched, toggleFavorite, type FileInfoResult } from "../lib/api";
import { dedupeMovies, formatBytes, formatRuntime, parseGenres, quality, qualityFromDims, ratingText } from "../lib/format";
import { backdropUrl, posterUrl } from "../lib/img";
import { useStore } from "../lib/store";
import { ArtworkDialog } from "../components/ArtworkDialog";
import { Extras } from "../components/Extras";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { MovieCardItem } from "../components/cards";
import { MediaRow } from "../components/MediaRow";
import { Button, EmptyState, Modal, SkeletonDetail } from "../components/ui";
import { useMemo } from "react";

export default function MovieDetail() {
  const { id } = useParams();
  const mid = Number(id);
  const navigate = useNavigate();
  const profileId = useStore((s) => s.profileId);
  const [identify, setIdentify] = useState(false);
  const [identifyOther, setIdentifyOther] = useState<IdentifyTarget | null>(null);
  const [artwork, setArtworkOpen] = useState(false);
  const [info, setInfo] = useState<FileInfoResult | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  const movie = useQuery({ queryKey: ["movie", mid], queryFn: () => getMovie(mid) });
  const prog = useQuery({
    queryKey: ["progress", "movie", mid, profileId],
    queryFn: () => getProgress(profileId, "movie", mid),
  });
  const favs = useQuery({ queryKey: ["favorites", profileId], queryFn: () => listFavorites(profileId) });
  const vers = useQuery({ queryKey: ["movieVersions", mid], queryFn: () => movieVersions(mid) });
  const allMoviesQ = useQuery({ queryKey: ["movies"], queryFn: listMovies });

  // local library titles sharing genres with this movie ("Ähnliche Filme")
  const similar = useMemo(() => {
    const me = movie.data;
    if (!me) return [];
    const mine = new Set(parseGenres(me.genres));
    if (mine.size === 0) return [];
    return dedupeMovies(allMoviesQ.data ?? [])
      .filter((x) => x.tmdbId !== me.tmdbId && x.id !== me.id)
      .map((x) => ({ m: x, overlap: parseGenres(x.genres).filter((g) => mine.has(g)).length }))
      .filter((x) => x.overlap >= 1)
      .sort((a, b) => b.overlap - a.overlap || (b.m.rating ?? 0) - (a.m.rating ?? 0))
      .slice(0, 12)
      .map((x) => x.m);
  }, [movie.data, allMoviesQ.data]);
  const isFav = (favs.data ?? []).some((f) => f.mediaType === "movie" && f.refId === mid);

  const toggleFav = () =>
    void toggleFavorite(profileId, "movie", mid).then(() => qc.invalidateQueries({ queryKey: ["favorites"] }));
  const markWatched = () =>
    void setWatched(profileId, "movie", mid, true).then(() => toast("Als gesehen markiert", "success"));

  if (movie.isLoading) return <SkeletonDetail />;

  const m = movie.data;
  if (!m) return <EmptyState title="Film nicht gefunden" />;

  const resume = prog.data && prog.data.positionSec > 30 && !prog.data.watched;
  const genres = parseGenres(m.genres);
  const rating = ratingText(m.rating);
  const runtime = formatRuntime(m.runtime);
  const qual = quality(m);

  return (
    <div className="relative">
      <div className="relative h-[42vh] min-h-[300px]">
        {backdropUrl(m.backdropPath) ? (
          <img src={backdropUrl(m.backdropPath)!} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-ghg-surface2 to-ghg-bg" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ghg-bg via-ghg-bg/50 to-transparent" />
        <button
          onClick={() => navigate("/movies")}
          title="Zur Übersicht"
          className="absolute top-5 left-5 p-2 rounded-lg bg-black/50 hover:bg-ghg-red transition"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
      </div>

      <div className="px-10 -mt-32 relative flex gap-8">
        <div className="relative w-52 shrink-0 aspect-[2/3] rounded-xl overflow-hidden border border-ghg-line shadow-2xl bg-ghg-surface2">
          {posterUrl(m.posterPath, "w500") ? (
            <img src={posterUrl(m.posterPath, "w500")!} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center p-3 text-center text-ghg-muted">{m.title}</div>
          )}
          {resume && prog.data && prog.data.durationSec > 0 && (
            <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
              <div
                className="h-full bg-ghg-red"
                style={{ width: `${Math.min(100, (prog.data.positionSec / prog.data.durationSec) * 100)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex-1 pt-32">
          <h1 className="text-4xl font-black text-glow">{m.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-ghg-muted">
            {m.year && <span>{m.year}</span>}
            {runtime && <span>· {runtime}</span>}
            {rating && (
              <span className="flex items-center gap-1">
                · <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" /> {rating}
              </span>
            )}
            {qual && <span className="px-2 py-0.5 rounded bg-ghg-surface2 border border-ghg-line text-xs font-semibold">{qual}</span>}
            {m.cert && (
              <span className="px-2 py-0.5 rounded border border-ghg-line text-xs font-semibold text-ghg-muted" title="Altersfreigabe">
                {m.cert}
              </span>
            )}
            {!m.tmdbId && <span className="zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase">Nicht erkannt</span>}
          </div>

          {genres.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {genres.map((g) => (
                <span key={g} className="text-xs px-2.5 py-1 rounded-full bg-ghg-surface2 border border-ghg-line text-ghg-muted">
                  {g}
                </span>
              ))}
            </div>
          )}

          {(vers.data?.length ?? 0) > 1 && (
            <div className="mt-3 text-sm text-ghg-muted flex items-center gap-1.5 flex-wrap">
              <span>Verfügbar in:</span>
              {(vers.data ?? []).map((v) => {
                const q = qualityFromDims(v.width, v.height) ?? quality(v) ?? "?";
                return (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/play/movie/${v.id}`)}
                    title={`Diese Version abspielen (${v.path})`}
                    className="px-2 py-0.5 rounded bg-ghg-surface2 border border-ghg-line text-xs font-semibold text-ghg-text hover:border-ghg-red hover:text-ghg-red transition"
                  >
                    ▶ {q}
                  </button>
                );
              })}
            </div>
          )}

          <p className="mt-4 max-w-3xl text-ghg-text/80 leading-relaxed">{m.overview || "Keine Beschreibung verfügbar."}</p>

          <div className="flex gap-3 mt-6 flex-wrap">
            <Button onClick={() => navigate(`/play/movie/${m.id}`)}>
              <Play className="w-4 h-4 fill-white" /> {resume ? "Fortsetzen" : "Abspielen"}
            </Button>
            <Button variant="ghost" onClick={toggleFav}>
              {isFav ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Meine Liste
            </Button>
            <Button variant="ghost" onClick={markWatched}>
              <Check className="w-4 h-4" /> {prog.data?.watched ? "Gesehen ✓" : "Gesehen"}
            </Button>
            {prog.data?.watched && (
              <Button
                variant="ghost"
                onClick={() =>
                  void setWatched(profileId, "movie", mid, false).then(() => {
                    qc.invalidateQueries({ queryKey: ["progress"] });
                    toast("Als ungesehen markiert", "success");
                  })
                }
              >
                Ungesehen
              </Button>
            )}
            <Button variant="ghost" onClick={() => void revealInExplorer(m.path).catch((e) => toast(String(e), "error"))}>
              In Ordner anzeigen
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setInfoOpen(true);
                void fileInfo(m.path).then(setInfo).catch(() => setInfo(null));
              }}
            >
              Dateiinfo
            </Button>
            <Button variant="ghost" onClick={() => setArtworkOpen(true)}>
              <ImageIcon className="w-4 h-4" /> Bild ändern
            </Button>
            <Button variant="ghost" onClick={() => setIdentify(true)}>
              <Pencil className="w-4 h-4" /> Identifizieren
            </Button>
          </div>
        </div>
      </div>

      <div className="px-10">
        <Extras mediaType="movie" tmdbId={m.tmdbId} />
      </div>

      {similar.length >= 3 && (
        <div className="mt-8">
          <MediaRow title="Ähnliche Filme aus deiner Bibliothek">
            {similar.map((s) => (
              <MovieCardItem key={s.id} movie={s} onIdentify={setIdentifyOther} />
            ))}
          </MediaRow>
        </div>
      )}

      <Modal open={infoOpen} onClose={() => setInfoOpen(false)} title="Dateiinfo">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4 border-b border-ghg-line py-1.5">
            <span className="text-ghg-muted shrink-0">Pfad</span>
            <span className="font-mono text-xs break-all text-right">{m.path}</span>
          </div>
          <div className="flex justify-between border-b border-ghg-line py-1.5">
            <span className="text-ghg-muted">Größe</span>
            <span>{info ? (info.exists ? formatBytes(info.sizeBytes) : "Datei nicht gefunden") : "…"}</span>
          </div>
          <div className="flex justify-between border-b border-ghg-line py-1.5">
            <span className="text-ghg-muted">Auflösung</span>
            <span>{m.width && m.height ? `${m.width}×${m.height} (${quality(m) ?? "?"})` : "unbekannt"}</span>
          </div>
          <div className="flex justify-between border-b border-ghg-line py-1.5">
            <span className="text-ghg-muted">Geändert</span>
            <span>{info?.modifiedSecs ? new Date(info.modifiedSecs * 1000).toLocaleString("de-DE") : "–"}</span>
          </div>
          {(vers.data?.length ?? 0) > 1 && (
            <div className="flex justify-between py-1.5">
              <span className="text-ghg-muted">Versionen</span>
              <span>{vers.data!.length} Dateien</span>
            </div>
          )}
        </div>
      </Modal>

      {identifyOther && (
        <IdentifyDialog open onClose={() => setIdentifyOther(null)} target={identifyOther} onDone={() => {}} />
      )}

      {identify && (
        <IdentifyDialog
          open
          onClose={() => setIdentify(false)}
          target={{ type: "movie", id: m.id, title: m.title }}
          onDone={() => {}}
        />
      )}

      {artwork && (
        <ArtworkDialog
          open
          onClose={() => setArtworkOpen(false)}
          target={{ target: "movie", id: m.id, tmdbId: m.tmdbId, title: m.title }}
        />
      )}
    </div>
  );
}

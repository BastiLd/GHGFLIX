import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { listFavorites, listProgress, revealInExplorer, setShowWatched, setWatched, toggleFavorite } from "../lib/api";
import { enqueueSeasonRest, playback } from "../lib/playback";
import { quality, ratingText } from "../lib/format";
import { backdropUrl, posterUrl } from "../lib/img";
import { useStore } from "../lib/store";
import { useUiPrefs } from "../lib/uiPrefs";
import type { ContinueItem, Movie, Show } from "../lib/types";
import { ArtworkDialog } from "./ArtworkDialog";
import type { IdentifyTarget } from "./IdentifyDialog";
import { MediaCard } from "./MediaCard";

const NEW_DAYS = 7;
const isRecent = (addedAt: number) => Date.now() / 1000 - addedAt < NEW_DAYS * 86400;

/** favorite + watched state from the shared react-query caches (one fetch app-wide) */
function useCardMeta(mediaType: "movie" | "show", refId: number) {
  const profileId = useStore((s) => s.profileId);
  const favs = useQuery({ queryKey: ["favorites", profileId], queryFn: () => listFavorites(profileId) });
  const prog = useQuery({ queryKey: ["progress", "list", profileId], queryFn: () => listProgress(profileId) });
  const favorite = (favs.data ?? []).some((f) => f.mediaType === mediaType && f.refId === refId);
  const watched =
    mediaType === "movie"
      ? (prog.data ?? []).some((p) => p.mediaType === "movie" && p.refId === refId && p.watched)
      : false;
  return { favorite, watched };
}

export function MovieCardItem({
  movie,
  onIdentify,
  progress,
}: {
  movie: Movie;
  onIdentify: (t: IdentifyTarget) => void;
  progress?: number;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileId = useStore((s) => s.profileId);
  const toast = useStore((s) => s.toast);
  const prefs = useUiPrefs();
  const [art, setArt] = useState(false);
  const { favorite, watched } = useCardMeta("movie", movie.id);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["favorites"] });
    qc.invalidateQueries({ queryKey: ["progress"] });
  };

  return (
    <>
      <MediaCard
        title={movie.title}
        subtitle={movie.year ? String(movie.year) : null}
        poster={posterUrl(movie.posterPath)}
        rating={ratingText(movie.rating)}
        quality={quality(movie)}
        progress={progress}
        badge={!movie.tmdbId && prefs.badgeUnmatched ? "Nicht erkannt" : null}
        isNew={prefs.badgeNew && isRecent(movie.addedAt)}
        watched={prefs.badgeWatched && watched}
        favorite={favorite}
        onOpen={() => navigate(`/movie/${movie.id}`)}
        actions={[
          { label: "Abspielen", onClick: () => navigate(`/play/movie/${movie.id}`) },
          { label: "Details", onClick: () => navigate(`/movie/${movie.id}`) },
          {
            label: "▶ Als Nächstes abspielen",
            onClick: () => {
              playback().enqueue({ kind: "movie", mediaType: "movie", label: movie.title, ids: [movie.id] }, true);
              toast("Wird als Nächstes abgespielt", "success");
            },
          },
          {
            label: "+ Zur Warteschlange",
            onClick: () => {
              playback().enqueue({ kind: "movie", mediaType: "movie", label: movie.title, ids: [movie.id] });
              toast("Zur Warteschlange hinzugefügt", "success");
            },
          },
          {
            label: watched ? "Als ungesehen markieren" : "Als gesehen markieren",
            onClick: () =>
              void setWatched(profileId, "movie", movie.id, !watched).then(() => {
                invalidate();
                toast(watched ? "Als ungesehen markiert" : "Als gesehen markiert", "success");
              }),
          },
          {
            label: favorite ? "Aus Meine Liste entfernen" : "Zu Meine Liste",
            onClick: () =>
              void toggleFavorite(profileId, "movie", movie.id).then((on) => {
                invalidate();
                toast(on ? "Zu Meine Liste hinzugefügt" : "Aus Meine Liste entfernt", "success");
              }),
          },
          { label: "Bild ändern", onClick: () => setArt(true) },
          { label: "Identifizieren", onClick: () => onIdentify({ type: "movie", id: movie.id, title: movie.title }) },
          {
            label: "In Ordner anzeigen",
            onClick: () => void revealInExplorer(movie.path).catch((e) => toast(String(e), "error")),
          },
        ]}
      />
      {art && (
        <ArtworkDialog
          open
          onClose={() => setArt(false)}
          target={{ target: "movie", id: movie.id, tmdbId: movie.tmdbId, title: movie.title }}
        />
      )}
    </>
  );
}

export function ShowCardItem({ show, onIdentify }: { show: Show; onIdentify: (t: IdentifyTarget) => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileId = useStore((s) => s.profileId);
  const toast = useStore((s) => s.toast);
  const prefs = useUiPrefs();
  const [art, setArt] = useState(false);
  const { favorite } = useCardMeta("show", show.id);

  return (
    <>
      <MediaCard
        title={show.title}
        subtitle={`${show.seasonCount} Staffel${show.seasonCount === 1 ? "" : "n"} · ${show.episodeCount} Folgen`}
        poster={posterUrl(show.posterPath)}
        rating={ratingText(show.rating)}
        quality={quality(show)}
        badge={!show.tmdbId && prefs.badgeUnmatched ? "Nicht erkannt" : null}
        isNew={prefs.badgeNew && isRecent(show.addedAt)}
        favorite={favorite}
        onOpen={() => navigate(`/show/${show.id}`)}
        actions={[
          { label: "Details", onClick: () => navigate(`/show/${show.id}`) },
          {
            label: "+ Ungesehene in Warteschlange",
            onClick: () =>
              void enqueueSeasonRest(profileId, show.id, show.title, null, null).then((n) =>
                toast(n > 0 ? `${n} Folgen in die Warteschlange gelegt` : "Keine ungesehenen Folgen", n > 0 ? "success" : "info"),
              ),
          },
          {
            label: "Ganze Serie als gesehen",
            onClick: () =>
              void setShowWatched(profileId, show.id, true).then(() => {
                qc.invalidateQueries({ queryKey: ["progress"] });
                qc.invalidateQueries({ queryKey: ["continue"] });
                qc.invalidateQueries({ queryKey: ["recentlyWatched"] });
                toast("Serie als gesehen markiert", "success");
              }),
          },
          {
            label: "Ganze Serie als ungesehen",
            onClick: () =>
              void setShowWatched(profileId, show.id, false).then(() => {
                qc.invalidateQueries({ queryKey: ["progress"] });
                qc.invalidateQueries({ queryKey: ["continue"] });
                qc.invalidateQueries({ queryKey: ["recentlyWatched"] });
                toast("Serie als ungesehen markiert", "success");
              }),
          },
          {
            label: favorite ? "Aus Meine Liste entfernen" : "Zu Meine Liste",
            onClick: () =>
              void toggleFavorite(profileId, "show", show.id).then((on) => {
                qc.invalidateQueries({ queryKey: ["favorites"] });
                toast(on ? "Zu Meine Liste hinzugefügt" : "Aus Meine Liste entfernt", "success");
              }),
          },
          { label: "Bild ändern", onClick: () => setArt(true) },
          { label: "Identifizieren", onClick: () => onIdentify({ type: "show", id: show.id, title: show.title }) },
        ]}
      />
      {art && (
        <ArtworkDialog
          open
          onClose={() => setArt(false)}
          target={{ target: "show", id: show.id, tmdbId: show.tmdbId, title: show.title }}
        />
      )}
    </>
  );
}

export function ContinueCardItem({ item, onRemove }: { item: ContinueItem; onRemove?: () => void }) {
  const navigate = useNavigate();
  const poster = backdropUrl(item.backdropPath, "w780") ?? posterUrl(item.posterPath, "w500");
  return (
    <MediaCard
      wide
      title={item.title}
      subtitle={item.subtitle}
      poster={poster}
      progress={item.progress}
      onOpen={() => navigate(`/play/${item.mediaType}/${item.refId}`)}
      actions={[
        { label: "Weiterschauen", onClick: () => navigate(`/play/${item.mediaType}/${item.refId}`) },
        ...(item.mediaType === "episode" && item.showId
          ? [{ label: "Zur Serie", onClick: () => navigate(`/show/${item.showId}`) }]
          : []),
        ...(onRemove ? [{ label: "Aus Weiterschauen entfernen", onClick: onRemove, danger: true }] : []),
      ]}
    />
  );
}

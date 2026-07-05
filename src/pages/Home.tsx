import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  continueWatching,
  getLibraries,
  listFavorites,
  listMovies,
  listProgress,
  listShowEpisodes,
  listShows,
  recentlyWatched,
  setProgress,
  toggleFavorite,
} from "../lib/api";
import { certAllowed, dedupeMovies, parseGenres, quality, ratingText } from "../lib/format";
import { backdropUrl } from "../lib/img";
import { useStore } from "../lib/store";
import { useUiPrefs } from "../lib/uiPrefs";
import { ContinueCardItem, MovieCardItem, ShowCardItem } from "../components/cards";
import { Hero } from "../components/Hero";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { MediaRow } from "../components/MediaRow";
import { Button, EmptyState, SkeletonRow } from "../components/ui";
import type { Movie, Show } from "../lib/types";

export default function Home() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const profileId = useStore((s) => s.profileId);
  const prefs = useUiPrefs();
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);
  // one random draw per visit → the hero rotates instead of always showing the same title
  const [heroSeed, setHeroSeed] = useState(() => Math.floor(Math.random() * 100000));

  const libs = useQuery({ queryKey: ["libraries"], queryFn: getLibraries });
  const movies = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const shows = useQuery({ queryKey: ["shows"], queryFn: listShows });
  const cont = useQuery({ queryKey: ["continue", profileId], queryFn: () => continueWatching(profileId) });
  const history = useQuery({
    queryKey: ["recentlyWatched", profileId],
    queryFn: () => recentlyWatched(profileId, 20),
    enabled: prefs.rowHistory,
  });
  const prog = useQuery({ queryKey: ["progress", "list", profileId], queryFn: () => listProgress(profileId) });
  const favs = useQuery({ queryKey: ["favorites", profileId], queryFn: () => listFavorites(profileId) });

  // optional kids filter (Einstellungen → Allgemein): hide everything above the max FSK
  const allMovies = useMemo(
    () => dedupeMovies(movies.data ?? []).filter((m) => certAllowed(m.cert, prefs.kidsMaxCert)),
    [movies.data, prefs.kidsMaxCert],
  );
  const allShows = useMemo(
    () => (shows.data ?? []).filter((s) => certAllowed(s.cert, prefs.kidsMaxCert)),
    [shows.data, prefs.kidsMaxCert],
  );

  // optional timed hero rotation (Einstellungen → Allgemein)
  useEffect(() => {
    if (!prefs.heroRotateSec || prefs.heroRotateSec < 5) return;
    const id = setInterval(() => setHeroSeed((s) => s + 1), prefs.heroRotateSec * 1000);
    return () => clearInterval(id);
  }, [prefs.heroRotateSec]);

  const progMap = useMemo(() => {
    const m = new Map<number, number>();
    (prog.data ?? [])
      .filter((p) => p.mediaType === "movie" && p.durationSec > 0 && !p.watched)
      .forEach((p) => m.set(p.refId, p.positionSec / p.durationSec));
    return m;
  }, [prog.data]);

  const favItems = useMemo(() => {
    const mById = new Map(allMovies.map((m) => [m.id, m]));
    const sById = new Map(allShows.map((s) => [s.id, s]));
    const movieFavs: Movie[] = [];
    const showFavs: Show[] = [];
    (favs.data ?? []).forEach((f) => {
      if (f.mediaType === "movie") {
        const m = mById.get(f.refId);
        if (m) movieFavs.push(m);
      } else {
        const s = sById.get(f.refId);
        if (s) showFavs.push(s);
      }
    });
    return { movieFavs, showFavs };
  }, [favs.data, allMovies, allShows]);

  // last 20 added items (movies + shows mixed), newest first
  const recentItems = useMemo(() => {
    const mixed = [
      ...allShows.map((s) => ({ item: s as Show | Movie, isShow: true, added: s.addedAt })),
      ...allMovies.map((m) => ({ item: m as Show | Movie, isShow: false, added: m.addedAt })),
    ];
    return mixed.sort((a, b) => b.added - a.added).slice(0, 20);
  }, [allMovies, allShows]);

  // best-rated items (>= 7.0), for the "Top bewertet" row
  const topRated = useMemo(() => {
    const mixed = [
      ...allShows.filter((s) => (s.rating ?? 0) >= 7).map((s) => ({ item: s as Show | Movie, isShow: true, r: s.rating ?? 0 })),
      ...allMovies.filter((m) => (m.rating ?? 0) >= 7).map((m) => ({ item: m as Show | Movie, isShow: false, r: m.rating ?? 0 })),
    ];
    return mixed.sort((a, b) => b.r - a.r).slice(0, 20);
  }, [allMovies, allShows]);

  const genreRows = useMemo(() => {
    const map = new Map<string, { shows: Show[]; movies: Movie[] }>();
    allShows.forEach((s) =>
      parseGenres(s.genres).forEach((g) => {
        const e = map.get(g) ?? { shows: [], movies: [] };
        e.shows.push(s);
        map.set(g, e);
      }),
    );
    allMovies.forEach((m) =>
      parseGenres(m.genres).forEach((g) => {
        const e = map.get(g) ?? { shows: [], movies: [] };
        e.movies.push(m);
        map.set(g, e);
      }),
    );
    return [...map.entries()]
      .map(([genre, e]) => ({ genre, ...e, total: e.shows.length + e.movies.length }))
      .filter((x) => x.total >= 2)
      .sort((a, b) => b.total - a.total)
      .slice(0, Math.max(0, prefs.genreRowCount));
  }, [allMovies, allShows, prefs.genreRowCount]);

  if (libs.isLoading || movies.isLoading || shows.isLoading) {
    return (
      <div className="pt-6">
        <div className="skeleton h-[46vh] min-h-[320px] mx-0 mb-8" />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  if ((libs.data?.length ?? 0) === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <EmptyState
          icon={<FolderPlus className="w-16 h-16" />}
          title="Willkommen bei GHGFlix"
          hint="Füge zuerst deine Film- und Serienordner hinzu und hinterlege deinen TMDb-API-Key in den Einstellungen."
        />
        <Button onClick={() => navigate("/settings")}>Zu den Einstellungen</Button>
      </div>
    );
  }

  const contItems = cont.data ?? [];

  if (allMovies.length === 0 && allShows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <EmptyState title="Noch nichts in der Bibliothek" hint="Starte einen Scan, um deine Ordner einzulesen." />
        <Button onClick={() => navigate("/settings")}>Zu den Einstellungen</Button>
      </div>
    );
  }

  // hero pick: random or newest, from items that actually have a backdrop
  const heroPool: { item: Show | Movie; isShow: boolean }[] = [
    ...allShows.filter((s) => s.backdropPath).map((s) => ({ item: s as Show | Movie, isShow: true })),
    ...allMovies.filter((m) => m.backdropPath).map((m) => ({ item: m as Show | Movie, isShow: false })),
  ];
  if (prefs.heroMode === "newest") {
    heroPool.sort((a, b) => b.item.addedAt - a.item.addedAt);
  }
  const pick = heroPool.length
    ? heroPool[prefs.heroMode === "newest" ? 0 : heroSeed % heroPool.length]
    : allShows[0]
      ? { item: allShows[0] as Show | Movie, isShow: true }
      : allMovies[0]
        ? { item: allMovies[0] as Show | Movie, isShow: false }
        : null;
  const featured = pick?.item;
  const isShow = pick?.isShow ?? false;
  const featuredFav = featured
    ? (favs.data ?? []).some((f) => f.mediaType === (isShow ? "show" : "movie") && f.refId === featured.id)
    : false;

  const removeContinue = (mediaType: "movie" | "episode", refId: number) => {
    void setProgress(profileId, mediaType, refId, 0, 0, false).then(() =>
      qc.invalidateQueries({ queryKey: ["continue"] }),
    );
  };

  // hero "Abspielen" on a show plays the first unwatched episode directly
  const playFeatured = async () => {
    if (!featured) return;
    if (!isShow) {
      navigate(`/play/movie/${featured.id}`);
      return;
    }
    try {
      const [eps, plist] = await Promise.all([listShowEpisodes(featured.id), listProgress(profileId)]);
      const watched = new Set(plist.filter((p) => p.mediaType === "episode" && p.watched).map((p) => p.refId));
      const next = eps.find((e) => !watched.has(e.id)) ?? eps[0];
      if (next) navigate(`/play/episode/${next.id}`);
      else navigate(`/show/${featured.id}`);
    } catch {
      navigate(`/show/${featured.id}`);
    }
  };

  const hour = new Date().getHours();
  const greetWord = hour < 5 ? "Gute Nacht" : hour < 11 ? "Guten Morgen" : hour < 18 ? "Guten Tag" : "Guten Abend";

  return (
    <div className="pb-10">
      {prefs.greeting && (
        <p className="px-8 pt-5 pb-1 text-sm text-ghg-muted">
          {greetWord}
          <span className="text-ghg-text font-semibold">, {useStore.getState().profileName}</span> 👋
        </p>
      )}
      {prefs.heroEnabled && featured && (
        <Hero
          title={featured.title}
          overview={featured.overview}
          backdrop={backdropUrl((featured as Show | Movie).backdropPath)}
          meta={isShow ? "Serie" : "Film"}
          quality={quality(featured)}
          year={featured.year}
          rating={ratingText(featured.rating)}
          cert={(featured as Show | Movie).cert}
          genres={parseGenres(featured.genres)}
          isFavorite={featuredFav}
          onToggleFavorite={() =>
            void toggleFavorite(profileId, isShow ? "show" : "movie", featured.id).then(() =>
              qc.invalidateQueries({ queryKey: ["favorites"] }),
            )
          }
          onPlay={() => void playFeatured()}
          onDetails={() => navigate(isShow ? `/show/${featured.id}` : `/movie/${featured.id}`)}
        />
      )}

      {prefs.rowContinue && contItems.length > 0 && (
        <MediaRow title="Weiterschauen">
          {contItems.map((c) => (
            <ContinueCardItem
              key={`${c.mediaType}-${c.refId}`}
              item={c}
              onRemove={() => removeContinue(c.mediaType, c.refId)}
            />
          ))}
        </MediaRow>
      )}

      {prefs.rowRecent && recentItems.length > 0 && (
        <MediaRow title="Neu hinzugefügt">
          {recentItems.map((r) =>
            r.isShow ? (
              <ShowCardItem key={`r-s-${r.item.id}`} show={r.item as Show} onIdentify={setIdentify} />
            ) : (
              <MovieCardItem
                key={`r-m-${r.item.id}`}
                movie={r.item as Movie}
                onIdentify={setIdentify}
                progress={progMap.get(r.item.id)}
              />
            ),
          )}
        </MediaRow>
      )}

      {prefs.rowMyList && (favItems.showFavs.length > 0 || favItems.movieFavs.length > 0) && (
        <MediaRow title="Meine Liste">
          {favItems.showFavs.map((s) => (
            <ShowCardItem key={`fs-${s.id}`} show={s} onIdentify={setIdentify} />
          ))}
          {favItems.movieFavs.map((m) => (
            <MovieCardItem key={`fm-${m.id}`} movie={m} onIdentify={setIdentify} progress={progMap.get(m.id)} />
          ))}
        </MediaRow>
      )}

      {prefs.rowShows && allShows.length > 0 && (
        <MediaRow title="Serien">
          {allShows.map((s) => (
            <ShowCardItem key={s.id} show={s} onIdentify={setIdentify} />
          ))}
        </MediaRow>
      )}

      {prefs.rowMovies && allMovies.length > 0 && (
        <MediaRow title="Filme">
          {allMovies.map((m) => (
            <MovieCardItem key={m.id} movie={m} onIdentify={setIdentify} progress={progMap.get(m.id)} />
          ))}
        </MediaRow>
      )}

      {prefs.rowTopRated && topRated.length >= 3 && (
        <MediaRow title="Top bewertet">
          {topRated.map((r) =>
            r.isShow ? (
              <ShowCardItem key={`t-s-${r.item.id}`} show={r.item as Show} onIdentify={setIdentify} />
            ) : (
              <MovieCardItem
                key={`t-m-${r.item.id}`}
                movie={r.item as Movie}
                onIdentify={setIdentify}
                progress={progMap.get(r.item.id)}
              />
            ),
          )}
        </MediaRow>
      )}

      {prefs.rowHistory && (history.data?.length ?? 0) > 0 && (
        <MediaRow title="Zuletzt gesehen">
          {(history.data ?? []).map((c) => (
            <ContinueCardItem key={`h-${c.mediaType}-${c.refId}`} item={{ ...c, progress: 0 }} />
          ))}
        </MediaRow>
      )}

      {prefs.rowGenres &&
        genreRows.map((row) => (
          <MediaRow key={row.genre} title={row.genre}>
            {row.shows.map((s) => (
              <ShowCardItem key={`g-s-${s.id}`} show={s} onIdentify={setIdentify} />
            ))}
            {row.movies.map((m) => (
              <MovieCardItem key={`g-m-${m.id}`} movie={m} onIdentify={setIdentify} progress={progMap.get(m.id)} />
            ))}
          </MediaRow>
        ))}

      {identify && <IdentifyDialog open onClose={() => setIdentify(null)} target={identify} onDone={() => {}} />}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useMemo, useState } from "react";
import { listFavorites, listMovies, listShows } from "../lib/api";
import { useStore } from "../lib/store";
import { MovieCardItem, ShowCardItem } from "../components/cards";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { EmptyState, Spinner } from "../components/ui";
import type { Movie, Show } from "../lib/types";

type Sort = "added" | "title" | "rating";

export default function MyList() {
  const profileId = useStore((s) => s.profileId);
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("ghgflix.listSort") as Sort) || "added");

  const favs = useQuery({ queryKey: ["favorites", profileId], queryFn: () => listFavorites(profileId) });
  const movies = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const shows = useQuery({ queryKey: ["shows"], queryFn: listShows });

  const { movieFavs, showFavs } = useMemo(() => {
    const mById = new Map((movies.data ?? []).map((m) => [m.id, m]));
    const sById = new Map((shows.data ?? []).map((s) => [s.id, s]));
    const addedAt = new Map((favs.data ?? []).map((f) => [`${f.mediaType}-${f.refId}`, f.addedAt]));
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
    const cmp = <T extends Movie | Show>(kind: string) => (a: T, b: T) => {
      if (sort === "title") return a.title.localeCompare(b.title);
      if (sort === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      return (addedAt.get(`${kind}-${b.id}`) ?? 0) - (addedAt.get(`${kind}-${a.id}`) ?? 0);
    };
    movieFavs.sort(cmp("movie"));
    showFavs.sort(cmp("show"));
    return { movieFavs, showFavs };
  }, [favs.data, movies.data, shows.data, sort]);

  if (favs.isLoading || movies.isLoading || shows.isLoading)
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="w-8 h-8" />
      </div>
    );

  const empty = movieFavs.length === 0 && showFavs.length === 0;

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-black flex items-center gap-3">
          <Heart className="w-7 h-7 text-ghg-red fill-ghg-red" /> Meine Liste
          <span className="text-base font-normal text-ghg-muted">({movieFavs.length + showFavs.length})</span>
        </h1>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            localStorage.setItem("ghgflix.listSort", e.target.value);
          }}
          className="bg-ghg-surface2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
        >
          <option value="added">Zuletzt hinzugefügt</option>
          <option value="title">Titel A–Z</option>
          <option value="rating">Bewertung</option>
        </select>
      </div>

      {empty ? (
        <EmptyState
          icon={<Heart className="w-14 h-14" />}
          title="Deine Liste ist leer"
          hint={'Tippe bei einem Film/einer Serie auf „Zu Meine Liste" (3-Punkte-Menü, Rechtsklick oder Detailseite).'}
        />
      ) : (
        <div className="space-y-8">
          {showFavs.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Serien</h2>
              <div className="flex flex-wrap gap-4">
                {showFavs.map((s) => (
                  <ShowCardItem key={s.id} show={s} onIdentify={setIdentify} />
                ))}
              </div>
            </div>
          )}
          {movieFavs.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Filme</h2>
              <div className="flex flex-wrap gap-4">
                {movieFavs.map((m) => (
                  <MovieCardItem key={m.id} movie={m} onIdentify={setIdentify} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {identify && <IdentifyDialog open onClose={() => setIdentify(null)} target={identify} onDone={() => {}} />}
    </div>
  );
}

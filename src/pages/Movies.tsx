import { useQuery } from "@tanstack/react-query";
import { Film } from "lucide-react";
import { useMemo, useState } from "react";
import { listMovies, listProgress } from "../lib/api";
import { dedupeMovies, parseGenres, quality } from "../lib/format";
import { useStore } from "../lib/store";
import { MovieCardItem } from "../components/cards";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { EmptyState, SkeletonGrid } from "../components/ui";
import type { Movie } from "../lib/types";

type Sort = "added" | "title" | "year-desc" | "year-asc" | "rating";

const SORTS: { id: Sort; label: string }[] = [
  { id: "added", label: "Zuletzt hinzugefügt" },
  { id: "title", label: "Titel A–Z" },
  { id: "year-desc", label: "Jahr (neueste)" },
  { id: "year-asc", label: "Jahr (älteste)" },
  { id: "rating", label: "Bewertung" },
];

function sortMovies(list: Movie[], sort: Sort): Movie[] {
  const a = [...list];
  switch (sort) {
    case "title":
      return a.sort((x, y) => x.title.localeCompare(y.title));
    case "year-desc":
      return a.sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
    case "year-asc":
      return a.sort((x, y) => (x.year ?? 0) - (y.year ?? 0));
    case "rating":
      return a.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0));
    default:
      return a.sort((x, y) => y.addedAt - x.addedAt);
  }
}

export default function Movies() {
  const profileId = useStore((s) => s.profileId);
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("ghgflix.movieSort") as Sort) || "added");
  const [hideWatched, setHideWatched] = useState(() => localStorage.getItem("ghgflix.movieHideWatched") === "1");
  const [filter, setFilter] = useState("");
  const [genre, setGenre] = useState("");
  const [qual, setQual] = useState("");

  const { data, isLoading } = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const prog = useQuery({ queryKey: ["progress", "list", profileId], queryFn: () => listProgress(profileId) });

  const progMap = useMemo(() => {
    const m = new Map<number, number>();
    (prog.data ?? [])
      .filter((p) => p.mediaType === "movie" && p.durationSec > 0 && !p.watched)
      .forEach((p) => m.set(p.refId, p.positionSec / p.durationSec));
    return m;
  }, [prog.data]);

  const watchedSet = useMemo(
    () => new Set((prog.data ?? []).filter((p) => p.mediaType === "movie" && p.watched).map((p) => p.refId)),
    [prog.data],
  );

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((m) => parseGenres(m.genres).forEach((g) => set.add(g)));
    return [...set].sort();
  }, [data]);

  const movies = useMemo(() => {
    let list = dedupeMovies(data ?? []);
    if (hideWatched) list = list.filter((m) => !watchedSet.has(m.id));
    const f = filter.trim().toLowerCase();
    if (f) list = list.filter((m) => m.title.toLowerCase().includes(f));
    if (genre) list = list.filter((m) => parseGenres(m.genres).includes(genre));
    if (qual) list = list.filter((m) => quality(m) === qual);
    return sortMovies(list, sort);
  }, [data, sort, hideWatched, watchedSet, filter, genre, qual]);

  if (isLoading)
    return (
      <div className="px-8 py-6">
        <div className="skeleton h-9 w-52 rounded mb-6" />
        <SkeletonGrid />
      </div>
    );

  return (
    <div className="px-8 py-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h1 className="text-3xl font-black flex items-center gap-3">
          <Film className="w-7 h-7 text-ghg-red" /> Filme
          <span className="text-base font-normal text-ghg-muted">({movies.length})</span>
        </h1>
        <div className="flex items-center gap-3">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filtern …"
            className="bg-ghg-surface2 border border-ghg-line rounded-lg px-3 py-2 text-sm w-44 focus:outline-none focus:border-ghg-red"
          />
          {allGenres.length > 0 && (
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="bg-ghg-surface2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
            >
              <option value="">Alle Genres</option>
              {allGenres.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          )}
          <select
            value={qual}
            onChange={(e) => setQual(e.target.value)}
            className="bg-ghg-surface2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
          >
            <option value="">Jede Qualität</option>
            <option value="4K">4K</option>
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
            <option value="SD">SD</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-ghg-muted cursor-pointer">
            <input
              type="checkbox"
              checked={hideWatched}
              onChange={(e) => {
                setHideWatched(e.target.checked);
                localStorage.setItem("ghgflix.movieHideWatched", e.target.checked ? "1" : "0");
              }}
              className="w-4 h-4 accent-ghg-red"
            />
            Gesehene ausblenden
          </label>
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as Sort);
              localStorage.setItem("ghgflix.movieSort", e.target.value);
            }}
            className="bg-ghg-surface2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {movies.length === 0 ? (
        <EmptyState icon={<Film className="w-14 h-14" />} title="Keine Filme" hint="Füge einen Filmordner hinzu und starte einen Scan." />
      ) : (
        <div className="flex flex-wrap gap-4">
          {movies.map((m) => (
            <MovieCardItem key={m.id} movie={m} onIdentify={setIdentify} progress={progMap.get(m.id)} />
          ))}
        </div>
      )}

      {identify && <IdentifyDialog open onClose={() => setIdentify(null)} target={identify} onDone={() => {}} />}
    </div>
  );
}

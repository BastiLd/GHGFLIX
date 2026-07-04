import { useQuery } from "@tanstack/react-query";
import { Tv } from "lucide-react";
import { useMemo, useState } from "react";
import { listShows } from "../lib/api";
import { parseGenres } from "../lib/format";
import { ShowCardItem } from "../components/cards";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { EmptyState, SkeletonGrid } from "../components/ui";
import type { Show } from "../lib/types";

type Sort = "added" | "title" | "year-desc" | "year-asc" | "rating";

const SORTS: { id: Sort; label: string }[] = [
  { id: "added", label: "Zuletzt hinzugefügt" },
  { id: "title", label: "Titel A–Z" },
  { id: "year-desc", label: "Jahr (neueste)" },
  { id: "year-asc", label: "Jahr (älteste)" },
  { id: "rating", label: "Bewertung" },
];

function sortShows(list: Show[], sort: Sort): Show[] {
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

export default function Shows() {
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);
  const [sort, setSort] = useState<Sort>(() => (localStorage.getItem("ghgflix.showSort") as Sort) || "added");
  const [filter, setFilter] = useState("");
  const [genre, setGenre] = useState("");
  const { data, isLoading } = useQuery({ queryKey: ["shows"], queryFn: listShows });

  const allGenres = useMemo(() => {
    const set = new Set<string>();
    (data ?? []).forEach((s) => parseGenres(s.genres).forEach((g) => set.add(g)));
    return [...set].sort();
  }, [data]);

  const shows = useMemo(() => {
    let list = data ?? [];
    const f = filter.trim().toLowerCase();
    if (f) list = list.filter((s) => s.title.toLowerCase().includes(f));
    if (genre) list = list.filter((s) => parseGenres(s.genres).includes(genre));
    return sortShows(list, sort);
  }, [data, sort, filter, genre]);

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
          <Tv className="w-7 h-7 text-ghg-red" /> Serien
          <span className="text-base font-normal text-ghg-muted">({shows.length})</span>
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
          value={sort}
          onChange={(e) => {
            setSort(e.target.value as Sort);
            localStorage.setItem("ghgflix.showSort", e.target.value);
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

      {shows.length === 0 ? (
        <EmptyState icon={<Tv className="w-14 h-14" />} title="Keine Serien" hint="Füge einen Serienordner hinzu und starte einen Scan." />
      ) : (
        <div className="flex flex-wrap gap-4">
          {shows.map((s) => (
            <ShowCardItem key={s.id} show={s} onIdentify={setIdentify} />
          ))}
        </div>
      )}

      {identify && <IdentifyDialog open onClose={() => setIdentify(null)} target={identify} onDone={() => {}} />}
    </div>
  );
}

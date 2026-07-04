import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Film, HardDrive, PlayCircle, Star, Tv } from "lucide-react";
import { useMemo } from "react";
import { getStats, listMovies, listShows } from "../lib/api";
import { dedupeMovies, parseGenres } from "../lib/format";
import { useStore } from "../lib/store";
import { Spinner } from "../components/ui";

function fmtHours(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d} Tg. ${h} Std.`;
  if (h > 0) return `${h} Std. ${m} Min.`;
  return `${m} Min.`;
}

export default function Stats() {
  const profileId = useStore((s) => s.profileId);
  const { data, isLoading } = useQuery({ queryKey: ["stats", profileId], queryFn: () => getStats(profileId) });
  const movies = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const shows = useQuery({ queryKey: ["shows"], queryFn: listShows });

  const lib = useMemo(() => {
    const mm = dedupeMovies(movies.data ?? []);
    const ss = shows.data ?? [];
    const episodes = ss.reduce((n, s) => n + s.episodeCount, 0);
    const uhd =
      mm.filter((m) => (m.height ?? 0) >= 1600 || (m.width ?? 0) >= 3000).length +
      ss.filter((s) => (s.height ?? 0) >= 1600 || (s.width ?? 0) >= 3000).length;
    // top genres across the library
    const genreCount = new Map<string, number>();
    [...mm, ...ss].forEach((x) =>
      parseGenres(x.genres).forEach((g) => genreCount.set(g, (genreCount.get(g) ?? 0) + 1)),
    );
    const topGenres = [...genreCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    const maxGenre = topGenres[0]?.[1] ?? 1;
    const bestRated = [...mm, ...ss].filter((x) => (x.rating ?? 0) > 0).sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))[0];
    return { movies: mm.length, shows: ss.length, episodes, uhd, topGenres, maxGenre, bestRated };
  }, [movies.data, shows.data]);

  if (isLoading || movies.isLoading || shows.isLoading)
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="w-8 h-8" />
      </div>
    );

  const s = data ?? { watchedSeconds: 0, moviesWatched: 0, episodesWatched: 0, inProgress: 0 };
  const cards = [
    { icon: <Clock className="w-7 h-7" />, label: "Gesamte Watchtime", value: fmtHours(s.watchedSeconds) },
    { icon: <Film className="w-7 h-7" />, label: "Filme gesehen", value: String(s.moviesWatched) },
    { icon: <Tv className="w-7 h-7" />, label: "Folgen gesehen", value: String(s.episodesWatched) },
    { icon: <PlayCircle className="w-7 h-7" />, label: "Angefangen", value: String(s.inProgress) },
  ];
  const libCards = [
    { icon: <Film className="w-7 h-7" />, label: "Filme in der Bibliothek", value: String(lib.movies) },
    { icon: <Tv className="w-7 h-7" />, label: "Serien / Folgen", value: `${lib.shows} / ${lib.episodes}` },
    { icon: <HardDrive className="w-7 h-7" />, label: "In 4K verfügbar", value: String(lib.uhd) },
    {
      icon: <Star className="w-7 h-7" />,
      label: "Bestbewertet",
      value: lib.bestRated ? `${lib.bestRated.title}` : "–",
      small: true,
    },
  ];

  return (
    <div className="px-8 py-6">
      <h1 className="text-3xl font-black mb-6 flex items-center gap-3">
        <BarChart3 className="w-7 h-7 text-ghg-red" /> Statistik
      </h1>

      <h2 className="text-lg font-bold mb-3">Dein Konsum</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mb-8">
        {cards.map((c) => (
          <div key={c.label} className="bg-ghg-surface border border-ghg-line rounded-2xl p-6">
            <div className="text-ghg-red mb-3">{c.icon}</div>
            <p className="text-2xl font-black">{c.value}</p>
            <p className="text-sm text-ghg-muted mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      <h2 className="text-lg font-bold mb-3">Deine Bibliothek</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl mb-8">
        {libCards.map((c) => (
          <div key={c.label} className="bg-ghg-surface border border-ghg-line rounded-2xl p-6">
            <div className="text-ghg-red mb-3">{c.icon}</div>
            <p className={c.small ? "text-base font-bold line-clamp-2" : "text-2xl font-black"}>{c.value}</p>
            <p className="text-sm text-ghg-muted mt-1">{c.label}</p>
          </div>
        ))}
      </div>

      {lib.topGenres.length > 0 && (
        <>
          <h2 className="text-lg font-bold mb-3">Top-Genres</h2>
          <div className="max-w-2xl space-y-2">
            {lib.topGenres.map(([g, n]) => (
              <div key={g} className="flex items-center gap-3">
                <span className="w-32 text-sm text-ghg-muted truncate">{g}</span>
                <div className="flex-1 h-2.5 rounded-full bg-ghg-surface2 overflow-hidden">
                  <div className="h-full bg-ghg-red rounded-full" style={{ width: `${(n / lib.maxGenre) * 100}%` }} />
                </div>
                <span className="w-8 text-sm text-ghg-muted text-right tabular-nums">{n}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Play, Search } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { listMovies, listShows, searchEpisodes } from "../lib/api";
import { dedupeMovies, parseGenres, seasonEpisodeLabel } from "../lib/format";
import { stillUrl } from "../lib/img";
import { MovieCardItem, ShowCardItem } from "../components/cards";
import { IdentifyDialog, type IdentifyTarget } from "../components/IdentifyDialog";
import { EmptyState, SkeletonGrid } from "../components/ui";

export default function SearchPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const q = (params.get("q") || "").toLowerCase();
  const [identify, setIdentify] = useState<IdentifyTarget | null>(null);

  const movies = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const shows = useQuery({ queryKey: ["shows"], queryFn: listShows });
  const eps = useQuery({
    queryKey: ["searchEps", q],
    queryFn: () => searchEpisodes(q),
    enabled: q.length >= 2,
  });

  if (movies.isLoading || shows.isLoading)
    return (
      <div className="px-8 py-6">
        <div className="skeleton h-8 w-72 rounded mb-6" />
        <SkeletonGrid />
      </div>
    );

  // ranked: title starts with the query first, then title contains, then genre matches
  const rank = (title: string, genres?: string | null) =>
    title.toLowerCase().startsWith(q) ? 0 : title.toLowerCase().includes(q) ? 1 : genreHit(genres) ? 2 : 3;
  const genreHit = (genres?: string | null) =>
    q.length >= 3 && parseGenres(genres).some((g) => g.toLowerCase().includes(q));
  const mm = dedupeMovies(movies.data ?? [])
    .filter((m) => m.title.toLowerCase().includes(q) || genreHit(m.genres))
    .sort((a, b) => rank(a.title, a.genres) - rank(b.title, b.genres) || a.title.localeCompare(b.title));
  const ss = (shows.data ?? [])
    .filter((s) => s.title.toLowerCase().includes(q) || genreHit(s.genres))
    .sort((a, b) => rank(a.title, a.genres) - rank(b.title, b.genres) || a.title.localeCompare(b.title));
  const ee = eps.data ?? [];
  const empty = mm.length === 0 && ss.length === 0 && ee.length === 0;

  return (
    <div className="px-8 py-6">
      <h1 className="text-2xl font-black mb-6 flex items-center gap-3">
        <Search className="w-6 h-6 text-ghg-red" /> Ergebnisse für „{params.get("q")}"
        <span className="text-base font-normal text-ghg-muted">({mm.length + ss.length + ee.length})</span>
      </h1>

      {empty ? (
        <EmptyState title="Nichts gefunden" hint="Versuche einen anderen Suchbegriff – gesucht wird in Filmen, Serien und Folgentiteln." />
      ) : (
        <div className="space-y-8">
          {ss.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Serien <span className="text-sm font-normal text-ghg-muted">({ss.length})</span></h2>
              <div className="flex flex-wrap gap-4">
                {ss.map((s) => (
                  <ShowCardItem key={s.id} show={s} onIdentify={setIdentify} />
                ))}
              </div>
            </div>
          )}
          {mm.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Filme <span className="text-sm font-normal text-ghg-muted">({mm.length})</span></h2>
              <div className="flex flex-wrap gap-4">
                {mm.map((m) => (
                  <MovieCardItem key={m.id} movie={m} onIdentify={setIdentify} />
                ))}
              </div>
            </div>
          )}
          {ee.length > 0 && (
            <div>
              <h2 className="text-lg font-bold mb-3">Folgen <span className="text-sm font-normal text-ghg-muted">({ee.length})</span></h2>
              <div className="space-y-1.5 max-w-3xl">
                {ee.map((ep) => (
                  <button
                    key={ep.id}
                    onClick={() => navigate(`/play/episode/${ep.id}`)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-ghg-surface2 border border-transparent hover:border-ghg-line transition text-left group"
                  >
                    <div className="w-24 aspect-video rounded-md overflow-hidden bg-ghg-bg2 shrink-0 relative">
                      {stillUrl(ep.stillPath) && (
                        <img src={stillUrl(ep.stillPath)!} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
                      )}
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition">
                        <Play className="w-5 h-5 fill-white" />
                      </div>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {ep.title || "Folge"}
                        <span className="text-ghg-muted font-normal"> · {seasonEpisodeLabel(ep.season, ep.episode)}</span>
                      </p>
                      <p className="text-xs text-ghg-muted truncate">{ep.showTitle}</p>
                    </div>
                  </button>
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

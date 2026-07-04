import { useQuery } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState } from "react";
import { tmdbExtras } from "../lib/api";
import { Button, Modal } from "./ui";

export function Extras({ mediaType, tmdbId }: { mediaType: "movie" | "tv"; tmdbId?: number | null }) {
  const [trailer, setTrailer] = useState(false);
  const { data } = useQuery({
    queryKey: ["extras", mediaType, tmdbId],
    queryFn: () => tmdbExtras(mediaType, tmdbId as number),
    enabled: !!tmdbId,
  });

  if (!tmdbId) return null;
  const cast = data?.cast ?? [];

  return (
    <div className="mt-8">
      {data?.trailerKey && (
        <Button onClick={() => setTrailer(true)} className="mb-6">
          <Play className="w-4 h-4 fill-white" /> Trailer ansehen
        </Button>
      )}

      {cast.length > 0 && (
        <>
          <h3 className="text-lg font-bold mb-3">Besetzung</h3>
          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
            {cast.map((c, i) => (
              <div key={i} className="w-24 shrink-0 text-center">
                <div className="w-24 h-24 rounded-full overflow-hidden bg-ghg-surface2 mx-auto mb-2 border border-ghg-line">
                  {c.profilePath && (
                    <img src={`https://image.tmdb.org/t/p/w185${c.profilePath}`} alt={c.name} className="w-full h-full object-cover" loading="lazy" />
                  )}
                </div>
                <p className="text-xs font-semibold line-clamp-1">{c.name}</p>
                {c.character && <p className="text-[11px] text-ghg-muted line-clamp-1">{c.character}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      <Modal open={trailer} onClose={() => setTrailer(false)} title="Trailer" wide>
        {data?.trailerKey && (
          <div className="aspect-video w-full">
            <iframe
              className="w-full h-full rounded-lg"
              src={`https://www.youtube.com/embed/${data.trailerKey}?autoplay=1`}
              title="Trailer"
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          </div>
        )}
      </Modal>
    </div>
  );
}

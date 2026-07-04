import { Check, Info, Play, Plus, Star } from "lucide-react";
import { Button } from "./ui";

export function Hero({
  title,
  overview,
  backdrop,
  meta,
  quality,
  year,
  genres,
  rating,
  cert,
  isFavorite,
  onToggleFavorite,
  onPlay,
  onDetails,
}: {
  title: string;
  overview?: string | null;
  backdrop?: string | null;
  meta?: string | null;
  quality?: string | null;
  year?: number | null;
  genres?: string[];
  rating?: string | null;
  cert?: string | null;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onPlay?: () => void;
  onDetails?: () => void;
}) {
  return (
    <div className="relative h-[56vh] min-h-[380px] w-full mb-4">
      {backdrop ? (
        <img
          key={backdrop}
          src={backdrop}
          alt=""
          className="absolute inset-0 w-full h-full object-cover fade-in"
          draggable={false}
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-ghg-surface2 to-ghg-bg" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-ghg-bg via-ghg-bg/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-ghg-bg/95 via-ghg-bg/40 to-transparent" />

      <div className="relative h-full flex flex-col justify-end p-10 max-w-2xl">
        <h1 className="text-5xl font-black mb-3 text-glow leading-tight">{title}</h1>
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          {meta && <span className="text-sm font-semibold text-ghg-red">{meta}</span>}
          {year && <span className="text-sm text-ghg-muted">{year}</span>}
          {rating && (
            <span className="flex items-center gap-1 text-sm text-ghg-muted">
              <Star className="w-3.5 h-3.5 fill-yellow-400 text-yellow-400" /> {rating}
            </span>
          )}
          {cert && (
            <span className="px-1.5 py-0.5 rounded border border-white/30 text-[11px] font-semibold text-white/80">
              {cert}
            </span>
          )}
          {quality && (
            <span className="px-1.5 py-0.5 rounded bg-white/15 text-xs font-bold tracking-wide">{quality}</span>
          )}
          {genres && genres.length > 0 && (
            <span className="text-sm text-ghg-muted">{genres.slice(0, 3).join(" · ")}</span>
          )}
        </div>
        {overview && <p className="text-sm text-ghg-text/80 line-clamp-3 mb-6">{overview}</p>}
        <div className="flex gap-3">
          {onPlay && (
            <Button onClick={onPlay}>
              <Play className="w-4 h-4 fill-white" /> Abspielen
            </Button>
          )}
          {onToggleFavorite && (
            <Button variant="ghost" onClick={onToggleFavorite}>
              {isFavorite ? <Check className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Meine Liste
            </Button>
          )}
          {onDetails && (
            <Button variant="ghost" onClick={onDetails}>
              <Info className="w-4 h-4" /> Mehr Infos
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

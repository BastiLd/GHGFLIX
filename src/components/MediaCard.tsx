import clsx from "clsx";
import { Check, Heart, MoreVertical, Play, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { openCtx } from "../lib/contextmenu";

export interface CardAction {
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface MediaCardProps {
  title: string;
  subtitle?: string | null;
  poster?: string | null;
  wide?: boolean;
  progress?: number;
  rating?: string | null;
  badge?: string | null;
  quality?: string | null;
  isNew?: boolean;
  watched?: boolean;
  favorite?: boolean;
  onOpen?: () => void;
  actions?: CardAction[];
}

export function MediaCard({
  title,
  subtitle,
  poster,
  wide,
  progress,
  rating,
  badge,
  quality,
  isNew,
  watched,
  favorite,
  onOpen,
  actions,
}: MediaCardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <div
      className={clsx(
        "group relative shrink-0 transition-transform duration-200 hover:scale-[1.05] hover:z-10",
        wide ? "media-card-wide" : "media-card",
      )}
      onContextMenu={actions && actions.length ? (e) => openCtx(e, actions) : undefined}
    >
      <div
        className={clsx(
          "relative overflow-hidden rounded-xl bg-ghg-surface2 border border-ghg-line cursor-pointer",
          "shadow-lg group-hover:shadow-ghg-glow group-hover:border-ghg-red/60 transition",
          wide ? "aspect-video" : "aspect-[2/3]",
        )}
        onClick={onOpen}
      >
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="w-full h-full object-cover opacity-0 transition-opacity duration-300"
            loading="lazy"
            draggable={false}
            onLoad={(e) => e.currentTarget.classList.remove("opacity-0")}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-3 bg-gradient-to-br from-ghg-surface2 to-ghg-bg text-center">
            <span className="text-sm font-semibold text-ghg-muted line-clamp-4">{title}</span>
          </div>
        )}

        {/* hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-3">
          <div className="w-full">
            <p className="text-sm font-bold leading-tight line-clamp-2">{title}</p>
            {subtitle && <p className="text-xs text-ghg-muted mt-0.5 line-clamp-1">{subtitle}</p>}
          </div>
        </div>

        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition">
          <div className="w-12 h-12 rounded-full bg-ghg-red/90 flex items-center justify-center shadow-lg">
            <Play className="w-6 h-6 fill-white text-white ml-0.5" />
          </div>
        </div>

        {badge && (
          <span className="absolute top-2 left-2 zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
            {badge}
          </span>
        )}
        {!badge && isNew && (
          <span className="absolute top-2 left-2 zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide badge-pulse">
            Neu
          </span>
        )}

        {rating && (
          <span className="absolute top-2 left-2 flex items-center gap-1 bg-black/70 rounded px-1.5 py-0.5 text-[11px] font-semibold opacity-0 group-hover:opacity-100 transition">
            <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
            {rating}
          </span>
        )}

        {quality && (
          <span className="absolute bottom-2 left-2 bg-black/75 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white/90 group-hover:opacity-0 transition">
            {quality}
          </span>
        )}

        {/* fully-watched checkmark + favorite heart (top-right, stacked) */}
        <div className="absolute top-2 right-2 flex flex-col gap-1 items-end group-hover:opacity-0 transition">
          {watched && (
            <span className="w-5 h-5 rounded-full bg-ghg-red flex items-center justify-center shadow" title="Gesehen">
              <Check className="w-3.5 h-3.5 text-white" />
            </span>
          )}
          {favorite && (
            <span className="w-5 h-5 rounded-full bg-black/70 flex items-center justify-center shadow" title="Meine Liste">
              <Heart className="w-3 h-3 fill-ghg-red text-ghg-red" />
            </span>
          )}
        </div>

        {progress != null && progress > 0 && !watched && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div className="h-full bg-ghg-red" style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </div>
        )}
      </div>

      {actions && actions.length > 0 && (
        <div ref={menuRef} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition z-20">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((o) => !o);
            }}
            className="p-1.5 rounded-lg bg-black/70 hover:bg-ghg-red text-white transition"
            title="Optionen"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-48 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden pop-in">
              {actions.map((a, i) => (
                <button
                  key={i}
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    a.onClick();
                  }}
                  className={clsx(
                    "w-full text-left px-3 py-2 text-sm hover:bg-ghg-surface2 transition",
                    a.danger ? "text-ghg-red" : "text-ghg-text",
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!wide && (
        <div className="mt-2 px-0.5">
          <p className="text-sm font-medium leading-tight line-clamp-1" title={title}>{title}</p>
          {subtitle && <p className="text-xs text-ghg-muted line-clamp-1">{subtitle}</p>}
        </div>
      )}
    </div>
  );
}

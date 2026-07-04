import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

/** Horizontal media row. Wheel scrolling is handled by ONE global document
 *  listener (lib/useHorizontalWheel.ts) — no per-row listeners that could die
 *  on re-mounts. This component only renders the chevrons/paddles. */
export function MediaRow({ title, children }: { title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScroll, setCanScroll] = useState(false);

  // only show the chevrons when the row actually overflows
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setCanScroll(el.scrollWidth > el.clientWidth + 1);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children]);

  const scroll = (dir: -1 | 1) => {
    // NOTE: the row must NOT have CSS `scroll-behavior:smooth` — it would fight
    // the global wheel handler's per-frame scrollLeft writes.
    ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  };

  return (
    <section className="mb-8 group/row">
      <div className="flex items-center justify-between mb-3 px-8">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <span className="inline-block w-1.5 h-5 bg-ghg-red rounded-sm" />
          {title}
        </h2>
        {canScroll && (
          <div className="flex gap-1 opacity-0 group-hover/row:opacity-100 transition">
            <button onClick={() => scroll(-1)} className="p-1 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text" title="Nach links">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button onClick={() => scroll(1)} className="p-1 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text" title="Nach rechts">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
      <div className="relative">
        <div ref={ref} className="flex gap-4 overflow-x-auto no-scrollbar px-8 pb-2">
          {children}
        </div>
        {/* full-height paddle arrows at the row edges (Netflix-style). They are
            pointer-events-none while hidden so they never swallow wheel events. */}
        {canScroll && (
          <>
            <button
              onClick={() => scroll(-1)}
              className="absolute inset-y-0 left-0 w-9 flex items-center justify-center bg-gradient-to-r from-ghg-bg/90 to-transparent opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto transition text-white/80 hover:text-white z-10"
              title="Nach links"
            >
              <ChevronLeft className="w-7 h-7" />
            </button>
            <button
              onClick={() => scroll(1)}
              className="absolute inset-y-0 right-0 w-9 flex items-center justify-center bg-gradient-to-l from-ghg-bg/90 to-transparent opacity-0 pointer-events-none group-hover/row:opacity-100 group-hover/row:pointer-events-auto transition text-white/80 hover:text-white z-10"
              title="Nach rechts"
            >
              <ChevronRight className="w-7 h-7" />
            </button>
          </>
        )}
        {/* edge fades so cards melt into the page at the row ends */}
        <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-ghg-bg to-transparent" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-ghg-bg to-transparent" />
      </div>
    </section>
  );
}

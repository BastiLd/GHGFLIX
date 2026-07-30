import { useCallback, useEffect, useRef, useState } from "react";
import { formatTime } from "../lib/format";

/** Vorgeneriertes Sprite-Blatt (Trickplay) — EIN Bild mit allen Vorschau-
 *  positionen. Liegt es vor, kostet jede Mausbewegung null Netzwerk. */
export interface TrickplaySprite {
  url: string;
  /** Sekunden zwischen zwei Bildern */
  interval: number;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  count: number;
}

/** Netflix/Plex-artige Suchleiste: drüberfahren oder ziehen zum Spulen, mit
 *  Vorschaubild über dem Zeiger.
 *
 *  Zwei Quellen für das Bild:
 *   1. `sprite` — vorgeneriertes Blatt, sofortige Anzeige ohne Nachladen
 *   2. `getThumb` — Einzelbild auf Anfrage (gedrosselt + gecacht je Zeitfenster)
 */
export function Scrubber({
  position,
  duration,
  buffered = 0,
  onSeek,
  getThumb,
  interval = 5,
  previewWidth = 176,
  aspect = 16 / 9,
  sprite = null,
  markers,
  intro,
}: {
  position: number;
  duration: number;
  buffered?: number;
  onSeek: (t: number) => void;
  getThumb: (t: number) => Promise<string | null>;
  interval?: number;
  previewWidth?: number;
  /** echtes Seitenverhältnis des Videos (Breite/Höhe) — damit die Vorschau bei
   *  4:3- oder 21:9-Material nicht mehr verzerrt bzw. beschnitten wird */
  aspect?: number;
  sprite?: TrickplaySprite | null;
  /** Kapitelmarken (Sekunden) als kleine Striche */
  markers?: number[];
  /** Intro-Bereich als hervorgehobener Abschnitt */
  intro?: { start: number; end: number } | null;
}) {
  const BUCKET = Math.max(1, interval);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; t: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dragT, setDragT] = useState(0);
  const [thumb, setThumb] = useState<string | null>(null);

  const cacheRef = useRef<Map<number, string>>(new Map());
  const wantRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastSeekRef = useRef(0);

  // Single-flight extractor: only one thumbnail request runs at a time; the latest
  // requested bucket always wins, so fast scrubbing never piles up ffmpeg calls.
  const runThumb = useCallback(async () => {
    timerRef.current = null;
    if (busyRef.current) return;
    const bucket = wantRef.current;
    if (bucket == null) return;
    wantRef.current = null;
    busyRef.current = true;
    try {
      const url = await getThumb(bucket);
      if (url) {
        cacheRef.current.set(bucket, url);
        setThumb(url);
      }
    } catch {
      /* ignore extraction failures */
    } finally {
      busyRef.current = false;
    }
    if (wantRef.current != null && timerRef.current == null) {
      timerRef.current = window.setTimeout(runThumb, 30);
    }
  }, [getThumb]);

  const scheduleThumb = useCallback(
    (t: number) => {
      if (duration <= 0) return;
      if (sprite) return; // Sprite-Blatt deckt alles ab — kein Nachladen nötig
      const bucket = Math.min(duration, Math.max(0, Math.round(t / BUCKET) * BUCKET));
      const cached = cacheRef.current.get(bucket);
      if (cached) {
        setThumb(cached);
        wantRef.current = null;
        return;
      }
      wantRef.current = bucket;
      if (timerRef.current == null && !busyRef.current) timerRef.current = window.setTimeout(runThumb, 110);
    },
    [duration, runThumb, BUCKET, sprite],
  );

  const timeFromEvent = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el || duration <= 0) return { x: 0, t: 0 };
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(clientX - r.left, 0), r.width);
      const t = (x / r.width) * duration;
      return { x, t };
    },
    [duration],
  );

  const onMove = useCallback(
    (clientX: number) => {
      const { x, t } = timeFromEvent(clientX);
      setHover({ x, t });
      scheduleThumb(t);
      if (dragging) setDragT(t);
    },
    [timeFromEvent, scheduleThumb, dragging],
  );

  // window-level listeners while dragging so the drag continues outside the bar
  useEffect(() => {
    if (!dragging) return;
    const mv = (e: PointerEvent) => {
      e.preventDefault();
      onMove(e.clientX);
      // throttle the actual seek (~10/s) so dragging stays smooth; the thumbnail
      // preview and knob still follow the cursor every frame.
      const now = performance.now();
      if (now - lastSeekRef.current > 90) {
        lastSeekRef.current = now;
        onSeek(timeFromEvent(e.clientX).t);
      }
    };
    const up = (e: PointerEvent) => {
      const { t } = timeFromEvent(e.clientX);
      onSeek(t); // final precise seek
      setDragging(false);
    };
    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, onMove, onSeek, timeFromEvent]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const shownT = dragging ? dragT : position;
  const pct = duration > 0 ? Math.min(100, (shownT / duration) * 100) : 0;
  const hoverPct = hover && duration > 0 ? Math.min(100, (hover.t / duration) * 100) : 0;
  const bufPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  // Vorschau am Rand einfangen, damit sie nie über die Leiste hinausragt
  const previewW = previewWidth;
  // Höhe folgt dem ECHTEN Seitenverhältnis des Videos (vorher fest 16:9 —
  // dadurch war die Vorschau bei 4:3- und Cinemascope-Material beschnitten)
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 && aspect < 5 ? aspect : 16 / 9;
  const previewH = Math.round(previewW / safeAspect);
  const clampX = hover ? Math.min(Math.max(hover.x, previewW / 2), (trackRef.current?.clientWidth ?? 0) - previewW / 2) : 0;

  // Sprite-Blatt: Kachel zur Zeit ausrechnen und per background-position zeigen
  let spriteStyle: React.CSSProperties | null = null;
  if (sprite && hover && sprite.count > 0) {
    const idx = Math.min(sprite.count - 1, Math.max(0, Math.floor(hover.t / sprite.interval)));
    const col = idx % sprite.cols;
    const row = Math.floor(idx / sprite.cols);
    const scale = previewW / sprite.tileWidth;
    const tileH = sprite.tileHeight * scale;
    spriteStyle = {
      backgroundImage: `url(${sprite.url})`,
      backgroundSize: `${sprite.cols * previewW}px ${sprite.rows * tileH}px`,
      backgroundPosition: `-${col * previewW}px -${row * tileH}px`,
      backgroundRepeat: "no-repeat",
      height: tileH,
    };
  }

  return (
    <div className="relative flex-1">
      {/* schwebende Vorschau */}
      {hover && (
        <div
          className="absolute -top-2 -translate-y-full -translate-x-1/2 pointer-events-none z-30"
          style={{ left: clampX }}
        >
          <div className="rounded-lg overflow-hidden border border-white/20 bg-black shadow-2xl" style={{ width: previewW }}>
            {spriteStyle ? (
              <div style={spriteStyle} />
            ) : (
              <div className="bg-ghg-bg2 flex items-center justify-center" style={{ height: previewH }}>
                {thumb ? (
                  <img src={thumb} alt="" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className="text-[11px] text-ghg-muted">Vorschau …</span>
                )}
              </div>
            )}
          </div>
          <p className="text-center mt-1 text-xs font-mono font-semibold drop-shadow">{formatTime(hover.t)}</p>
        </div>
      )}

      {/* hit area (tall, for easy grabbing) */}
      <div
        ref={trackRef}
        className="group relative h-5 flex items-center cursor-pointer"
        onPointerMove={(e) => onMove(e.clientX)}
        onPointerLeave={() => !dragging && setHover(null)}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const { t } = timeFromEvent(e.clientX);
          setDragT(t);
          setDragging(true);
          onSeek(t);
        }}
      >
        <div className="relative w-full h-1.5 rounded-full bg-white/25 overflow-visible">
          {/* intro window highlight */}
          {intro && duration > 0 && intro.end > intro.start && (
            <div
              className="absolute top-0 h-full bg-yellow-400/40"
              title="Intro"
              style={{
                left: `${Math.min(100, (intro.start / duration) * 100)}%`,
                width: `${Math.min(100, ((intro.end - intro.start) / duration) * 100)}%`,
              }}
            />
          )}
          {/* buffered fill */}
          {bufPct > 0 && (
            <div className="absolute left-0 top-0 h-full rounded-full bg-white/40" style={{ width: `${bufPct}%` }} />
          )}
          {/* hover ghost fill */}
          {hover && (
            <div className="absolute left-0 top-0 h-full rounded-full bg-white/30" style={{ width: `${hoverPct}%` }} />
          )}
          {/* played fill */}
          <div className="absolute left-0 top-0 h-full rounded-full bg-ghg-red" style={{ width: `${pct}%` }} />
          {/* chapter ticks */}
          {markers && duration > 0 &&
            markers
              .filter((m) => m > 1 && m < duration - 1)
              .map((m, i) => (
                <div
                  key={i}
                  className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-white/70 rounded"
                  style={{ left: `${(m / duration) * 100}%` }}
                />
              ))}
          {/* knob */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-ghg-red shadow ring-2 ring-white/70 opacity-0 group-hover:opacity-100 transition"
            style={{ left: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}

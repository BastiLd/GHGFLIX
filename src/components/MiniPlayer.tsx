import { ListVideo, Maximize2, Pause, Play, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { command, destroy, observeProperties, setProperty } from "../lib/mpv";
import { getEpisode, getMovie, setProgress } from "../lib/api";
import { formatTime, seasonEpisodeLabel } from "../lib/format";
import { applyMiniMargins, miniRect, playback, usePlayback } from "../lib/playback";
import { useStore } from "../lib/store";
import { uiPrefs, useUiPrefs } from "../lib/uiPrefs";

/** YouTube-style mini-player: the mpv video keeps running, shrunk into the
 *  bottom-right corner (the Layout paints a clip-path hole there). This overlay
 *  sits exactly on top of the hole and draws hover controls. It has its own
 *  property observers and progress saving, so the full Player page can unmount. */
export function MiniPlayer() {
  const mini = usePlayback((s) => s.mini);
  const queue = usePlayback((s) => s.queue);
  const size = useUiPrefs((s) => s.miniSize);
  const profileId = useStore((s) => s.profileId);
  const toast = useStore((s) => s.toast);
  const navigate = useNavigate();

  const [paused, setPaused] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const [hover, setHover] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const posRef = useRef(0);
  const durRef = useRef(0);
  const lastSaveRef = useRef(0);
  const endedRef = useRef(false);
  const miniRef = useRef(mini);
  miniRef.current = mini;

  const saveNow = useCallback(
    (watched = false) => {
      const m = miniRef.current;
      if (!m || durRef.current <= 0) return;
      // same user-configurable watched threshold as the full player
      const thr = Math.min(0.99, Math.max(0.5, (uiPrefs().watchedThreshold || 95) / 100));
      const done = watched || posRef.current >= durRef.current * thr;
      setProgress(profileId, m.mediaType, m.mediaId, posRef.current, durRef.current, done).catch(() => {});
    },
    [profileId],
  );

  /** Load another item INTO the running mini player (queue advance). */
  const playInMini = useCallback(
    async (mediaType: "movie" | "episode", id: number) => {
      try {
        if (mediaType === "episode") {
          const ep = await getEpisode(id);
          if (!ep) return;
          playback().setMini({
            mediaType,
            mediaId: id,
            title: ep.showTitle || "Folge",
            subtitle: `${seasonEpisodeLabel(ep.season, ep.episode)}${ep.title ? " · " + ep.title : ""}`,
            path: ep.path,
          });
          await command("loadfile", [ep.path]);
        } else {
          const m = await getMovie(id);
          if (!m) return;
          playback().setMini({ mediaType, mediaId: id, title: m.title, subtitle: m.year ? String(m.year) : null, path: m.path });
          await command("loadfile", [m.path]);
        }
        endedRef.current = false;
        setProperty("pause", false).catch(() => {});
      } catch (e) {
        toast(String(e), "error");
      }
    },
    [toast],
  );

  const advanceQueue = useCallback(() => {
    const next = playback().popNext();
    if (next) {
      void playInMini(next.mediaType, next.id);
    } else {
      // nothing queued → stop the mini player
      saveNow(true);
      void destroy().catch(() => {});
      playback().setInited(false);
      playback().setMini(null);
    }
  }, [playInMini, saveNow]);

  // own observers while the mini player is alive
  useEffect(() => {
    if (!mini) return;
    // a previous mini session may have ended at EOF — this is a NEW session
    endedRef.current = false;
    document.documentElement.classList.add("mpv-mini");
    applyMiniMargins(true, size);
    const onResize = () => applyMiniMargins(true, size);
    window.addEventListener("resize", onResize);

    let un: (() => void) | null = null;
    let disposed = false;
    void observeProperties(["pause", "time-pos", "duration", "eof-reached"], ({ name, data }) => {
      if (name === "pause") setPaused(Boolean(data));
      else if (name === "duration") {
        const d = Number(data) || 0;
        durRef.current = d;
        setDur(d);
      } else if (name === "time-pos") {
        const p = Number(data) || 0;
        posRef.current = p;
        setPos((prev) => (Math.floor(prev) === Math.floor(p) ? prev : p));
        const now = Date.now();
        if (now - lastSaveRef.current > 5000) {
          lastSaveRef.current = now;
          saveNow();
        }
      } else if (name === "eof-reached" && data === true) {
        if (!endedRef.current) {
          endedRef.current = true;
          saveNow(true);
          advanceQueue();
        }
      }
    }).then((u) => {
      // the effect may already be cleaned up before this async subscribe
      // resolves — unsubscribe immediately instead of leaking the observer
      if (disposed) u();
      else un = u;
    });

    return () => {
      disposed = true;
      window.removeEventListener("resize", onResize);
      document.documentElement.classList.remove("mpv-mini");
      if (un) un();
    };
  }, [mini != null, size]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mini) return null;
  const { w, h, right, bottom } = miniRect(size);

  const expand = () => {
    saveNow();
    playback().setExpandTo({ mediaType: mini.mediaType, mediaId: mini.mediaId, path: mini.path });
    playback().setMini(null);
    navigate(`/play/${mini.mediaType}/${mini.mediaId}`);
  };

  const close = () => {
    saveNow();
    void destroy().catch(() => {});
    playback().setInited(false);
    playback().setMini(null);
  };

  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  return (
    <div
      className="fixed z-[150] rounded-xl overflow-hidden border border-ghg-line shadow-2xl"
      style={{ width: w, height: h, right, bottom }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => {
        setHover(false);
        setShowQueue(false);
      }}
      onDoubleClick={expand}
    >
      {/* transparent center: the video shows through the Layout's clip-path hole */}
      <div className="absolute inset-0" onClick={() => setProperty("pause", !paused).catch(() => {})} />

      {/* hover controls */}
      <div
        className={`absolute inset-0 flex flex-col justify-between transition-opacity ${hover ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      >
        <div className="flex items-start justify-between p-2 bg-gradient-to-b from-black/80 to-transparent">
          <button
            onClick={expand}
            className="min-w-0 text-left"
            title="Im großen Player öffnen"
          >
            <p className="text-xs font-bold truncate">{mini.title}</p>
            {mini.subtitle && <p className="text-[10px] text-white/70 truncate">{mini.subtitle}</p>}
          </button>
          <div className="flex gap-1 shrink-0">
            <button onClick={expand} className="p-1.5 rounded-md bg-black/50 hover:bg-ghg-red transition" title="Vergrößern">
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={close} className="p-1.5 rounded-md bg-black/50 hover:bg-ghg-red transition" title="Schließen">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="bg-gradient-to-t from-black/85 to-transparent p-2 pt-4">
          <div className="flex items-center gap-2 mb-1.5">
            <button
              onClick={() => setProperty("pause", !paused).catch(() => {})}
              className="p-1.5 rounded-full bg-ghg-red hover:bg-ghg-red-bright transition"
            >
              {paused ? <Play className="w-3.5 h-3.5 fill-white" /> : <Pause className="w-3.5 h-3.5 fill-white" />}
            </button>
            {queue.length > 0 && (
              <>
                <button onClick={advanceQueue} className="p-1.5 rounded-md hover:bg-white/15 transition" title="Nächstes aus der Warteschlange">
                  <SkipForward className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowQueue((o) => !o)}
                  className={`p-1.5 rounded-md hover:bg-white/15 transition ${showQueue ? "text-ghg-red" : ""}`}
                  title="Warteschlange"
                >
                  <ListVideo className="w-4 h-4" />
                </button>
              </>
            )}
            <span className="ml-auto text-[10px] font-mono tabular-nums text-white/80">
              {formatTime(pos)} / {formatTime(dur)}
            </span>
          </div>
          <div
            className="h-1 rounded-full bg-white/25 cursor-pointer"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const t = ((e.clientX - r.left) / r.width) * dur;
              command("seek", [t, "absolute"]).catch(() => {});
            }}
          >
            <div className="h-full bg-ghg-red rounded-full" style={{ width: `${pct}%` }} />
          </div>
        </div>
      </div>

      {/* queue popup */}
      {showQueue && queue.length > 0 && (
        <div className="absolute bottom-14 right-1 left-1 max-h-40 overflow-y-auto bg-ghg-elevated/95 border border-ghg-line rounded-lg p-1.5 space-y-1">
          {queue.map((q) => (
            <div key={q.key} className="flex items-center gap-2 text-[11px] px-1.5 py-1 rounded hover:bg-ghg-surface2">
              <span className="min-w-0 flex-1 truncate">{q.label}{q.sub ? ` · ${q.sub}` : ""}</span>
              <button onClick={() => playback().removeFromQueue(q.key)} className="text-ghg-muted hover:text-ghg-red shrink-0">
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

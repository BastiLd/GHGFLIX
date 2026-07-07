import clsx from "clsx";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { setArtwork, tmdbImages } from "../lib/api";
import { backdropUrl, posterUrl, stillUrl } from "../lib/img";
import { useStore } from "../lib/store";
import type { ArtworkTarget, TmdbImage } from "../lib/types";
import { Modal, Spinner } from "./ui";

type Tab = "poster" | "backdrop" | "still";

/** Plex-style artwork picker: lists the images TMDb has for the item and lets the
 *  user pick one. The choice is locked so metadata refreshes won't overwrite it. */
export function ArtworkDialog({
  open,
  onClose,
  target,
  onDone,
  initialTab,
}: {
  open: boolean;
  onClose: () => void;
  target: ArtworkTarget;
  onDone?: () => void;
  /** open directly on "poster" or "backdrop" (separate Poster/Banner buttons) */
  initialTab?: Tab;
}) {
  const toast = useStore((s) => s.toast);
  const qc = useQueryClient();
  const [images, setImages] = useState<TmdbImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const tabs: Tab[] = useMemo(() => {
    if (target.target === "movie" || target.target === "show") return ["poster", "backdrop"];
    if (target.target === "season") return ["poster"];
    return ["still"];
  }, [target.target]);
  const [tab, setTab] = useState<Tab>(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]);

  const mediaType = target.target === "movie" ? "movie" : target.target === "show" ? "tv" : target.target;

  useEffect(() => {
    if (!open) return;
    setTab(initialTab && tabs.includes(initialTab) ? initialTab : tabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tabs]);

  useEffect(() => {
    if (!open) return;
    if (!target.tmdbId) return;
    let cancelled = false;
    setLoading(true);
    const season = "season" in target ? target.season : undefined;
    const episode = "episode" in target ? target.episode : undefined;
    tmdbImages(mediaType as any, target.tmdbId, season, episode)
      .then((imgs) => !cancelled && setImages(imgs))
      .catch((e) => !cancelled && toast(String(e), "error"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target.tmdbId, mediaType]);

  const shown = images.filter((i) => i.kind === tab);

  const thumb = (path: string) =>
    tab === "poster" ? posterUrl(path, "w342") : tab === "still" ? stillUrl(path, "w300") : backdropUrl(path, "w780");

  const pick = async (img: TmdbImage) => {
    setBusy(img.filePath);
    try {
      const field = tab === "backdrop" ? "backdrop" : "poster";
      const season = "season" in target ? target.season : undefined;
      const t = target.target;
      await setArtwork(t, target.id, img.filePath, { field, season });
      qc.invalidateQueries();
      toast("Bild aktualisiert", "success");
      onDone?.();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const dialogTitle =
    target.target === "episode"
      ? `Bild ändern · ${target.title}`
      : target.target === "season"
        ? `Staffel ${target.season} – Bild ändern`
        : `Bild ändern · ${target.title}`;

  return (
    <Modal open={open} onClose={onClose} title={dialogTitle} wide>
      {!target.tmdbId ? (
        <p className="text-sm text-ghg-muted py-8 text-center">
          Dieses Element ist noch nicht mit TMDb verknüpft. Identifiziere es zuerst, dann kannst du Bilder auswählen.
        </p>
      ) : (
        <div className="space-y-4">
          {tabs.length > 1 && (
            <div className="flex gap-1 bg-ghg-bg2 rounded-lg p-1 w-fit">
              {tabs.map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={clsx(
                    "px-4 py-1.5 rounded-md text-sm font-semibold transition",
                    tab === k ? "bg-ghg-red text-white" : "text-ghg-muted hover:text-ghg-text",
                  )}
                >
                  {k === "poster" ? "Poster" : k === "backdrop" ? "Hintergrund" : "Vorschaubild"}
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner className="w-8 h-8" />
            </div>
          ) : shown.length === 0 ? (
            <p className="text-sm text-ghg-muted text-center py-12">Keine Bilder gefunden.</p>
          ) : (
            <div
              className={clsx(
                "grid gap-3 max-h-[55vh] overflow-y-auto pr-1",
                tab === "poster" ? "grid-cols-4 sm:grid-cols-5" : "grid-cols-2 sm:grid-cols-3",
              )}
            >
              {shown.map((img) => {
                const src = thumb(img.filePath);
                return (
                  <button
                    key={img.filePath}
                    onClick={() => pick(img)}
                    disabled={!!busy}
                    className={clsx(
                      "group relative overflow-hidden rounded-lg border border-ghg-line bg-ghg-bg2",
                      "hover:border-ghg-red focus:border-ghg-red transition disabled:opacity-50",
                      tab === "poster" ? "aspect-[2/3]" : "aspect-video",
                    )}
                  >
                    {src && <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                      {busy === img.filePath ? (
                        <Spinner className="w-6 h-6" />
                      ) : (
                        <span className="px-2 py-1 rounded-md bg-ghg-red text-xs font-semibold flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Wählen
                        </span>
                      )}
                    </div>
                    {img.lang && img.lang !== "xx" && (
                      <span className="absolute top-1 right-1 bg-black/70 rounded px-1 text-[10px] uppercase">
                        {img.lang}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

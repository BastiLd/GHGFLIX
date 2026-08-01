import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Bell, BellOff, ExternalLink, Newspaper, Play, RefreshCw, Trash2, Video } from "lucide-react";
import { useState } from "react";
import {
  feedAdd,
  feedItems,
  feedMarkRead,
  feedRefresh,
  feedRemove,
  feedUpdate,
  feedsList,
} from "../lib/api";
import { openUrl } from "../lib/backend";
import { useStore } from "../lib/store";
import { Button, EmptyState, Modal, Spinner, TextInput } from "../components/ui";
import type { FeedBeitrag } from "../lib/types";

type Art = "youtube" | "blog";

function vorZeit(ms: number) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return "gerade eben";
  const m = Math.floor(s / 60);
  if (m < 60) return `vor ${m} Min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std`;
  const t = Math.floor(h / 24);
  if (t < 30) return `vor ${t} Tag${t === 1 ? "" : "en"}`;
  return new Date(ms).toLocaleDateString("de-DE");
}

/**
 * Kanäle & Feeds (Punkt 5 der Übergabe).
 *
 * Zwei Bereiche, technisch dasselbe: abonnierte YouTube-Kanäle und beliebige
 * RSS-/Atom-Feeds für Leaks und Blogs. Der Server holt sie regelmäßig ab, hier
 * werden sie gelesen — deshalb ist die Zahl auch dann richtig, wenn die
 * Oberfläche stundenlang zu war.
 */
export default function Feeds() {
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);
  const [art, setArt] = useState<Art>("youtube");
  const [neuUrl, setNeuUrl] = useState("");
  const [laedt, setLaedt] = useState(false);
  const [video, setVideo] = useState<FeedBeitrag | null>(null);
  const [verwalten, setVerwalten] = useState(false);

  const feeds = useQuery({ queryKey: ["feeds"], queryFn: feedsList });
  const beitraege = useQuery({ queryKey: ["feedItems", art], queryFn: () => feedItems(art, 80) });

  const meine = (feeds.data ?? []).filter((f) => f.art === art);
  const ungelesen = (beitraege.data ?? []).filter((b) => !b.gelesen).length;

  const auffrischen = () => {
    qc.invalidateQueries({ queryKey: ["feeds"] });
    qc.invalidateQueries({ queryKey: ["feedItems"] });
    qc.invalidateQueries({ queryKey: ["feedUnread"] });
  };

  const abonnieren = async () => {
    const url = neuUrl.trim();
    if (!url) return;
    setLaedt(true);
    try {
      const f = await feedAdd(url, art);
      setNeuUrl("");
      auffrischen();
      toast(`„${f.titel}“ abonniert`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLaedt(false);
    }
  };

  const jetztHolen = async () => {
    setLaedt(true);
    try {
      const r = await feedRefresh();
      auffrischen();
      toast(r.neu > 0 ? `${r.neu} neue Beiträge` : "Nichts Neues", r.neu > 0 ? "success" : "info");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLaedt(false);
    }
  };

  const oeffnen = (b: FeedBeitrag) => {
    // YouTube-Videos laufen direkt hier im Fenster; Blogeinträge gehören in
    // den Browser (eine fremde Seite in einem iframe geht meist ohnehin nicht).
    if (b.videoId) {
      setVideo(b);
      if (!b.gelesen) void feedMarkRead([b.id]).then(auffrischen);
      return;
    }
    if (b.url) void openUrl(b.url);
    if (!b.gelesen) void feedMarkRead([b.id]).then(auffrischen);
  };

  return (
    <div className="p-10">
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <h1 className="text-3xl font-black text-glow">Kanäle</h1>
        <div className="flex rounded-lg overflow-hidden border border-ghg-line ml-2">
          <button
            onClick={() => setArt("youtube")}
            className={clsx(
              "px-4 py-2 text-sm font-semibold flex items-center gap-2",
              art === "youtube" ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
            )}
          >
            <Video className="w-4 h-4" /> YouTube
          </button>
          <button
            onClick={() => setArt("blog")}
            className={clsx(
              "px-4 py-2 text-sm font-semibold flex items-center gap-2",
              art === "blog" ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
            )}
          >
            <Newspaper className="w-4 h-4" /> Leaks &amp; Blog
          </button>
        </div>

        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => void jetztHolen()} disabled={laedt}>
            {laedt ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />} Jetzt prüfen
          </Button>
          {ungelesen > 0 && (
            <Button
              variant="ghost"
              onClick={() =>
                void feedMarkRead((beitraege.data ?? []).filter((b) => !b.gelesen).map((b) => b.id)).then(() => {
                  auffrischen();
                  toast("Alles als gelesen markiert", "success");
                })
              }
            >
              Alles gelesen ({ungelesen})
            </Button>
          )}
          <Button variant="ghost" onClick={() => setVerwalten(true)}>
            Abos verwalten ({meine.length})
          </Button>
        </div>
      </div>

      {/* Abonnieren */}
      <div className="bg-ghg-surface border border-ghg-line rounded-2xl p-5 mb-8">
        <h2 className="text-base font-bold mb-1">
          {art === "youtube" ? "YouTube-Kanal abonnieren" : "Blog oder Leak-Quelle abonnieren"}
        </h2>
        <p className="text-sm text-ghg-muted mb-3">
          {art === "youtube"
            ? "Kanal-Adresse, @Name oder Kanal-ID (UC…). Kein YouTube-Konto und kein API-Schlüssel nötig — GHGFlix liest den offenen Kanal-Feed."
            : "Adresse der Seite oder direkt die Feed-Adresse (RSS/Atom). Ist auf der Seite ein Feed verlinkt, wird er von selbst gefunden."}
        </p>
        <div className="flex gap-2 flex-wrap">
          <div className="flex-1 min-w-64">
            <TextInput
              value={neuUrl}
              onChange={setNeuUrl}
              placeholder={art === "youtube" ? "https://www.youtube.com/@kanalname" : "https://blog.example.com"}
            />
          </div>
          <Button onClick={() => void abonnieren()} disabled={laedt || !neuUrl.trim()}>
            {laedt ? <Spinner className="w-4 h-4" /> : null} Abonnieren
          </Button>
        </div>
      </div>

      {/* Beiträge */}
      {beitraege.isLoading && <Spinner />}
      {!beitraege.isLoading && (beitraege.data ?? []).length === 0 && (
        <EmptyState
          title={meine.length === 0 ? "Noch nichts abonniert" : "Noch keine Beiträge"}
          hint={
            meine.length === 0
              ? art === "youtube"
                ? "Trage oben einen Kanal ein — neue Videos melden sich dann von selbst."
                : "Trage oben eine Blog- oder Leak-Adresse ein."
              : "Der Server prüft alle 30 Minuten. Mit „Jetzt prüfen“ geht es sofort."
          }
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {(beitraege.data ?? []).map((b) => (
          <button
            key={b.id}
            onClick={() => oeffnen(b)}
            className={clsx(
              "text-left rounded-xl overflow-hidden border transition group",
              b.gelesen
                ? "border-ghg-line bg-ghg-surface hover:border-ghg-muted"
                : "border-ghg-red/50 bg-ghg-red/5 hover:border-ghg-red",
            )}
          >
            <div className="aspect-video bg-ghg-bg2 relative">
              {b.bild ? (
                <img
                  src={b.bild}
                  alt=""
                  className="w-full h-full object-cover"
                  loading="lazy"
                  referrerPolicy="strict-origin-when-cross-origin"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-ghg-muted">
                  <Newspaper className="w-8 h-8" />
                </div>
              )}
              {b.videoId && (
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition">
                  <Play className="w-10 h-10 fill-white" />
                </div>
              )}
              {!b.gelesen && (
                <span className="absolute top-2 left-2 zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase">
                  Neu
                </span>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-sm line-clamp-2">{b.titel}</p>
              <p className="text-xs text-ghg-muted mt-1">
                {b.feedTitel} · {vorZeit(b.veroeffentlicht)}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Abos verwalten */}
      <Modal open={verwalten} onClose={() => setVerwalten(false)} title="Abos verwalten" wide>
        <div className="space-y-2">
          {meine.length === 0 && <p className="text-sm text-ghg-muted">Hier ist noch nichts abonniert.</p>}
          {meine.map((f) => (
            <div key={f.id} className="flex items-center gap-3 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{f.titel}</p>
                <p className="text-xs text-ghg-muted truncate" title={f.feedUrl}>
                  {f.zuletzt > 0 ? `zuletzt geprüft ${vorZeit(f.zuletzt)}` : "noch nicht geprüft"}
                </p>
                {f.fehler && <p className="text-xs text-ghg-red truncate">Fehler: {f.fehler}</p>}
              </div>
              <button
                onClick={() =>
                  void feedUpdate(f.id, !f.benachrichtigen).then(() => {
                    auffrischen();
                    toast(f.benachrichtigen ? "Benachrichtigung aus" : "Benachrichtigung an", "success");
                  })
                }
                title={f.benachrichtigen ? "Benachrichtigungen ausschalten" : "Benachrichtigungen einschalten"}
                className={clsx(
                  "p-1.5 rounded-md hover:bg-ghg-surface2",
                  f.benachrichtigen ? "text-ghg-red" : "text-ghg-muted",
                )}
              >
                {f.benachrichtigen ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
              <button
                onClick={() => void openUrl(f.seite)}
                title="Seite öffnen"
                className="p-1.5 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text"
              >
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={() =>
                  void feedRemove(f.id).then(() => {
                    auffrischen();
                    toast("Abo entfernt", "success");
                  })
                }
                title="Abo entfernen"
                className="p-1.5 rounded-md hover:bg-ghg-red-dark/30 text-ghg-red"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </Modal>

      {/* Video ansehen */}
      <Modal open={!!video} onClose={() => setVideo(null)} title={video?.titel ?? "Video"} wide>
        {video?.videoId && (
          <div className="space-y-3">
            <div className="aspect-video w-full bg-black rounded-lg overflow-hidden">
              <iframe
                className="w-full h-full"
                src={`https://www.youtube.com/embed/${video.videoId}?autoplay=1&rel=0`}
                title={video.titel}
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                /* Ohne Referer antwortet YouTube mit „Fehler 153" — siehe
                   Erklärung in Extras.tsx und server/src/index.js. */
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
            {video.beschreibung && <p className="text-sm text-ghg-muted whitespace-pre-line">{video.beschreibung}</p>}
            {video.url && (
              <button
                onClick={() => void openUrl(video.url!)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition"
              >
                <ExternalLink className="w-4 h-4" /> Auf YouTube öffnen
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

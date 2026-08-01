import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Play } from "lucide-react";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { tmdbExtras, tmdbVideos } from "../lib/api";
import { openUrl } from "../lib/backend";
import { Button, Modal, Spinner } from "./ui";
import type { TrailerVideo } from "../lib/types";

/** Sprachkürzel von TMDb in etwas Lesbares übersetzen. */
const SPRACHEN: Record<string, string> = {
  de: "Deutsch",
  en: "Englisch",
  fr: "Französisch",
  es: "Spanisch",
  it: "Italienisch",
  ja: "Japanisch",
  ko: "Koreanisch",
  pt: "Portugiesisch",
  nl: "Niederländisch",
  pl: "Polnisch",
  ru: "Russisch",
  tr: "Türkisch",
  zh: "Chinesisch",
};
const spracheName = (k?: string | null) => (k ? (SPRACHEN[k] ?? k.toUpperCase()) : "Ohne Angabe");

/** Die TMDb-Arten auf deutsche Bezeichnungen bringen. */
const ARTEN: Record<string, string> = {
  Trailer: "Trailer",
  Teaser: "Teaser",
  Clip: "Ausschnitt",
  Featurette: "Featurette",
  "Behind the Scenes": "Hinter den Kulissen",
  Bloopers: "Pannen",
  "Opening Credits": "Vorspann",
};
const artName = (t: string) => ARTEN[t] ?? (t || "Video");

export function Extras({
  mediaType,
  tmdbId,
  seasons,
}: {
  mediaType: "movie" | "tv";
  tmdbId?: number | null;
  /** Vorhandene Staffelnummern — dann gibt es im Trailer-Fenster eine
   *  Staffelauswahl (TMDb führt Trailer auch pro Staffel). */
  seasons?: number[];
}) {
  const [offen, setOffen] = useState(false);
  const { data } = useQuery({
    queryKey: ["extras", mediaType, tmdbId],
    queryFn: () => tmdbExtras(mediaType, tmdbId as number),
    enabled: !!tmdbId,
  });

  if (!tmdbId) return null;
  const cast = data?.cast ?? [];
  const anzahl = data?.videos?.length ?? (data?.trailerKey ? 1 : 0);

  return (
    <div className="mt-8">
      {anzahl > 0 && (
        <Button onClick={() => setOffen(true)} className="mb-6">
          <Play className="w-4 h-4 fill-white" /> Trailer &amp; Videos
          <span className="ml-1.5 text-xs opacity-80">{anzahl}</span>
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

      {offen && (
        <TrailerDialog
          mediaType={mediaType}
          tmdbId={tmdbId}
          seasons={seasons}
          basis={data?.videos ?? (data?.trailerKey ? [notfallVideo(data.trailerKey)] : [])}
          onClose={() => setOffen(false)}
        />
      )}
    </div>
  );
}

/** Ältere Server liefern nur `trailerKey` — daraus wird ein Eintrag gebaut,
 *  damit das Fenster auch dann etwas zu zeigen hat. */
const notfallVideo = (key: string): TrailerVideo => ({
  key,
  name: "Trailer",
  site: "YouTube",
  type: "Trailer",
  lang: null,
  official: true,
});

function TrailerDialog({
  mediaType,
  tmdbId,
  seasons,
  basis,
  onClose,
}: {
  mediaType: "movie" | "tv";
  tmdbId: number;
  seasons?: number[];
  basis: TrailerVideo[];
  onClose: () => void;
}) {
  // null = „ganze Serie/Film", sonst eine Staffelnummer
  const [staffel, setStaffel] = useState<number | null>(null);
  const [sprache, setSprache] = useState<string>("alle");
  const [aktiv, setAktiv] = useState<TrailerVideo | null>(basis[0] ?? null);

  const staffelQ = useQuery({
    queryKey: ["videos", mediaType, tmdbId, staffel],
    queryFn: () => tmdbVideos(mediaType, tmdbId, staffel),
    enabled: staffel !== null,
  });

  const liste = staffel === null ? basis : (staffelQ.data ?? []);

  const sprachen = useMemo(() => {
    const s = new Set<string>();
    for (const v of liste) s.add(v.lang || "");
    return [...s].sort();
  }, [liste]);

  const gefiltert = useMemo(
    () => (sprache === "alle" ? liste : liste.filter((v) => (v.lang || "") === sprache)),
    [liste, sprache],
  );

  // Wechselt die Liste (andere Staffel/Sprache), soll das Fenster nicht leer
  // wirken — also gleich das erste Video übernehmen.
  useEffect(() => {
    if (gefiltert.length === 0) return;
    if (!aktiv || !gefiltert.some((v) => v.key === aktiv.key)) setAktiv(gefiltert[0]);
  }, [gefiltert, aktiv]);

  // Nach Art gruppieren, damit Trailer, Ausschnitte und Featurettes nicht
  // durcheinander in einer langen Liste stehen.
  const gruppen = useMemo(() => {
    const m = new Map<string, TrailerVideo[]>();
    for (const v of gefiltert) {
      const k = artName(v.type);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(v);
    }
    return [...m.entries()];
  }, [gefiltert]);

  const youtubeSeite = aktiv ? `https://www.youtube.com/watch?v=${aktiv.key}` : null;

  return (
    <Modal open onClose={onClose} title="Trailer & Videos" wide>
      <div className="space-y-4">
        <div className="aspect-video w-full bg-black rounded-lg overflow-hidden">
          {aktiv ? (
            <iframe
              key={aktiv.key}
              className="w-full h-full"
              src={`https://www.youtube.com/embed/${aktiv.key}?autoplay=1&rel=0`}
              title={aktiv.name || "Trailer"}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              /* WICHTIG — nicht entfernen: ohne Referer antwortet YouTube mit
                 „Fehler 153 – Fehler bei der Konfiguration des Videoplayers".
                 Der Server schickt zwar inzwischen eine passende
                 Referrer-Policy (server/src/index.js), aber in der
                 Desktop-App gibt es keine Server-Header — dort zählt allein
                 dieses Attribut. */
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ghg-muted text-sm">
              {staffelQ.isLoading ? <Spinner className="w-5 h-5" /> : "Für diese Auswahl gibt es kein Video."}
            </div>
          )}
        </div>

        {aktiv && (
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{aktiv.name || artName(aktiv.type)}</p>
              <p className="text-xs text-ghg-muted">
                {[artName(aktiv.type), spracheName(aktiv.lang), aktiv.official ? "offiziell" : null, aktiv.publishedAt?.slice(0, 10)]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            {youtubeSeite && (
              <button
                onClick={() => void openUrl(youtubeSeite)}
                title="Falls die Einbettung vom Rechteinhaber gesperrt ist"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-sm text-ghg-muted hover:text-ghg-text transition shrink-0"
              >
                <ExternalLink className="w-4 h-4" /> Auf YouTube öffnen
              </button>
            )}
          </div>
        )}

        {/* Staffelauswahl — TMDb führt Trailer auch je Staffel */}
        {mediaType === "tv" && (seasons?.length ?? 0) > 0 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-xs uppercase tracking-wide text-ghg-muted mr-1">Staffel</span>
            <Chip aktiv={staffel === null} onClick={() => setStaffel(null)}>
              Ganze Serie
            </Chip>
            {(seasons ?? []).map((s) => (
              <Chip key={s} aktiv={staffel === s} onClick={() => setStaffel(s)}>
                {s === 0 ? "Specials" : s}
              </Chip>
            ))}
          </div>
        )}

        {/* Sprachauswahl — nur die Sprachen, die es hier wirklich gibt */}
        {sprachen.length > 1 && (
          <div className="flex gap-1.5 flex-wrap items-center">
            <span className="text-xs uppercase tracking-wide text-ghg-muted mr-1">Sprache</span>
            <Chip aktiv={sprache === "alle"} onClick={() => setSprache("alle")}>
              Alle
            </Chip>
            {sprachen.map((s) => (
              <Chip key={s || "none"} aktiv={sprache === s} onClick={() => setSprache(s)}>
                {spracheName(s || null)}
              </Chip>
            ))}
          </div>
        )}

        <div className="max-h-64 overflow-y-auto space-y-4 pr-1">
          {staffelQ.isLoading && staffel !== null && (
            <p className="text-sm text-ghg-muted flex items-center gap-2">
              <Spinner className="w-4 h-4" /> Videos dieser Staffel werden geladen …
            </p>
          )}
          {!staffelQ.isLoading && gefiltert.length === 0 && (
            <p className="text-sm text-ghg-muted">
              {staffel !== null
                ? "Für diese Staffel hat TMDb keine Videos."
                : "Für diese Sprache gibt es hier nichts."}
            </p>
          )}
          {gruppen.map(([art, videos]) => (
            <div key={art}>
              <h4 className="text-xs uppercase tracking-wide text-ghg-muted mb-2">
                {art} <span className="opacity-70">{videos.length}</span>
              </h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {videos.map((v) => (
                  <button
                    key={v.key}
                    onClick={() => setAktiv(v)}
                    className={clsx(
                      "text-left rounded-lg overflow-hidden border transition",
                      aktiv?.key === v.key
                        ? "border-ghg-red bg-ghg-red/10"
                        : "border-ghg-line hover:border-ghg-muted bg-ghg-surface2",
                    )}
                  >
                    <div className="aspect-video bg-ghg-bg2">
                      <img
                        src={`https://i.ytimg.com/vi/${v.key}/mqdefault.jpg`}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="strict-origin-when-cross-origin"
                      />
                    </div>
                    <div className="px-2 py-1.5">
                      <p className="text-xs font-semibold line-clamp-2">{v.name || artName(v.type)}</p>
                      <p className="text-[11px] text-ghg-muted">
                        {spracheName(v.lang)}
                        {v.official ? " · offiziell" : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function Chip({ aktiv, onClick, children }: { aktiv: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-2.5 py-1 rounded-full text-xs font-semibold transition border",
        aktiv
          ? "bg-ghg-red border-ghg-red text-white"
          : "bg-ghg-surface2 border-ghg-line text-ghg-muted hover:text-ghg-text",
      )}
    >
      {children}
    </button>
  );
}

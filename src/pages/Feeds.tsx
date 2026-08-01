import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import {
  ArrowLeft, Bell, BellOff, Bookmark, Check, Eye, ExternalLink, Newspaper, Play,
  Plus, RefreshCw, Search, Settings2, Trash2, Video, Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  feedAdd, feedGroupAdd, feedGroupRemove, feedGroupUpdate, feedGroups, feedItems,
  feedMarkRead, feedRefresh, feedRemove, feedSaved, feedUpdate, feedWatched, feedsList,
} from "../lib/api";
import { openUrl } from "../lib/backend";
import { useStore } from "../lib/store";
import { Button, EmptyState, Modal, Spinner, TextInput } from "../components/ui";
import type { Feed, FeedBeitrag, FeedGruppe } from "../lib/types";

type Art = "youtube" | "blog";
type Format = "alle" | "videos" | "shorts";
type Reiter = "alle" | "ungelesen" | "gemerkt";

/** Auswahl für die Textfarbe einer Gruppe — bewusst wenige, alle gut lesbar. */
const FARBEN = [
  { name: "Standard", wert: null },
  { name: "Rot", wert: "#ff4d5a" },
  { name: "Orange", wert: "#ff9f43" },
  { name: "Gelb", wert: "#ffd93d" },
  { name: "Grün", wert: "#4ade80" },
  { name: "Türkis", wert: "#2dd4bf" },
  { name: "Blau", wert: "#60a5fa" },
  { name: "Violett", wert: "#c084fc" },
  { name: "Pink", wert: "#f472b6" },
];

const EMOJIS = ["📺", "🎬", "🐞", "🦸", "🎮", "🎵", "⚽", "🚀", "🧪", "📰", "💧", "🔥", "⭐", "🐱", "🍿", "🗞️"];

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
 * Kanäle & Feeds (Punkt 5 der Übergabe, überarbeitet).
 *
 * AUFBAU
 *   Startansicht  Kacheln — eine Kachel ist eine GRUPPE, also ein Film, eine
 *                 Filmreihe oder eine Serie. Darin liegen die YouTube-Kanäle
 *                 und Blogs, die dazu gehören.
 *   In der Gruppe Alle Beiträge dieser Gruppe, filterbar nach Shorts/Videos/
 *                 Blogs, durchsuchbar, sortierbar, mit Einzelansicht je Kanal.
 *
 * Die Gruppe hängt am ABO, nicht am einzelnen Beitrag: ein Kanal bleibt beim
 * Thema, alles Neue landet dadurch von selbst richtig.
 */
export default function Feeds() {
  const qc = useQueryClient();
  const toast = useStore((s) => s.toast);

  // null = Kachelübersicht, sonst die geöffnete Gruppe ("" = Ohne Gruppe)
  const [offen, setOffen] = useState<string | null>(null);
  const [startErledigt, setStartErledigt] = useState(false);

  const gruppen = useQuery({ queryKey: ["feedGroups"], queryFn: feedGroups });
  const abos = useQuery({ queryKey: ["feeds"], queryFn: feedsList });

  /* Startansicht festlegen — einmal pro Seitenbesuch:
       KEINE Gruppen angelegt  → gleich die Beitragsliste („Alles gemischt").
                                 Die Kachelübersicht wäre sonst eine leere
                                 Seite mit einem einzigen Knopf, und wer nie
                                 Gruppen benutzt, käme nie an seine Videos.
       Gruppen vorhanden       → Kacheln, außer eine ist auf „direkt aufgehen"
                                 gestellt. */
  useEffect(() => {
    if (startErledigt || !gruppen.data) return;
    setStartErledigt(true);
    const echte = gruppen.data.filter((g) => g.id);
    if (echte.length === 0) {
      setOffen("");
      return;
    }
    const auto = echte.find((g) => g.standardOffen);
    if (auto?.id) setOffen(auto.id);
  }, [gruppen.data, startErledigt]);

  if (offen !== null) {
    const g = (gruppen.data ?? []).find((x) => (x.id ?? "") === offen);
    return (
      <GruppenAnsicht
        gruppe={g ?? null}
        gruppeId={offen === "" ? null : offen}
        abos={abos.data ?? []}
        alleGruppen={gruppen.data ?? []}
        onZurueck={() => setOffen(null)}
        onAendern={() => {
          qc.invalidateQueries({ queryKey: ["feedGroups"] });
          qc.invalidateQueries({ queryKey: ["feeds"] });
          qc.invalidateQueries({ queryKey: ["feedItems"] });
          qc.invalidateQueries({ queryKey: ["feedUnread"] });
        }}
        toast={toast}
      />
    );
  }

  return (
    <Kachelansicht
      gruppen={gruppen.data ?? []}
      abos={abos.data ?? []}
      laedt={gruppen.isLoading}
      onOeffnen={setOffen}
      onAendern={() => {
        qc.invalidateQueries({ queryKey: ["feedGroups"] });
        qc.invalidateQueries({ queryKey: ["feeds"] });
        qc.invalidateQueries({ queryKey: ["feedItems"] });
        qc.invalidateQueries({ queryKey: ["feedUnread"] });
      }}
      toast={toast}
    />
  );
}

/* ══ Kachelübersicht ══════════════════════════════════════════════════════ */

function Kachelansicht({
  gruppen,
  abos,
  laedt,
  onOeffnen,
  onAendern,
  toast,
}: {
  gruppen: FeedGruppe[];
  abos: Feed[];
  laedt: boolean;
  onOeffnen: (id: string) => void;
  onAendern: () => void;
  toast: (t: string, k?: "success" | "error" | "info") => void;
}) {
  const [neueGruppe, setNeueGruppe] = useState(false);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("📺");
  const [einstellen, setEinstellen] = useState<FeedGruppe | null>(null);
  const [busy, setBusy] = useState(false);

  const gesamtUngelesen = gruppen.reduce((n, g) => n + g.ungelesen, 0);

  const anlegen = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await feedGroupAdd(name.trim(), emoji);
      setName("");
      setEmoji("📺");
      setNeueGruppe(false);
      onAendern();
      toast(`Gruppe „${name.trim()}“ angelegt`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const jetztPruefen = async () => {
    setBusy(true);
    try {
      const r = await feedRefresh();
      onAendern();
      toast(r.neu > 0 ? `${r.neu} neue Beiträge` : "Nichts Neues", r.neu > 0 ? "success" : "info");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-10">
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <h1 className="text-3xl font-black text-glow">Kanäle</h1>
        {gesamtUngelesen > 0 && (
          <span className="zz-clip bg-ghg-red px-2.5 py-1 text-xs font-bold">{gesamtUngelesen} neu</span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => void jetztPruefen()} disabled={busy}>
            {busy ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />} Jetzt prüfen
          </Button>
          <Button variant="ghost" onClick={() => onOeffnen("")}>
            Alles gemischt
          </Button>
          <Button onClick={() => setNeueGruppe(true)}>
            <Plus className="w-4 h-4" /> Gruppe
          </Button>
        </div>
      </div>

      <p className="text-sm text-ghg-muted mb-6 max-w-3xl">
        Eine Kachel ist ein Film, eine Filmreihe oder eine Serie. Darin liegen die YouTube-Kanäle und Blogs, die dazu
        gehören — einmal einsortiert, landet alles Neue von selbst am richtigen Platz.
      </p>

      {laedt && <Spinner />}

      {!laedt && gruppen.length === 0 && (
        <EmptyState
          title="Noch keine Gruppe"
          hint="Leg eine Gruppe an — zum Beispiel „Miraculous“ — und sortier deine Kanäle und Blogs hinein. Ohne Gruppe landet alles in „Alles gemischt“."
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {gruppen.map((g) => (
          <GruppenKachel
            key={g.id ?? "ohne"}
            gruppe={g}
            onOeffnen={() => onOeffnen(g.id ?? "")}
            onEinstellen={g.id ? () => setEinstellen(g) : undefined}
          />
        ))}
      </div>

      {abos.length === 0 && !laedt && (
        <div className="mt-8 bg-ghg-surface border border-ghg-line rounded-2xl p-5 max-w-2xl">
          <h2 className="text-base font-bold mb-1">Noch nichts abonniert</h2>
          <p className="text-sm text-ghg-muted mb-3">
            Öffne eine Gruppe (oder „Alles gemischt“) und trage dort einen YouTube-Kanal oder eine Blog-Adresse ein.
          </p>
          <Button variant="ghost" onClick={() => onOeffnen("")}>
            Zum Abonnieren
          </Button>
        </div>
      )}

      <Modal open={neueGruppe} onClose={() => setNeueGruppe(false)} title="Neue Gruppe">
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Name</span>
            <TextInput value={name} onChange={setName} placeholder="z. B. Miraculous" autoFocus onEnter={() => void anlegen()} />
          </label>
          <div>
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Symbol</span>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={clsx(
                    "w-10 h-10 rounded-lg text-xl transition border",
                    emoji === e ? "bg-ghg-red border-ghg-red" : "bg-ghg-surface2 border-ghg-line hover:border-ghg-muted",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setNeueGruppe(false)}>
              Abbrechen
            </Button>
            <Button onClick={() => void anlegen()} disabled={busy || !name.trim()}>
              Anlegen
            </Button>
          </div>
        </div>
      </Modal>

      {einstellen && (
        <GruppenEinstellungen
          gruppe={einstellen}
          abos={abos}
          onClose={() => setEinstellen(null)}
          onAendern={onAendern}
          toast={toast}
        />
      )}
    </div>
  );
}

function GruppenKachel({
  gruppe: g,
  onOeffnen,
  onEinstellen,
}: {
  gruppe: FeedGruppe;
  onOeffnen: () => void;
  onEinstellen?: () => void;
}) {
  return (
    <div
      className={clsx(
        "relative rounded-2xl overflow-hidden border transition group cursor-pointer",
        g.ungelesen > 0 ? "border-ghg-red/50 hover:border-ghg-red" : "border-ghg-line hover:border-ghg-muted",
      )}
      onClick={onOeffnen}
    >
      {/* Vorschaustreifen aus den letzten Bildern der Gruppe */}
      <div className="h-24 bg-ghg-bg2 flex">
        {g.bilder.length > 0 ? (
          g.bilder.slice(0, 4).map((b, i) => (
            <img key={i} src={b} alt="" className="flex-1 h-full object-cover opacity-70" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
          ))
        ) : (
          <div className="w-full h-full flex items-center justify-center text-4xl opacity-40">{g.emoji}</div>
        )}
      </div>

      <div className="p-4 bg-ghg-surface">
        <div className="flex items-start gap-2">
          <span className="text-2xl leading-none">{g.emoji}</span>
          <div className="flex-1 min-w-0">
            <p className="font-bold truncate" style={g.farbe ? { color: g.farbe } : undefined}>
              {g.name}
            </p>
            <p className="text-xs text-ghg-muted mt-0.5">
              {g.kanaele > 0 && `${g.kanaele} Kanal${g.kanaele === 1 ? "" : "e"}`}
              {g.kanaele > 0 && g.blogs > 0 && " · "}
              {g.blogs > 0 && `${g.blogs} Blog${g.blogs === 1 ? "" : "s"}`}
              {g.abos === 0 && "noch nichts drin"}
            </p>
          </div>
          {onEinstellen && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onEinstellen();
              }}
              title="Gruppe einstellen"
              className="p-1.5 rounded-lg text-ghg-muted hover:text-ghg-text hover:bg-ghg-surface2 transition opacity-0 group-hover:opacity-100"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2 mt-3">
          <span className="text-xs text-ghg-muted">{g.beitraege} Beiträge</span>
          {g.ungelesen > 0 && (
            <span className="ml-auto text-[11px] font-bold bg-ghg-red text-white rounded-full px-2 py-0.5">
              {g.ungelesen} neu
            </span>
          )}
          {g.standardOffen && (
            <span className="ml-auto text-[10px] text-ghg-muted border border-ghg-line rounded px-1.5 py-0.5">
              öffnet zuerst
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ══ Einstellungen einer Gruppe ═══════════════════════════════════════════ */

function GruppenEinstellungen({
  gruppe,
  abos,
  onClose,
  onAendern,
  toast,
}: {
  gruppe: FeedGruppe;
  abos: Feed[];
  onClose: () => void;
  onAendern: () => void;
  toast: (t: string, k?: "success" | "error" | "info") => void;
}) {
  const [name, setName] = useState(gruppe.name);
  const [emoji, setEmoji] = useState(gruppe.emoji);
  const [farbe, setFarbe] = useState<string | null>(gruppe.farbe ?? null);
  const [standardOffen, setStandardOffen] = useState(gruppe.standardOffen);
  const [busy, setBusy] = useState(false);

  const speichern = async () => {
    setBusy(true);
    try {
      await feedGroupUpdate(gruppe.id!, { name, emoji, farbe, standardOffen });
      onAendern();
      toast("Gruppe gespeichert", "success");
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const zuordnen = async (f: Feed, drin: boolean) => {
    try {
      await feedUpdate(f.id, { gruppeId: drin ? gruppe.id! : null });
      onAendern();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <Modal open onClose={onClose} title={`${gruppe.emoji} ${gruppe.name}`} wide>
      <div className="space-y-5">
        <div className="flex gap-4 flex-wrap">
          <label className="flex-1 min-w-52">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Name</span>
            <TextInput value={name} onChange={setName} />
          </label>
        </div>

        <div>
          <span className="text-xs uppercase tracking-wide text-ghg-muted">Symbol</span>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setEmoji(e)}
                className={clsx(
                  "w-10 h-10 rounded-lg text-xl transition border",
                  emoji === e ? "bg-ghg-red border-ghg-red" : "bg-ghg-surface2 border-ghg-line hover:border-ghg-muted",
                )}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="text-xs uppercase tracking-wide text-ghg-muted">Textfarbe</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {FARBEN.map((f) => (
              <button
                key={f.name}
                onClick={() => setFarbe(f.wert)}
                className={clsx(
                  "px-3 py-1.5 rounded-lg text-sm font-semibold border transition",
                  farbe === f.wert ? "border-ghg-red bg-ghg-surface2" : "border-ghg-line hover:border-ghg-muted",
                )}
                style={f.wert ? { color: f.wert } : undefined}
              >
                {f.name}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={standardOffen}
            onChange={(e) => setStandardOffen(e.target.checked)}
            className="w-4 h-4 accent-ghg-red"
          />
          <span className="text-sm">
            Beim Öffnen der Kanäle-Seite direkt aufklappen
            <span className="text-ghg-muted"> — gilt nur für eine Gruppe</span>
          </span>
        </label>

        <div>
          <h3 className="text-sm font-bold mb-2">Was gehört hierher?</h3>
          <div className="max-h-64 overflow-y-auto border border-ghg-line rounded-lg divide-y divide-ghg-line">
            {abos.length === 0 && <p className="px-3 py-3 text-sm text-ghg-muted">Noch nichts abonniert.</p>}
            {abos.map((f) => {
              const drin = f.gruppeId === gruppe.id;
              const woanders = !!f.gruppeId && !drin;
              return (
                <label key={f.id} className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-ghg-surface2">
                  <input
                    type="checkbox"
                    checked={drin}
                    onChange={(e) => void zuordnen(f, e.target.checked)}
                    className="w-4 h-4 accent-ghg-red"
                  />
                  {f.art === "youtube" ? <Video className="w-4 h-4 text-ghg-red shrink-0" /> : <Newspaper className="w-4 h-4 text-ghg-red shrink-0" />}
                  <span className="flex-1 text-sm truncate">{f.titel}</span>
                  {woanders && <span className="text-[11px] text-ghg-muted">in einer anderen Gruppe</span>}
                </label>
              );
            })}
          </div>
        </div>

        <div className="flex justify-between gap-2 pt-1">
          <Button
            variant="danger"
            onClick={() => {
              void feedGroupRemove(gruppe.id!).then((n) => {
                onAendern();
                toast(n > 0 ? `Gruppe gelöscht — ${n} Abos sind jetzt ohne Gruppe` : "Gruppe gelöscht", "success");
                onClose();
              });
            }}
          >
            <Trash2 className="w-4 h-4" /> Gruppe löschen
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button onClick={() => void speichern()} disabled={busy}>
              Speichern
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/* ══ Ansicht einer Gruppe ═════════════════════════════════════════════════ */

function GruppenAnsicht({
  gruppe,
  gruppeId,
  abos,
  alleGruppen,
  onZurueck,
  onAendern,
  toast,
}: {
  gruppe: FeedGruppe | null;
  gruppeId: string | null;
  abos: Feed[];
  alleGruppen: FeedGruppe[];
  onZurueck: () => void;
  onAendern: () => void;
  toast: (t: string, k?: "success" | "error" | "info") => void;
}) {
  const qc = useQueryClient();
  const [reiter, setReiter] = useState<Reiter>("alle");
  const [format, setFormat] = useState<Format>("alle");
  const [art, setArt] = useState<"alle" | Art>("alle");
  const [suche, setSuche] = useState("");
  const [sort, setSort] = useState<"neu" | "alt" | "kanal">("neu");
  const [kanal, setKanal] = useState<string | null>(null);
  const [ohneGesehene, setOhneGesehene] = useState(false);
  const [video, setVideo] = useState<FeedBeitrag | null>(null);
  const [neuUrl, setNeuUrl] = useState("");
  const [neuArt, setNeuArt] = useState<Art>("youtube");
  const [busy, setBusy] = useState(false);
  const [abosOffen, setAbosOffen] = useState(false);
  const [einstellen, setEinstellen] = useState(false);
  /* Eigene Einstellungen pro Abo (Name ändern) — bisher gab es dafür nur die
     Gruppen-Zuordnung und den Glocken-Schalter, kein Umbenennen. */
  const [umbenennenId, setUmbenennenId] = useState<string | null>(null);
  const [umbenennenText, setUmbenennenText] = useState("");

  /* „Alles gemischt" ist die Sammelansicht: dort wird NICHT nach Gruppe
     gefiltert, sonst sähe man nur die gruppenlosen Abos. */
  const alles = gruppeId === null && gruppe === null;

  const filter = {
    gruppeId: alles ? undefined : gruppeId,
    feedId: kanal,
    art: art === "alle" ? null : art,
    format: format === "alle" ? null : format,
    unreadOnly: reiter === "ungelesen",
    savedOnly: reiter === "gemerkt",
    hideWatched: ohneGesehene,
    search: suche.trim() || null,
    sort,
    limit: 200,
  } as const;

  const beitraege = useQuery({
    queryKey: ["feedItems", filter],
    queryFn: () => feedItems(filter),
  });

  const meineAbos = useMemo(
    () => (alles ? abos : abos.filter((f) => (f.gruppeId ?? null) === gruppeId)),
    [abos, gruppeId, alles],
  );

  const auffrischen = () => {
    qc.invalidateQueries({ queryKey: ["feedItems"] });
    onAendern();
  };

  const abonnieren = async () => {
    const url = neuUrl.trim();
    if (!url) return;
    setBusy(true);
    try {
      const f = await feedAdd(url, neuArt);
      // Direkt in die geöffnete Gruppe einsortieren — sonst müsste der Nutzer
      // es gleich danach von Hand nachholen.
      if (gruppeId) await feedUpdate(f.id, { gruppeId }).catch(() => {});
      setNeuUrl("");
      auffrischen();
      toast(`„${f.titel}“ abonniert`, "success");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setBusy(false);
    }
  };

  const oeffnen = (b: FeedBeitrag) => {
    if (b.videoId) setVideo(b);
    else if (b.url) void openUrl(b.url);
    if (!b.gelesen) void feedMarkRead([b.id]).then(auffrischen);
  };

  const ungelesen = (beitraege.data ?? []).filter((b) => !b.gelesen).length;
  const titel = alles ? "Alles gemischt" : (gruppe?.name ?? "Ohne Gruppe");

  return (
    <div className="p-10">
      <div className="flex items-center gap-3 flex-wrap mb-5">
        <button onClick={onZurueck} title="Zurück zu den Gruppen" className="p-2 rounded-lg bg-ghg-surface2 hover:bg-ghg-red transition">
          <ArrowLeft className="w-5 h-5" />
        </button>
        {gruppe && <span className="text-3xl leading-none">{gruppe.emoji}</span>}
        <h1 className="text-3xl font-black text-glow" style={gruppe?.farbe ? { color: gruppe.farbe } : undefined}>
          {titel}
        </h1>
        {ungelesen > 0 && <span className="zz-clip bg-ghg-red px-2.5 py-1 text-xs font-bold">{ungelesen} neu</span>}

        <div className="ml-auto flex gap-2 flex-wrap">
          <Button
            variant="ghost"
            onClick={() => {
              setBusy(true);
              void feedRefresh()
                .then((r) => {
                  auffrischen();
                  toast(r.neu > 0 ? `${r.neu} neue Beiträge` : "Nichts Neues", r.neu > 0 ? "success" : "info");
                })
                .catch((e) => toast(String(e), "error"))
                .finally(() => setBusy(false));
            }}
            disabled={busy}
          >
            {busy ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />} Jetzt prüfen
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
              <Check className="w-4 h-4" /> Alles gelesen
            </Button>
          )}
          <Button variant="ghost" onClick={() => setAbosOffen(true)}>
            Abos ({meineAbos.length})
          </Button>
          {gruppe?.id && (
            <Button variant="ghost" onClick={() => setEinstellen(true)}>
              <Settings2 className="w-4 h-4" /> Einstellen
            </Button>
          )}
        </div>
      </div>

      {/* Filterleiste */}
      <div className="flex items-center gap-2 flex-wrap mb-5">
        <Segment
          werte={[
            ["alle", "Alle"],
            ["ungelesen", "Ungelesen"],
            ["gemerkt", "Merkliste"],
          ]}
          wert={reiter}
          setzen={(v) => setReiter(v as Reiter)}
        />
        <Segment
          werte={[
            ["alle", "Alles"],
            ["videos", "Videos"],
            ["shorts", "Shorts"],
          ]}
          wert={format}
          setzen={(v) => setFormat(v as Format)}
        />
        <Segment
          werte={[
            ["alle", "Quelle: alle"],
            ["youtube", "YouTube"],
            ["blog", "Blogs"],
          ]}
          wert={art}
          setzen={(v) => setArt(v as "alle" | Art)}
        />

        <div className="flex items-center gap-1.5 bg-ghg-surface2 border border-ghg-line rounded-lg px-2.5 py-1.5">
          <Search className="w-4 h-4 text-ghg-muted" />
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Suchen …"
            className="bg-transparent outline-none text-sm w-40"
          />
        </div>

        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as "neu" | "alt" | "kanal")}
          className="bg-ghg-surface2 border border-ghg-line rounded-lg px-2.5 py-1.5 text-sm"
        >
          <option value="neu">Neuste zuerst</option>
          <option value="alt">Älteste zuerst</option>
          <option value="kanal">Nach Kanal</option>
        </select>

        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input type="checkbox" checked={ohneGesehene} onChange={(e) => setOhneGesehene(e.target.checked)} className="w-4 h-4 accent-ghg-red" />
          Gesehene ausblenden
        </label>
      </div>

      {/* Kanal-Einzelansicht */}
      {meineAbos.length > 1 && (
        <div className="flex gap-2 flex-wrap mb-5">
          <button
            onClick={() => setKanal(null)}
            className={clsx(
              "px-3 py-1.5 rounded-lg text-sm transition",
              kanal === null ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
            )}
          >
            Alle Kanäle
          </button>
          {meineAbos.map((f) => (
            <button
              key={f.id}
              onClick={() => setKanal(kanal === f.id ? null : f.id)}
              className={clsx(
                "px-3 py-1.5 rounded-lg text-sm transition flex items-center gap-1.5",
                kanal === f.id ? "bg-ghg-red text-white" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
              )}
            >
              {f.art === "youtube" ? <Video className="w-3.5 h-3.5" /> : <Newspaper className="w-3.5 h-3.5" />}
              {f.titel}
            </button>
          ))}
        </div>
      )}

      {/* Abonnieren */}
      <div className="bg-ghg-surface border border-ghg-line rounded-2xl p-4 mb-6 flex gap-2 flex-wrap items-end">
        <Segment
          werte={[
            ["youtube", "YouTube-Kanal"],
            ["blog", "Blog / Leaks"],
          ]}
          wert={neuArt}
          setzen={(v) => setNeuArt(v as Art)}
        />
        <div className="flex-1 min-w-56">
          <TextInput
            value={neuUrl}
            onChange={setNeuUrl}
            placeholder={neuArt === "youtube" ? "https://www.youtube.com/@kanalname" : "https://blog.example.com"}
            onEnter={() => void abonnieren()}
          />
        </div>
        <Button onClick={() => void abonnieren()} disabled={busy || !neuUrl.trim()}>
          {busy ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4" />} Abonnieren
          {gruppe?.id ? ` in „${gruppe.name}“` : ""}
        </Button>
      </div>

      {beitraege.isLoading && <Spinner />}
      {!beitraege.isLoading && (beitraege.data ?? []).length === 0 && (
        <EmptyState
          title={reiter === "gemerkt" ? "Nichts gemerkt" : meineAbos.length === 0 ? "Hier ist noch nichts abonniert" : "Nichts gefunden"}
          hint={
            reiter === "gemerkt"
              ? "Mit dem Lesezeichen-Symbol auf einem Video merkst du es dir für später."
              : meineAbos.length === 0
                ? "Trage oben einen Kanal oder eine Blog-Adresse ein."
                : "Andere Filter probieren — oder oben „Jetzt prüfen“."
          }
        />
      )}

      <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {(beitraege.data ?? []).map((b) => (
          <BeitragsKachel key={b.id} b={b} onOeffnen={() => oeffnen(b)} onAendern={auffrischen} />
        ))}
      </div>

      {/* Abos verwalten */}
      <Modal open={abosOffen} onClose={() => setAbosOffen(false)} title="Abos" wide>
        <div className="space-y-2">
          {meineAbos.length === 0 && <p className="text-sm text-ghg-muted">Hier ist noch nichts abonniert.</p>}
          {meineAbos.map((f) => (
            <div key={f.id} className="flex items-center gap-3 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2">
              {f.art === "youtube" ? <Video className="w-4 h-4 text-ghg-red shrink-0" /> : <Newspaper className="w-4 h-4 text-ghg-red shrink-0" />}
              <div className="flex-1 min-w-0">
                {umbenennenId === f.id ? (
                  <div className="flex gap-1.5">
                    <TextInput
                      value={umbenennenText}
                      onChange={setUmbenennenText}
                      autoFocus
                      onEnter={() =>
                        void feedUpdate(f.id, { titel: umbenennenText }).then(() => {
                          setUmbenennenId(null);
                          auffrischen();
                        })
                      }
                    />
                    <button
                      onClick={() =>
                        void feedUpdate(f.id, { titel: umbenennenText }).then(() => {
                          setUmbenennenId(null);
                          auffrischen();
                        })
                      }
                      className="px-2 rounded-md bg-ghg-red text-white text-xs"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <p className="text-sm font-semibold truncate">{f.titel}</p>
                )}
                <p className="text-xs text-ghg-muted truncate">
                  {f.zuletzt > 0 ? `zuletzt geprüft ${vorZeit(f.zuletzt)}` : "noch nicht geprüft"}
                </p>
                {f.fehler && <p className="text-xs text-ghg-red truncate">Fehler: {f.fehler}</p>}
              </div>
              {/* Eigene Einstellungen pro Abo — umbenennen. Gruppe und
                  Benachrichtigung stehen direkt daneben (siehe unten). */}
              <button
                onClick={() => {
                  setUmbenennenId(f.id);
                  setUmbenennenText(f.titel);
                }}
                title="Umbenennen"
                className="p-1.5 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text"
              >
                <Settings2 className="w-4 h-4" />
              </button>
              <select
                value={f.gruppeId ?? ""}
                onChange={(e) => void feedUpdate(f.id, { gruppeId: e.target.value || null }).then(auffrischen)}
                className="bg-ghg-surface2 border border-ghg-line rounded-lg px-2 py-1 text-xs max-w-40"
                title="Gruppe"
              >
                <option value="">Ohne Gruppe</option>
                {alleGruppen.filter((g) => g.id).map((g) => (
                  <option key={g.id} value={g.id!}>
                    {g.emoji} {g.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void feedUpdate(f.id, { benachrichtigen: !f.benachrichtigen }).then(auffrischen)}
                title={f.benachrichtigen ? "Benachrichtigungen aus" : "Benachrichtigungen an"}
                className={clsx("p-1.5 rounded-md hover:bg-ghg-surface2", f.benachrichtigen ? "text-ghg-red" : "text-ghg-muted")}
              >
                {f.benachrichtigen ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
              </button>
              <button onClick={() => void openUrl(f.seite)} title="Seite öffnen" className="p-1.5 rounded-md hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text">
                <ExternalLink className="w-4 h-4" />
              </button>
              <button
                onClick={() => void feedRemove(f.id).then(() => { auffrischen(); toast("Abo entfernt", "success"); })}
                title="Abo entfernen"
                className="p-1.5 rounded-md hover:bg-ghg-red-dark/30 text-ghg-red"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </Modal>

      {einstellen && gruppe?.id && (
        <GruppenEinstellungen gruppe={gruppe} abos={abos} onClose={() => setEinstellen(false)} onAendern={onAendern} toast={toast} />
      )}

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
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => void feedWatched(video.id, !video.gesehen).then(() => { auffrischen(); setVideo({ ...video, gesehen: !video.gesehen }); })}
              >
                <Eye className="w-4 h-4" /> {video.gesehen ? "Nicht gesehen" : "Als gesehen markieren"}
              </Button>
              {video.url && (
                <Button variant="ghost" onClick={() => void openUrl(video.url!)}>
                  <ExternalLink className="w-4 h-4" /> Auf YouTube öffnen
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Segment({
  werte,
  wert,
  setzen,
}: {
  werte: [string, string][];
  wert: string;
  setzen: (v: string) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-ghg-line">
      {werte.map(([v, label]) => (
        <button
          key={v}
          onClick={() => setzen(v)}
          className={clsx(
            "px-3 py-1.5 text-sm transition",
            wert === v ? "bg-ghg-red text-white font-semibold" : "bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function BeitragsKachel({ b, onOeffnen, onAendern }: { b: FeedBeitrag; onOeffnen: () => void; onAendern: () => void }) {
  return (
    <div
      className={clsx(
        "relative text-left rounded-xl overflow-hidden border transition group",
        b.gesehen
          ? "border-ghg-line bg-ghg-surface opacity-60 hover:opacity-100"
          : b.gelesen
            ? "border-ghg-line bg-ghg-surface hover:border-ghg-muted"
            : "border-ghg-red/50 bg-ghg-red/5 hover:border-ghg-red",
      )}
    >
      <button onClick={onOeffnen} className="block w-full text-left">
        <div className="aspect-video bg-ghg-bg2 relative">
          {b.bild ? (
            <img src={b.bild} alt="" className="w-full h-full object-cover" loading="lazy" referrerPolicy="strict-origin-when-cross-origin" />
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
            <span className="absolute top-2 left-2 zz-clip bg-ghg-red px-2 py-0.5 text-[10px] font-bold uppercase">Neu</span>
          )}
          {b.istShort === true && (
            <span className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 rounded px-1.5 py-0.5 text-[10px] font-bold">
              <Zap className="w-3 h-3" /> SHORT
            </span>
          )}
          {b.dauerSek != null && b.dauerSek > 0 && (
            <span className="absolute bottom-2 right-2 bg-black/70 rounded px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
              {Math.floor(b.dauerSek / 60)}:{String(b.dauerSek % 60).padStart(2, "0")}
            </span>
          )}
          {b.gesehen && (
            <span className="absolute top-2 right-2 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center" title="Gesehen">
              <Check className="w-3.5 h-3.5 text-white" />
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

      {/* Merken / Gesehen — bewusst NEBEN dem Öffnen-Knopf, nicht darin:
          verschachtelte Knöpfe sind in HTML nicht erlaubt. */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition">
        <button
          onClick={() => void feedSaved(b.id, !b.gemerkt).then(onAendern)}
          title={b.gemerkt ? "Aus der Merkliste nehmen" : "Für später merken"}
          className={clsx(
            "p-1.5 rounded-lg border backdrop-blur transition",
            b.gemerkt ? "bg-ghg-red border-ghg-red text-white" : "bg-black/60 border-ghg-line text-ghg-muted hover:text-ghg-text",
          )}
        >
          <Bookmark className={clsx("w-4 h-4", b.gemerkt && "fill-white")} />
        </button>
        <button
          onClick={() => void feedWatched(b.id, !b.gesehen).then(onAendern)}
          title={b.gesehen ? "Als ungesehen markieren" : "Als gesehen markieren"}
          className={clsx(
            "p-1.5 rounded-lg border backdrop-blur transition",
            b.gesehen ? "bg-emerald-500 border-emerald-500 text-white" : "bg-black/60 border-ghg-line text-ghg-muted hover:text-ghg-text",
          )}
        >
          <Eye className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

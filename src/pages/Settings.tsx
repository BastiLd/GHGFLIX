import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getVersion } from "@tauri-apps/api/app";
import {
  BarChart3,
  Cloud,
  Database,
  Film,
  FolderInput,
  FolderPlus,
  Keyboard,
  Library,
  Palette,
  Play,
  RefreshCw,
  ScanSearch,
  Sparkles,
  Timer,
  Trash2,
  Tv,
  Wrench,
  Zap,
} from "lucide-react";
import { useEffect, useState, type ComponentType, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  addLibrary,
  checkTools,
  clearThumbCache,
  dbOptimize,
  detectIntros,
  detectLibraries,
  exportData,
  getLibraries,
  getSetting,
  importData,
  openAppData,
  probeQualities,
  refreshMetadata,
  removeLibrary,
  resetLibrary,
  scanLibraries,
  setSetting,
  thumbCacheSize,
  type ToolsReport,
} from "../lib/api";
import { comboFromEvent, comboHasKey, comboLabel } from "../lib/keys";
import { useStore } from "../lib/store";
import { applyAccent, loadAccent, useUiPrefs, type UiPrefs } from "../lib/uiPrefs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getSession, reinitSupabase, signOut } from "../lib/supabase";
import { Button, InfoButton, Modal, Spinner, TextInput } from "../components/ui";
import { ThemeStore } from "../components/ThemeStore";

type TabId =
  | "allgemein"
  | "wiedergabe"
  | "intro"
  | "leistung"
  | "bibliothek"
  | "erkennung"
  | "tmdb"
  | "werkzeuge"
  | "konto";

const TABS: { id: TabId; label: string; icon: ComponentType<{ className?: string }> }[] = [
  { id: "allgemein", label: "Allgemein", icon: Palette },
  { id: "wiedergabe", label: "Wiedergabe", icon: Play },
  { id: "intro", label: "Intro & Skip", icon: Timer },
  { id: "leistung", label: "Leistung", icon: Zap },
  { id: "bibliothek", label: "Bibliothek", icon: Library },
  { id: "erkennung", label: "Erkennung", icon: ScanSearch },
  { id: "tmdb", label: "TMDb", icon: Database },
  { id: "werkzeuge", label: "Werkzeuge", icon: Wrench },
  { id: "konto", label: "Konto & Sync", icon: Cloud },
];

function KeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [capturing, setCapturing] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setCapturing(true)}
      onBlur={() => setCapturing(false)}
      onKeyDown={(e) => {
        if (!capturing) return;
        e.preventDefault();
        if (e.key === "Escape") {
          setCapturing(false);
          return;
        }
        const combo = comboFromEvent(e);
        if (comboHasKey(combo)) {
          onChange(combo);
          setCapturing(false);
        }
      }}
      className="px-4 py-2 rounded-lg bg-ghg-bg2 border border-ghg-line text-sm min-w-40 text-left focus:outline-none focus:border-ghg-red"
    >
      {capturing ? "Taste drücken …" : comboLabel(value)}
    </button>
  );
}

function Section({
  title,
  desc,
  info,
  children,
}: {
  title: string;
  desc?: string;
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="bg-ghg-surface border border-ghg-line rounded-2xl p-6 mb-6">
      <h2 className="text-lg font-bold flex items-center gap-1.5">
        {title}
        {info && <InfoButton>{info}</InfoButton>}
      </h2>
      {desc && <p className="text-sm text-ghg-muted mt-1 mb-4">{desc}</p>}
      <div className={desc ? "" : "mt-4"}>{children}</div>
    </div>
  );
}

/** boolean pref as a checkbox — saves immediately via the uiPrefs store */
function PrefToggle({ k, label }: { k: keyof UiPrefs; label: string }) {
  const value = useUiPrefs((s) => s[k]) as boolean;
  const setPref = useUiPrefs((s) => s.setPref);
  return (
    <label className="flex items-center gap-3 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => setPref(k, e.target.checked as never)}
        className="w-4 h-4 accent-ghg-red"
      />
      <span className="text-sm">{label}</span>
    </label>
  );
}

/** select pref — saves immediately */
function PrefSelect({
  k,
  label,
  options,
  className,
}: {
  k: keyof UiPrefs;
  label: string;
  options: [string, string][];
  className?: string;
}) {
  const value = useUiPrefs((s) => s[k]) as string;
  const setPref = useUiPrefs((s) => s.setPref);
  return (
    <label className={className ?? "flex-1 min-w-40"}>
      <span className="text-xs uppercase tracking-wide text-ghg-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => setPref(k, e.target.value as never)}
        className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** numeric pref — saves immediately */
function PrefNumber({
  k,
  label,
  min,
  max,
  step = 1,
  className,
}: {
  k: keyof UiPrefs;
  label: string;
  min: number;
  max: number;
  step?: number;
  className?: string;
}) {
  const value = useUiPrefs((s) => s[k]) as number;
  const setPref = useUiPrefs((s) => s.setPref);
  return (
    <label className={className ?? "flex-1 min-w-40"}>
      <span className="text-xs uppercase tracking-wide text-ghg-muted">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const n = parseFloat(e.target.value);
          if (Number.isFinite(n)) setPref(k, Math.min(max, Math.max(min, n)) as never);
        }}
        className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
      />
    </label>
  );
}

function ToolRow({ name, status }: { name: string; status?: { path?: string | null; ok: boolean; version?: string | null } }) {
  return (
    <div className="flex items-center gap-3 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2.5">
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${status?.ok ? "bg-emerald-500" : "bg-ghg-red"}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {name}{" "}
          <span className="font-normal text-xs text-ghg-muted">{status?.ok ? status?.version || "gefunden" : "nicht gefunden"}</span>
        </p>
        {status?.path && <p className="text-xs text-ghg-muted truncate" title={status.path}>{status.path}</p>}
      </div>
    </div>
  );
}

export default function Settings() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);

  const libs = useQuery({ queryKey: ["libraries"], queryFn: getLibraries });

  const [tmdbKey, setTmdbKey] = useState("");
  const [lang, setLang] = useState("de-DE");
  const [supaUrl, setSupaUrl] = useState("");
  const [supaKey, setSupaKey] = useState("");
  const [mpvPath, setMpvPath] = useState("");
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [ffprobePath, setFfprobePath] = useState("");
  const [markerKey, setMarkerKey] = useState("k");
  const [email, setEmail] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [showTheme, setShowTheme] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [autoScan, setAutoScan] = useState(true);
  const [watchFs, setWatchFs] = useState(true);
  const [subDefault, setSubDefault] = useState("off");
  const [subLang, setSubLang] = useState("en");
  const [introSkip, setIntroSkip] = useState("85");
  const [introMode, setIntroMode] = useState("button");
  const [introSource, setIntroSource] = useState("auto");
  const [introScanMin, setIntroScanMin] = useState("12");
  const [introMinSec, setIntroMinSec] = useState("12");
  const [autoQuality, setAutoQuality] = useState("highest");
  const [thumbInterval, setThumbInterval] = useState("5");
  const [thumbSize, setThumbSize] = useState("md");
  const [hwdec, setHwdec] = useState("auto");
  const [videoOutput, setVideoOutput] = useState("gpu-next");
  const [perfMode, setPerfMode] = useState(false);
  const [smoothing, setSmoothing] = useState(false);
  const [autoMatch, setAutoMatch] = useState(true);
  const [version, setVersion] = useState("");
  const [tools, setTools] = useState<ToolsReport | null>(null);
  const [toolsBusy, setToolsBusy] = useState(false);
  const [cacheBytes, setCacheBytes] = useState<number | null>(null);
  const [accent, setAccent] = useState<string>(() => loadAccent() ?? "#e50914");
  const [updateInfo, setUpdateInfo] = useState<string | null>(null);
  const updateCheckPref = useUiPrefs((s) => s.updateCheck);

  const checkUpdates = async (silent = false) => {
    try {
      const res = await fetch("https://api.github.com/repos/BastiLd/GHGFLIX/releases/latest", {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub: ${res.status}`);
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name || "").replace(/^v/i, "");
      const cur = version || "0.0.0";
      const newer = latest && latest.localeCompare(cur, undefined, { numeric: true }) > 0;
      setUpdateInfo(
        newer
          ? `Update verfügbar: v${latest} (installiert: v${cur})`
          : latest
            ? `Du bist aktuell (v${cur}).`
            : "Keine Releases gefunden.",
      );
      if (newer && !silent) toast(`Update v${latest} verfügbar – siehe GitHub-Releases`, "info");
    } catch (e) {
      if (!silent) toast(`Update-Prüfung fehlgeschlagen: ${e}`, "error");
      setUpdateInfo(null);
    }
  };

  const [tab, setTab] = useState<TabId>("allgemein");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // silent update check when opening the settings (if enabled)
  useEffect(() => {
    if (version && updateCheckPref) void checkUpdates(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  useEffect(() => {
    (async () => {
      setTmdbKey((await getSetting("tmdb_key")) || "");
      setLang((await getSetting("tmdb_lang")) || "de-DE");
      setSupaUrl((await getSetting("supabase_url")) || "");
      setSupaKey((await getSetting("supabase_anon_key")) || "");
      setMpvPath((await getSetting("mpv_path")) || "");
      setFfmpegPath((await getSetting("ffmpeg_path")) || "");
      setFfprobePath((await getSetting("ffprobe_path")) || "");
      setMarkerKey((await getSetting("marker_key")) || "k");
      setAutoScan((await getSetting("auto_scan")) !== "off");
      setWatchFs((await getSetting("watch_fs")) !== "off");
      setSubDefault((await getSetting("sub_default")) || "off");
      setSubLang((await getSetting("sub_lang")) || "en");
      setIntroSkip((await getSetting("intro_skip")) || "85");
      setIntroMode((await getSetting("intro_mode")) || "button");
      setIntroSource((await getSetting("intro_source")) || "auto");
      setIntroScanMin((await getSetting("intro_scan_min")) || "12");
      setIntroMinSec((await getSetting("intro_min_sec")) || "12");
      setAutoQuality((await getSetting("auto_quality")) || "highest");
      setThumbInterval((await getSetting("thumb_interval")) || "5");
      setThumbSize((await getSetting("thumb_size")) || "md");
      setHwdec((await getSetting("hwdec")) || "auto");
      setVideoOutput((await getSetting("video_output")) || "gpu-next");
      setPerfMode((await getSetting("perf_mode")) === "on");
      setSmoothing((await getSetting("playback_smoothing")) === "on");
      setAutoMatch((await getSetting("auto_match")) !== "off");
      const session = await getSession();
      setEmail(session?.user?.email ?? null);
    })();
  }, []);

  const loadTools = async () => {
    setToolsBusy(true);
    try {
      const rep = await checkTools();
      setTools(rep);
      setMpvPath(rep.mpv.path || "");
      setFfmpegPath(rep.ffmpeg.path || "");
      setFfprobePath(rep.ffprobe.path || "");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setToolsBusy(false);
    }
  };
  useEffect(() => {
    if (tab === "werkzeuge" && !tools) void loadTools();
    if (tab === "bibliothek" && cacheBytes == null) void thumbCacheSize().then(setCacheBytes).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const savePerformance = async () => {
    await setSetting("hwdec", hwdec);
    await setSetting("video_output", videoOutput);
    await setSetting("perf_mode", perfMode ? "on" : "off");
    await setSetting("playback_smoothing", smoothing ? "on" : "off");
    toast("Leistungs-Einstellungen gespeichert – beim nächsten Start einer Wiedergabe aktiv", "success");
  };

  const saveTools = async () => {
    await setSetting("mpv_path", mpvPath.trim());
    await setSetting("ffmpeg_path", ffmpegPath.trim());
    await setSetting("ffprobe_path", ffprobePath.trim());
    toast("Werkzeug-Pfade gespeichert", "success");
    await loadTools();
  };

  const saveDetection = async () => {
    await setSetting("auto_match", autoMatch ? "on" : "off");
    toast("Erkennungs-Einstellungen gespeichert", "success");
  };

  const savePlayback = async () => {
    await setSetting("auto_scan", autoScan ? "on" : "off");
    await setSetting("sub_default", subDefault);
    await setSetting("sub_lang", subLang);
    await setSetting("auto_quality", autoQuality);
    await setSetting("thumb_interval", String(Math.min(60, Math.max(1, parseInt(thumbInterval || "5", 10) || 5))));
    await setSetting("thumb_size", thumbSize);
    toast("Wiedergabe-Einstellungen gespeichert", "success");
  };

  const saveIntro = async () => {
    await setSetting("intro_skip", String(parseInt(introSkip || "85", 10) || 85));
    await setSetting("intro_mode", introMode);
    await setSetting("intro_source", introSource);
    await setSetting("intro_scan_min", String(Math.min(30, Math.max(3, parseInt(introScanMin || "12", 10) || 12))));
    await setSetting("intro_min_sec", String(Math.min(120, Math.max(4, parseInt(introMinSec || "12", 10) || 12))));
    toast("Intro-Einstellungen gespeichert", "success");
  };

  const doDetectIntros = async () => {
    try {
      await detectIntros();
      toast("Intro-Erkennung gestartet – Fortschritt & Restzeit oben rechts (ca. 2–5 Sek pro Folge)", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const saveMarker = async () => {
    await setSetting("marker_key", markerKey);
    toast("Steuerung gespeichert", "success");
  };

  const pickFolder = async (kind: "movie" | "tv") => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir === "string") {
      await addLibrary(dir, kind);
      qc.invalidateQueries({ queryKey: ["libraries"] });
      toast("Ordner hinzugefügt", "success");
    }
  };

  const autoDetect = async () => {
    const dir = await openDialog({ directory: true, multiple: false });
    if (typeof dir !== "string") return;
    setDetecting(true);
    try {
      const before = libs.data?.length ?? 0;
      const list = await detectLibraries(dir);
      qc.invalidateQueries({ queryKey: ["libraries"] });
      const added = list.length - before;
      toast(
        added > 0 ? `${added} Ordner automatisch erkannt und hinzugefügt` : "Keine passenden Film-/Serienordner gefunden",
        added > 0 ? "success" : "info",
      );
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setDetecting(false);
    }
  };

  const delLib = async (id: number) => {
    await removeLibrary(id);
    qc.invalidateQueries({ queryKey: ["libraries"] });
  };

  const saveTmdb = async () => {
    await setSetting("tmdb_key", tmdbKey.trim());
    await setSetting("tmdb_lang", lang);
    toast("TMDb-Einstellungen gespeichert", "success");
  };

  const saveSupabase = async () => {
    await setSetting("supabase_url", supaUrl.trim());
    await setSetting("supabase_anon_key", supaKey.trim());
    await reinitSupabase();
    toast("Supabase gespeichert", "success");
  };

  const doScan = async () => {
    try {
      await scanLibraries();
      toast("Scan gestartet", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doRefresh = async () => {
    try {
      await refreshMetadata();
      toast("Metadaten werden neu geladen …", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doProbe = async () => {
    try {
      await probeQualities(true);
      toast("Auflösung wird gelesen – Qualität wird für jede Datei genau erkannt", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doRebuild = async () => {
    if (!window.confirm("Bibliothek-Index leeren und komplett neu aufbauen?\n\nDeine Ordner, dein Gesehen-Stand, Favoriten und gemerkte Zuordnungen bleiben erhalten und werden nach dem Scan automatisch wieder verknüpft. Nur der Filme/Serien-Index wird frisch eingelesen (behebt alte Duplikate/Gruppierungen).")) {
      return;
    }
    try {
      await resetLibrary();
      await scanLibraries();
      toast("Bibliothek wird komplett neu aufgebaut …", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doExport = async () => {
    const path = await saveDialog({
      defaultPath: "ghgflix-daten.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (typeof path !== "string") return;
    try {
      const n = await exportData(path);
      toast(`${n} Einträge exportiert`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doImport = async () => {
    const path = await openDialog({ multiple: false, filters: [{ name: "JSON", extensions: ["json"] }] });
    if (typeof path !== "string") return;
    try {
      const n = await importData(path);
      toast(`${n} Einträge übernommen`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doOptimize = async () => {
    try {
      await dbOptimize();
      toast("Datenbank optimiert", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const doClearCache = async () => {
    try {
      const freed = await clearThumbCache();
      setCacheBytes(0);
      toast(`Vorschau-Cache geleert (${(freed / 1024 / 1024).toFixed(1)} MB frei)`, "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const logout = async () => {
    await signOut();
    setEmail(null);
    useStore.getState().setProfile("local", "Lokal");
    toast("Abgemeldet", "info");
  };

  const url = supaUrl.trim();
  const urlLooksLikeKey = url.startsWith("eyJ");
  const urlLooksWrong = url !== "" && (urlLooksLikeKey || !/^https?:\/\//i.test(url));

  return (
    <div className="px-8 py-6 max-w-3xl">
      <h1 className="text-3xl font-black mb-6">Einstellungen</h1>

      {/* tab bar */}
      <div className="flex gap-1.5 flex-wrap mb-6 border-b border-ghg-line pb-3">
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={
                "flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold transition border " +
                (active
                  ? "bg-ghg-red/15 text-ghg-red border-ghg-red/30"
                  : "text-ghg-muted hover:text-ghg-text hover:bg-ghg-surface2 border-transparent")
              }
            >
              <t.icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "allgemein" && (
        <>
          <Section title="Darstellung" desc="Theme, Kartengröße, Animationen und Info-Badges. Änderungen gelten sofort.">
            <div className="flex gap-2 flex-wrap mb-4">
              <Button onClick={() => setShowTheme(true)}>Theme-Store öffnen</Button>
              <Button variant="ghost" onClick={() => navigate("/stats")}>
                <BarChart3 className="w-4 h-4" /> Statistik
              </Button>
              <Button variant="ghost" onClick={() => setShowShortcuts(true)}>
                <Keyboard className="w-4 h-4" /> Tastenkürzel
              </Button>
            </div>
            <div className="flex gap-4 flex-wrap mb-3">
              <PrefSelect k="cardSize" label="Kartengröße" options={[["sm", "Klein"], ["md", "Mittel"], ["lg", "Groß"]]} />
              <PrefNumber k="fontScale" label="Schriftgröße / UI-Zoom (%)" min={80} max={130} step={5} />
              <PrefNumber k="toastSec" label="Hinweis-Dauer (Sek.)" min={2} max={15} />
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Akzentfarbe</span>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={accent}
                    onChange={(e) => {
                      setAccent(e.target.value);
                      applyAccent(e.target.value);
                    }}
                    className="h-9 w-14 rounded-lg bg-ghg-bg2 border border-ghg-line cursor-pointer"
                  />
                  <button
                    onClick={() => {
                      applyAccent(null);
                      setAccent("#e50914");
                      toast("Akzentfarbe zurückgesetzt", "info");
                    }}
                    className="text-xs text-ghg-muted hover:text-ghg-text underline"
                  >
                    Zurücksetzen
                  </button>
                </div>
              </label>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6">
              <PrefToggle k="animations" label="Animationen (Übergänge, Einblendungen)" />
              <PrefToggle k="hoverZoom" label="Karten beim Überfahren vergrößern" />
              <PrefToggle k="pageTransition" label="Seitenübergang (Einblenden)" />
              <PrefToggle k="badgeUnmatched" label="„Nicht erkannt“-Badge anzeigen" />
              <PrefToggle k="badgeNew" label="„NEU“-Badge (letzte 7 Tage)" />
              <PrefToggle k="badgeWatched" label="Gesehen-Häkchen auf Karten" />
              <PrefToggle k="sidebarCompact" label="Kompakte Seitenleiste (nur Icons)" />
              <PrefToggle k="greeting" label="Begrüßung auf der Startseite" />
            </div>
          </Section>

          <Section
            title="Kindersicherung"
            desc="Blendet Titel oberhalb der gewählten Altersfreigabe überall aus. Titel ohne bekannte Freigabe werden sicherheitshalber mit ausgeblendet."
          >
            <PrefSelect
              k="kidsMaxCert"
              label="Maximale Altersfreigabe"
              options={[["off", "Aus (alles zeigen)"], ["0", "FSK 0"], ["6", "FSK 6"], ["12", "FSK 12"], ["16", "FSK 16"]]}
              className="max-w-xs block"
            />
          </Section>

          <Section title="Startseite" desc="Welche Reihen angezeigt werden und wie das große Titelbild funktioniert.">
            <div className="flex gap-4 flex-wrap mb-3">
              <PrefSelect
                k="startPage"
                label="Beim Start öffnen"
                options={[["home", "Start"], ["movies", "Filme"], ["shows", "Serien"], ["list", "Meine Liste"]]}
              />
              <PrefSelect k="heroMode" label="Titelbild-Auswahl" options={[["random", "Zufällig"], ["newest", "Neuester Titel"]]} />
              <PrefNumber k="heroRotateSec" label="Titelbild wechseln (Sek., 0 = aus)" min={0} max={120} />
              <PrefNumber k="genreRowCount" label="Anzahl Genre-Reihen" min={0} max={20} />
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6">
              <PrefToggle k="heroEnabled" label="Großes Titelbild anzeigen" />
              <PrefToggle k="rowContinue" label="Reihe: Weiterschauen" />
              <PrefToggle k="rowRecent" label="Reihe: Neu hinzugefügt" />
              <PrefToggle k="rowMyList" label="Reihe: Meine Liste" />
              <PrefToggle k="rowShows" label="Reihe: Serien" />
              <PrefToggle k="rowMovies" label="Reihe: Filme" />
              <PrefToggle k="rowTopRated" label="Reihe: Top bewertet" />
              <PrefToggle k="rowHistory" label="Reihe: Zuletzt gesehen" />
              <PrefToggle k="rowGenres" label="Genre-Reihen" />
            </div>
          </Section>

          <Section title="Scrollen" desc="Verhalten des seitlichen Scrollens (Tilt-Rad / Shift+Mausrad) in den Reihen.">
            <div className="flex gap-4 flex-wrap items-end mb-3">
              <PrefNumber k="scrollSpeed" label="Scroll-Geschwindigkeit (×)" min={0.5} max={4} step={0.1} />
              <div className="pb-1">
                <PrefToggle k="scrollSmooth" label="Sanftes Gleiten (aus = direkt)" />
              </div>
            </div>
            <PrefToggle k="wheelRowScroll" label="Normales Mausrad scrollt Reihen seitwärts (wenn der Zeiger über einer Reihe ist)" />
            <p className="text-xs text-ghg-muted mt-2">
              MX Master / Logitech: Falls das Daumenrad hier nichts tut, stelle in{" "}
              <span className="text-ghg-text">Logi Options+ → Maus → Daumenrad</span> die Aktion auf{" "}
              <span className="text-ghg-text">„Horizontaler Bildlauf"</span> (ggf. app-spezifisch für ghgflix.exe).
              Alternativ den Schalter oben aktivieren oder Shift+Mausrad nutzen.
            </p>
          </Section>

          <Section
            title="Maskottchen"
            desc="Ein kleiner Begleiter unten links: zappelt beim Scannen, freut sich wenn’s fertig ist, und gibt Tipps."
          >
            <div className="flex gap-4 flex-wrap items-end">
              <PrefSelect
                k="mascot"
                label="Maskottchen"
                options={[
                  ["off", "Aus"],
                  ["blitz", "⚡ Blitzi"],
                  ["katze", "🐱 Kino-Katze"],
                  ["robo", "🤖 Robo"],
                  ["geist", "👻 Flixi"],
                  ["drache", "🐲 Drako"],
                  ["pinguin", "🐧 Pingu"],
                ]}
              />
              <div className="pb-1">
                <PrefToggle k="mascotTips" label="Tipps anzeigen" />
              </div>
            </div>
          </Section>

          <Section
            title="Steuerung"
            desc="Taste für die Merk-Funktion im Player."
            info={
              <>
                <p className="font-semibold text-ghg-text">Merk-Funktion</p>
                <p>
                  Drücke die Taste im Player einmal, um deine <span className="text-ghg-red">aktuelle Position zu merken</span>{" "}
                  (läuft normal weiter). Drücke sie erneut, um <span className="text-ghg-red">genau dorthin zurückzuspringen</span>.
                </p>
              </>
            }
          >
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-ghg-muted">Marke setzen / zurückspringen:</span>
              <KeyCapture value={markerKey} onChange={setMarkerKey} />
              <Button onClick={saveMarker}>Speichern</Button>
            </div>
          </Section>

          <Section title="Über GHGFlix & Updates" desc="Version, Projektseite und Update-Prüfung gegen GitHub-Releases.">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <span className="text-sm">
                Version: <span className="font-mono font-semibold">{version || "…"}</span>
              </span>
              <Button variant="ghost" onClick={() => void openUrl("https://github.com/BastiLd/GHGFLIX").catch(() => {})}>
                GitHub öffnen
              </Button>
              <Button variant="ghost" onClick={() => void checkUpdates(false)}>
                Auf Updates prüfen
              </Button>
            </div>
            {updateInfo && <p className="text-sm text-ghg-muted mb-3">{updateInfo}</p>}
            <PrefToggle k="updateCheck" label="Beim Öffnen der Einstellungen automatisch auf Updates prüfen" />
          </Section>
        </>
      )}

      {tab === "wiedergabe" && (
        <>
          <Section title="Wiedergabe" desc="Verhalten des Players. Punkte mit Haken gelten sofort, der Rest beim nächsten Start einer Wiedergabe.">
            <div className="flex gap-4 flex-wrap mb-4">
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Auto-Qualität (bei mehreren Dateien)</span>
                <select value={autoQuality} onChange={(e) => setAutoQuality(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="highest">Immer höchste</option>
                  <option value="lowest">Immer niedrigste</option>
                  <option value="2160">Bis 4K (2160p)</option>
                  <option value="1080">Bis 1080p</option>
                  <option value="720">Bis 720p</option>
                </select>
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Untertitel standardmäßig</span>
                <select value={subDefault} onChange={(e) => setSubDefault(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="off">Aus</option>
                  <option value="on">An</option>
                </select>
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Untertitel-Sprache</span>
                <select value={subLang} onChange={(e) => setSubLang(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="en">Englisch</option>
                  <option value="de">Deutsch</option>
                  <option value="fr">Französisch</option>
                  <option value="es">Spanisch</option>
                </select>
              </label>
            </div>
            <div className="flex gap-4 flex-wrap mb-4">
              <PrefSelect k="audioLangPref" label="Audio-Sprache bevorzugen" options={[["en-de", "Englisch, dann Deutsch"], ["de-en", "Deutsch, dann Englisch"], ["file", "Datei-Standard"]]} />
              <PrefNumber k="subScale" label="Untertitel-Größe (×)" min={0.5} max={2} step={0.1} />
              <PrefSelect k="pipSize" label="Bild-im-Bild-Größe" options={[["sm", "Klein"], ["md", "Mittel"], ["lg", "Groß"]]} />
            </div>
            <div className="flex gap-4 flex-wrap mb-4">
              <PrefNumber k="seekSmall" label="Spulen kurz (Sek.)" min={2} max={60} />
              <PrefNumber k="seekBig" label="Spulen lang – Shift (Sek.)" min={10} max={300} />
              <PrefNumber k="volumeStep" label="Lautstärke-Schritt (%)" min={1} max={25} />
              <PrefNumber k="volumeMax" label="Max. Lautstärke (% – Boost)" min={100} max={150} step={5} />
              <PrefNumber k="uiTimeoutSec" label="Steuerung ausblenden nach (Sek.)" min={1} max={15} />
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 mb-4">
              <PrefToggle k="dblClickSeek" label="Doppelklick links/rechts spult" />
              <PrefToggle k="rememberTrackLang" label="Gewählte Audio-Sprache merken" />
              <PrefToggle k="autoplayNext" label="Nächste Folge automatisch abspielen" />
              <PrefToggle k="endAutoBack" label="Nach dem Ende automatisch zurück" />
              <PrefToggle k="screenshotEnabled" label="Screenshot-Knopf & S-Taste anzeigen" />
              <PrefToggle k="showClock" label="Uhrzeit im Player anzeigen" />
              <PrefToggle k="showEndsAt" label="„endet um …“ anzeigen" />
              <PrefToggle k="chapterMarkers" label="Kapitel-Markierungen auf der Zeitleiste" />
              <PrefToggle k="introMarker" label="Intro-Bereich auf der Zeitleiste markieren" />
              <PrefToggle k="epLocalStills" label="Folgen ohne TMDb-Bild: Bild aus der Videodatei ziehen" />
            </div>
            <div className="flex gap-4 flex-wrap mb-4">
              <PrefNumber k="nextCountdownSec" label="„Nächste Folge“-Countdown (Sek.)" min={5} max={60} />
              <PrefNumber k="watchedThreshold" label="Als gesehen ab (%)" min={50} max={99} />
            </div>
            <Button onClick={savePlayback}>Speichern</Button>
          </Section>

          <Section
            title="Mini-Player"
            desc="Zurück-Knopf im Player öffnet einen kleinen Player unten rechts (wie YouTube) – du kannst weiter stöbern, Dinge in die Warteschlange legen und das Video läuft weiter."
          >
            <div className="grid sm:grid-cols-2 gap-x-6 mb-3">
              <PrefToggle k="miniPlayer" label="Mini-Player beim Zurückgehen (empfohlen)" />
            </div>
            <PrefSelect k="miniSize" label="Mini-Player-Größe" options={[["sm", "Klein"], ["md", "Mittel"], ["lg", "Groß"]]} className="max-w-xs block" />
            <p className="text-xs text-ghg-muted mt-3">
              Warteschlange füllen: Rechtsklick auf Filme/Folgen → „Als Nächstes“ / „Zur Warteschlange“ – eine ganze
              (Rest-)Staffel landet dabei als EIN Eintrag. Aus = der Zurück-Knopf beendet die Wiedergabe wie früher.
            </p>
          </Section>

          <Section title="Seek-Vorschau" desc="Das Vorschaubild beim Ziehen/Überfahren der Zeitleiste.">
            <div className="grid sm:grid-cols-2 gap-x-6 mb-3">
              <PrefToggle k="thumbEnabled" label="Vorschaubilder anzeigen" />
            </div>
            <div className="flex gap-4 flex-wrap mb-4">
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Vorschau-Intervall (Sekunden)</span>
                <TextInput value={thumbInterval} onChange={setThumbInterval} type="number" />
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Vorschau-Größe</span>
                <select value={thumbSize} onChange={(e) => setThumbSize(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="sm">Klein</option>
                  <option value="md">Mittel</option>
                  <option value="lg">Groß</option>
                </select>
              </label>
            </div>
            <Button onClick={savePlayback}>Speichern</Button>
            <p className="text-xs text-ghg-muted mt-2">
              Vorschaubilder werden jetzt auf der Festplatte zwischengespeichert – beim zweiten Überfahren erscheinen sie sofort.
            </p>
          </Section>
        </>
      )}

      {tab === "intro" && (
        <>
          <Section
            title="Intro überspringen"
            desc="Wie der „Intro überspringen“-Knopf (bzw. das automatische Überspringen) funktioniert."
            info={
              <>
                <p className="font-semibold text-ghg-text">Woher weiß GHGFlix, wo das Intro ist?</p>
                <p>
                  1. <span className="text-ghg-red">Kapitel</span> in der Datei (am genauesten) · 2.{" "}
                  <span className="text-ghg-red">Audio-Erkennung</span> (unten starten) · 3. Dein{" "}
                  <span className="text-ghg-red">manuell gesetztes Intro</span> (im Player: Rechtsklick → „Intro: Start/Ende hier setzen“,
                  oder pro Serie auf der Serienseite) · 4. Feste Zeit als letzter Ausweg.
                </p>
                <p>Manuell gesetzt schlägt alles andere – wenn die Erkennung daneben liegt, setz das Intro einfach einmal von Hand.</p>
              </>
            }
          >
            <div className="flex gap-4 flex-wrap mb-4">
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Modus</span>
                <select value={introMode} onChange={(e) => setIntroMode(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="button">Knopf anzeigen</option>
                  <option value="auto">Automatisch überspringen</option>
                  <option value="off">Aus</option>
                </select>
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Quelle</span>
                <select value={introSource} onChange={(e) => setIntroSource(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                  <option value="auto">Automatisch (Kapitel → Audio → feste Zeit)</option>
                  <option value="audio">Nur Audio-Erkennung (keine Kapitel)</option>
                  <option value="chapters">Nur Kapitel</option>
                  <option value="fixed">Nur feste Zeit</option>
                </select>
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Feste Zeit: Intro-Ende bei (Sek.)</span>
                <TextInput value={introSkip} onChange={setIntroSkip} type="number" />
              </label>
            </div>
            <Button onClick={saveIntro}>Speichern</Button>
          </Section>

          <Section
            title="Automatische Intro-Erkennung (Audio)"
            desc="Vergleicht den Ton aufeinanderfolgender Folgen und findet die gemeinsame Sequenz = das Intro."
          >
            <div className="flex gap-4 flex-wrap mb-4">
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Analyse-Fenster (Minuten ab Folgenstart)</span>
                <TextInput value={introScanMin} onChange={setIntroScanMin} type="number" />
              </label>
              <label className="flex-1 min-w-40">
                <span className="text-xs uppercase tracking-wide text-ghg-muted">Mindest-Introlänge (Sek.)</span>
                <TextInput value={introMinSec} onChange={setIntroMinSec} type="number" />
              </label>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <Button onClick={saveIntro}>Speichern</Button>
              <Button variant="ghost" onClick={doDetectIntros}>
                <ScanSearch className="w-4 h-4" /> Jetzt für alle Serien erkennen
              </Button>
            </div>
            <p className="text-xs text-ghg-muted mt-3">
              Tipp bei Fehl-Erkennungen: Mindest-Introlänge erhöhen (z. B. 20 Sek.) filtert kurze „Zuletzt bei…“-Rückblicke raus.
              Einzelne Serien kannst du auch direkt auf der Serienseite erkennen lassen oder von Hand festlegen.
            </p>
          </Section>
        </>
      )}

      {tab === "leistung" && (
        <Section
          title="Leistung & Kompatibilität"
          desc="Hardware-Beschleunigung & Renderer. Das Wichtigste gegen Ruckler – und macht mehr Formate flüssig abspielbar."
          info={
            <>
              <p className="font-semibold text-ghg-text">Bei Rucklern zuerst:</p>
              <p>
                <span className="text-ghg-red">Hardware-Dekodierung = Automatisch</span> (nutzt die Grafikkarte – meist
                die größte Verbesserung) und bei schwachen PCs zusätzlich den <span className="text-ghg-red">Leistungsmodus</span> aktivieren.
              </p>
              <p>
                Falls das Bild schwarz bleibt oder abstürzt: Hardware-Dekodierung auf <span className="text-ghg-red">Aus</span>{" "}
                oder Renderer auf <span className="text-ghg-red">Kompatibel</span> stellen.
              </p>
              <p>Änderungen greifen beim nächsten Start einer Wiedergabe.</p>
            </>
          }
        >
          <div className="flex gap-4 flex-wrap mb-4">
            <label className="flex-1 min-w-40">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Hardware-Dekodierung</span>
              <select value={hwdec} onChange={(e) => setHwdec(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                <option value="auto">Automatisch (empfohlen)</option>
                <option value="auto-copy">Automatisch (kompatibel)</option>
                <option value="no">Aus (nur CPU)</option>
              </select>
            </label>
            <label className="flex-1 min-w-40">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">Renderer</span>
              <select value={videoOutput} onChange={(e) => setVideoOutput(e.target.value)} className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red">
                <option value="gpu-next">Modern (gpu-next)</option>
                <option value="gpu">Kompatibel (gpu)</option>
                <option value="auto">Automatisch</option>
              </select>
            </label>
          </div>
          <label className="flex items-center gap-3 mb-3 cursor-pointer">
            <input type="checkbox" checked={perfMode} onChange={(e) => setPerfMode(e.target.checked)} className="w-4 h-4 accent-ghg-red" />
            <span className="text-sm">Leistungsmodus für schwächere PCs (minimal weniger Bildqualität, deutlich flüssiger)</span>
          </label>
          <label className="flex items-center gap-3 mb-4 cursor-pointer">
            <input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} className="w-4 h-4 accent-ghg-red" />
            <span className="text-sm">Laufruhe-Modus (synchronisiert Bilder mit dem Monitor – nur bei Mikro-Rucklern aktivieren)</span>
          </label>
          <Button onClick={savePerformance}>Speichern</Button>
        </Section>
      )}

      {tab === "bibliothek" && (
        <>
          <Section
            title="Bibliotheken"
            desc="Wähle einzelne Ordner – oder lass GHGFlix einen Überordner/ein Laufwerk automatisch nach Film- und Serienordnern durchsuchen."
            info={
              <>
                <p className="font-semibold text-ghg-text">Automatisch erkennen</p>
                <p>
                  Wähle einen Überordner oder ein ganzes Laufwerk. GHGFlix sucht darin nach Ordnern wie
                  <span className="text-ghg-red"> Movies, Filme, TV, Serien, Shows, Anime</span> … und ordnet sie passend zu.
                </p>
                <p>Ein zeitweise nicht angeschlossenes Laufwerk ist kein Problem – Einträge werden nicht mehr gelöscht, solange es offline ist.</p>
              </>
            }
          >
            <div className="space-y-2 mb-4">
              {libs.isLoading && <Spinner />}
              {libs.data?.length === 0 && <p className="text-sm text-ghg-muted">Noch keine Ordner hinzugefügt.</p>}
              {libs.data?.map((l) => (
                <div key={l.id} className="flex items-center gap-3 bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2">
                  {l.kind === "movie" ? <Film className="w-4 h-4 text-ghg-red" /> : <Tv className="w-4 h-4 text-ghg-red" />}
                  <span className="flex-1 text-sm truncate" title={l.path}>
                    {l.path}
                  </span>
                  <span className="text-xs text-ghg-muted uppercase">{l.kind === "movie" ? "Filme" : "Serien"}</span>
                  <button onClick={() => delLib(l.id)} className="p-1.5 rounded-md hover:bg-ghg-red-dark/30 text-ghg-red">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              <Button onClick={autoDetect} disabled={detecting}>
                {detecting ? <Spinner className="w-4 h-4" /> : <FolderInput className="w-4 h-4" />} Ordner/Laufwerk automatisch erkennen
              </Button>
              <Button variant="ghost" onClick={() => pickFolder("movie")}>
                <FolderPlus className="w-4 h-4" /> Filmordner
              </Button>
              <Button variant="ghost" onClick={() => pickFolder("tv")}>
                <FolderPlus className="w-4 h-4" /> Serienordner
              </Button>
            </div>
            <label className="flex items-center gap-3 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={autoScan}
                onChange={async (e) => {
                  setAutoScan(e.target.checked);
                  await setSetting("auto_scan", e.target.checked ? "on" : "off");
                }}
                className="w-4 h-4 accent-ghg-red"
              />
              <span className="text-sm">Beim Start automatisch scannen</span>
            </label>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={watchFs}
                onChange={async (e) => {
                  setWatchFs(e.target.checked);
                  await setSetting("watch_fs", e.target.checked ? "on" : "off");
                }}
                className="w-4 h-4 accent-ghg-red"
              />
              <span className="text-sm">Ordner live überwachen (neue Dateien automatisch erkennen)</span>
            </label>
          </Section>

          <Section title="Wartung" desc="Scannen, Metadaten, Qualität, Neuaufbau, Datensicherung.">
            <div className="flex gap-2 flex-wrap mb-4">
              <Button variant="ghost" onClick={doScan}>
                <RefreshCw className="w-4 h-4" /> Jetzt scannen
              </Button>
              <Button variant="ghost" onClick={doRefresh}>
                <RefreshCw className="w-4 h-4" /> Metadaten neu laden
              </Button>
              <Button variant="ghost" onClick={doProbe}>
                <Sparkles className="w-4 h-4" /> Qualität neu erkennen
              </Button>
              <Button variant="danger" onClick={doRebuild}>
                <Trash2 className="w-4 h-4" /> Bibliothek neu aufbauen
              </Button>
            </div>
            <div className="flex gap-2 flex-wrap mb-4">
              <Button variant="ghost" onClick={doExport}>Gesehen-Daten exportieren</Button>
              <Button variant="ghost" onClick={doImport}>Gesehen-Daten importieren</Button>
              <Button variant="ghost" onClick={doOptimize}>Datenbank optimieren</Button>
              <Button variant="ghost" onClick={() => void openAppData().catch(() => {})}>
                <FolderInput className="w-4 h-4" /> App-Daten öffnen
              </Button>
              <Button variant="ghost" onClick={doClearCache}>
                Vorschau-Cache leeren{cacheBytes != null ? ` (${(cacheBytes / 1024 / 1024).toFixed(1)} MB)` : ""}
              </Button>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-6 mb-3">
              <PrefToggle k="autoBackup" label="Wöchentliches Auto-Backup der Gesehen-Daten (in App-Daten)" />
            </div>
            <p className="text-xs text-ghg-muted">
              „Bibliothek neu aufbauen" behält Gesehen-Stand, Favoriten und gemerkte Zuordnungen – alles wird nach dem Scan
              automatisch wieder verknüpft (jetzt zusätzlich über den Dateipfad, funktioniert also auch komplett ohne TMDb).
              Der Export sichert Gesehen-Stand + Favoriten als JSON (z. B. für einen anderen PC).
            </p>
          </Section>
        </>
      )}

      {tab === "erkennung" && (
        <Section
          title="Automatische Erkennung"
          desc="Wie GHGFlix Filme/Serien automatisch TMDb zuordnet. Manuelle Zuordnungen über „Identifizieren“ bleiben nach jedem Neuscan erhalten."
          info={
            <>
              <p className="font-semibold text-ghg-text">Automatische Zuordnung</p>
              <p>
                Beim Scan sucht GHGFlix passende TMDb-Einträge – dabei werden <span className="text-ghg-red">nur Buchstaben</span>{" "}
                des Titels verwendet, damit Release-Kürzel und Zahlen nicht stören.
              </p>
              <p>
                Klappt es bei einem Titel nicht, ordne ihn einmal über <span className="text-ghg-red">„Identifizieren“</span> zu und
                lass den Haken <span className="text-ghg-red">„Zuordnung dauerhaft merken“</span> an – dann wird er für immer richtig erkannt.
              </p>
            </>
          }
        >
          <label className="flex items-center gap-3 mb-4 cursor-pointer">
            <input type="checkbox" checked={autoMatch} onChange={(e) => setAutoMatch(e.target.checked)} className="w-4 h-4 accent-ghg-red" />
            <span className="text-sm">Beim Scan automatisch mit TMDb zuordnen (empfohlen)</span>
          </label>
          <div className="flex gap-2 flex-wrap items-center">
            <Button onClick={saveDetection}>Speichern</Button>
            <Button variant="ghost" onClick={doRefresh}>
              <RefreshCw className="w-4 h-4" /> Metadaten neu laden
            </Button>
          </div>
        </Section>
      )}

      {tab === "tmdb" && (
        <Section
          title="TMDb"
          desc="Für Poster, Beschreibungen, Altersfreigaben und Episodendaten."
          info={
            <>
              <p className="font-semibold text-ghg-text">So bekommst du den TMDb-API-Key (kostenlos):</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Auf <span className="text-ghg-red">themoviedb.org</span> ein Konto erstellen
                </li>
                <li>Oben rechts Profilbild → <span className="text-ghg-red">Einstellungen</span></li>
                <li>Linke Leiste → <span className="text-ghg-red">API</span> → API-Schlüssel beantragen (Typ „Developer")</li>
                <li>
                  Den Wert <span className="text-ghg-red">API Key (v3 auth)</span> kopieren und unten eintragen.
                </li>
              </ol>
            </>
          }
        >
          <label className="block mb-3">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">API-Key (v3 auth)</span>
            <TextInput value={tmdbKey} onChange={setTmdbKey} placeholder="z. B. 1a2b3c…" type="password" />
          </label>
          <label className="block mb-4">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Sprache der Metadaten</span>
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value)}
              className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
            >
              <option value="de-DE">Deutsch</option>
              <option value="en-US">English</option>
              <option value="fr-FR">Français</option>
              <option value="es-ES">Español</option>
              <option value="it-IT">Italiano</option>
              <option value="ja-JP">日本語</option>
              <option value="pt-BR">Português (BR)</option>
              <option value="tr-TR">Türkçe</option>
              <option value="pl-PL">Polski</option>
              <option value="ru-RU">Русский</option>
            </select>
          </label>
          <Button onClick={saveTmdb}>Speichern</Button>
        </Section>
      )}

      {tab === "werkzeuge" && (
        <Section
          title="Externe Werkzeuge"
          desc="mpv (Wiedergabe), ffmpeg (Vorschau/Intro), ffprobe (Qualitäts-Erkennung). GHGFlix findet und repariert die Pfade automatisch – auch wenn ein Update sie verschiebt."
        >
          <div className="space-y-2 mb-4">
            <ToolRow name="mpv" status={tools?.mpv} />
            <ToolRow name="ffmpeg" status={tools?.ffmpeg} />
            <ToolRow name="ffprobe" status={tools?.ffprobe} />
          </div>
          <div className="flex gap-2 mb-5">
            <Button onClick={loadTools} disabled={toolsBusy}>
              {toolsBusy ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />} Neu prüfen & reparieren
            </Button>
          </div>
          <div className="border-t border-ghg-line pt-4 space-y-3">
            <p className="text-xs text-ghg-muted">Manuelle Pfade (nur nötig, wenn die automatische Erkennung nichts findet):</p>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">mpv-Pfad</span>
              <TextInput value={mpvPath} onChange={setMpvPath} placeholder="C:\Program Files\MPV Player\mpv.exe" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">ffmpeg-Pfad</span>
              <TextInput value={ffmpegPath} onChange={setFfmpegPath} placeholder="voller Pfad zur ffmpeg.exe" />
            </label>
            <label className="block">
              <span className="text-xs uppercase tracking-wide text-ghg-muted">ffprobe-Pfad</span>
              <TextInput value={ffprobePath} onChange={setFfprobePath} placeholder="voller Pfad zur ffprobe.exe" />
            </label>
            <Button onClick={saveTools}>Pfade speichern</Button>
          </div>
          <p className="text-xs text-ghg-muted mt-3">
            Fehlt ffmpeg/ffprobe? Installation z. B. mit <span className="text-ghg-text font-mono">winget install ffmpeg</span> –
            danach hier „Neu prüfen“.
          </p>
        </Section>
      )}

      {tab === "konto" && (
        <Section
          title="Konto & Sync (Supabase)"
          desc="Optional: Anmelden, damit Profile und Fortschritt zwischen mehreren PCs synchronisiert werden."
          info={
            <>
              <p className="font-semibold text-ghg-text">Wo finde ich URL und Key?</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>
                  Kostenloses Projekt auf <span className="text-ghg-red">supabase.com</span> anlegen
                </li>
                <li>
                  Im Projekt: <span className="text-ghg-red">SQL Editor</span> → Inhalt von{" "}
                  <span className="text-ghg-red">supabase/schema.sql</span> einfügen und ausführen
                </li>
                <li>
                  <span className="text-ghg-red">Project Settings → API</span> öffnen
                </li>
                <li>
                  <span className="text-ghg-red">Project URL</span> kopieren – sieht so aus:{" "}
                  <span className="text-ghg-text">https://abcdefgh.supabase.co</span>
                </li>
                <li>
                  Darunter <span className="text-ghg-red">Project API keys → anon public</span> kopieren (beginnt mit{" "}
                  <span className="text-ghg-text">eyJ…</span>)
                </li>
              </ol>
              <p className="text-ghg-red font-semibold">
                Achtung: Oben die URL (https://…), unten der eyJ…-Key. Nicht vertauschen!
              </p>
            </>
          }
        >
          <label className="block mb-1">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Project URL</span>
            <TextInput value={supaUrl} onChange={setSupaUrl} placeholder="https://abcdefgh.supabase.co" />
          </label>
          {urlLooksWrong && (
            <p className="text-xs text-ghg-red mb-3">
              {urlLooksLikeKey
                ? "Das sieht nach dem anon-Key aus, nicht nach der URL. Die URL beginnt mit https:// und endet auf .supabase.co"
                : "Die URL sollte mit https:// beginnen (z. B. https://abcdefgh.supabase.co)."}
            </p>
          )}
          <label className="block mb-4 mt-3">
            <span className="text-xs uppercase tracking-wide text-ghg-muted">Anon Key (eyJ…)</span>
            <TextInput value={supaKey} onChange={setSupaKey} placeholder="eyJhbGciOi…" type="password" />
          </label>
          <div className="flex gap-2 items-center flex-wrap">
            <Button onClick={saveSupabase}>Speichern</Button>
            {email ? (
              <>
                <span className="text-sm text-ghg-muted">Angemeldet als {email}</span>
                <Button variant="ghost" onClick={() => navigate("/profiles")}>
                  Profile
                </Button>
                <Button variant="danger" onClick={logout}>
                  Abmelden
                </Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => navigate("/login")}>
                Anmelden
              </Button>
            )}
          </div>
        </Section>
      )}

      <p className="text-xs text-ghg-muted text-center mt-8">GHGFlix{version ? ` · v${version}` : ""} · Rot/Schwarz ZickZack Edition</p>

      <ThemeStore open={showTheme} onClose={() => setShowTheme(false)} />

      <Modal open={showShortcuts} onClose={() => setShowShortcuts(false)} title="Tastenkürzel (Player)">
        <div className="space-y-2 text-sm">
          {[
            ["Leertaste / Klick", "Play / Pause"],
            ["← / → · J / L", "Kurz zurück / vor"],
            ["Shift + ← / →", "Lang zurück / vor"],
            ["0 – 9", "Zu 0–90 % springen"],
            ["↑ / ↓ · Mausrad", "Lautstärke +/−"],
            ["[ / ]", "Geschwindigkeit −/+"],
            [". / ,", "Einzelbild vor / zurück"],
            ["A", "Bildformat wechseln"],
            ["M", "Stummschalten"],
            ["C", "Untertitel an/aus"],
            ["S", "Screenshot speichern"],
            ["N", "Nächste Folge"],
            ["Bild ↑ / Bild ↓", "Kapitel zurück / vor"],
            ["F / Doppelklick Mitte", "Vollbild"],
            ["Doppelklick links/rechts", "Spulen"],
            ["P", "Bild-im-Bild"],
            [comboLabel(markerKey), "Position merken / zurückspringen"],
            ["Esc", "Vollbild/PiP beenden bzw. zurück"],
            ["Maus-Zurück-Taste", "Zur Übersicht zurück"],
          ].map(([k, v]) => (
            <div key={v} className="flex justify-between border-b border-ghg-line py-1.5">
              <span className="font-mono text-ghg-red">{k}</span>
              <span className="text-ghg-muted">{v}</span>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}

import { getVersion } from "@tauri-apps/api/app";
import { listen } from "@tauri-apps/api/event";
import clsx from "clsx";
import { Film, Heart, House, RefreshCw, Search, Settings as SettingsIcon, Tv, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSetting, listMovies, listShows, scanLibraries } from "../lib/api";
import { dedupeMovies } from "../lib/format";
import { miniClipPath, usePlayback } from "../lib/playback";
import { useStore } from "../lib/store";
import { useUiPrefs } from "../lib/uiPrefs";
import type { ScanProgress } from "../lib/types";
import { Wordmark, ZigZag } from "./Brand";
import { Mascot } from "./Mascot";
import { Spinner, Toasts } from "./ui";

const NAV = [
  { to: "/", label: "Start", icon: House, end: true },
  { to: "/movies", label: "Filme", icon: Film, end: false },
  { to: "/shows", label: "Serien", icon: Tv, end: false },
  { to: "/list", label: "Meine Liste", icon: Heart, end: false },
  { to: "/settings", label: "Einstellungen", icon: SettingsIcon, end: false },
];

let autoScanned = false;

/** seconds → "1:05 Min" / "45 Sek" */
function formatEta(sec: number): string {
  if (!isFinite(sec) || sec < 0) return "";
  const s = Math.round(sec);
  if (s < 60) return `${s} Sek`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")} Min`;
}

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const profileName = useStore((s) => s.profileName);
  const toast = useStore((s) => s.toast);
  const [scan, setScan] = useState<ScanProgress | null>(null);
  const [search, setSearch] = useState("");
  const [version, setVersion] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const pageTransition = useUiPrefs((s) => s.pageTransition && s.animations);
  const mini = usePlayback((s) => s.mini);
  const miniSize = useUiPrefs((s) => s.miniSize);
  const compact = useUiPrefs((s) => s.sidebarCompact);
  const [, resizeTick] = useState(0);
  const moviesQ = useQuery({ queryKey: ["movies"], queryFn: listMovies });
  const showsQ = useQuery({ queryKey: ["shows"], queryFn: listShows });
  const counts: Record<string, number | undefined> = {
    "/movies": moviesQ.data ? dedupeMovies(moviesQ.data).length : undefined,
    "/shows": showsQ.data?.length,
  };

  // while the mini-player is active, cut a transparent hole into the opaque
  // Layout background so the shrunken mpv video shows through
  useEffect(() => {
    if (!mini) return;
    const onResize = () => resizeTick((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mini]);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
  }, []);

  // Ctrl+F or "/" jumps into the library search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === "INPUT" || (e.target as HTMLElement)?.tagName === "TEXTAREA";
      if ((e.ctrlKey && e.key.toLowerCase() === "f") || (!typing && e.key === "/")) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // anchor for ETA: when the current run started and at which count
  const startRef = useRef<{ t: number; current: number } | null>(null);
  const [, tick] = useState(0); // forces a re-render every second for a live ETA

  useEffect(() => {
    if (!autoScanned) {
      autoScanned = true;
      getSetting("auto_scan").then((v) => {
        if (v !== "off") scanLibraries().catch(() => {});
      });
    }
  }, []);

  useEffect(() => {
    const un = listen<ScanProgress>("scan://progress", (e) => {
      const p = e.payload;
      setScan(p);
      // (re)anchor the ETA clock at the start of a run
      if (p.stage === "start" || !startRef.current) {
        startRef.current = { t: Date.now(), current: p.current };
      }
      if (p.stage === "done" || p.stage === "error") {
        startRef.current = null;
        setTimeout(() => setScan(null), 2500);
      }
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  // tick once per second while a run is active so the remaining time counts down live
  useEffect(() => {
    if (!scan || scan.stage === "done" || scan.stage === "error") return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [scan]);

  const rescan = async () => {
    try {
      await scanLibraries();
      toast("Scan gestartet", "info");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const submitSearch = () => {
    if (search.trim()) navigate(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  return (
    <div
      className="flex h-screen bg-ghg-bg text-ghg-text overflow-hidden"
      style={mini ? { clipPath: miniClipPath(miniSize) } : undefined}
    >
      {/* Sidebar (full or icon-only compact mode) */}
      <aside className={clsx("shrink-0 bg-ghg-bg2 border-r border-ghg-line flex flex-col", compact ? "w-16" : "w-60")}>
        <div className={compact ? "px-3 py-6 flex justify-center" : "px-5 py-6"}>
          {compact ? <ZigZag className="h-2 w-8" /> : <Wordmark />}
        </div>

        <nav className={clsx("flex-1 space-y-1", compact ? "px-2" : "px-3")}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                clsx(
                  "flex items-center gap-3 rounded-lg font-medium transition",
                  compact ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                  isActive
                    ? "bg-ghg-red/15 text-ghg-red border border-ghg-red/30"
                    : "text-ghg-muted hover:text-ghg-text hover:bg-ghg-surface2 border border-transparent",
                )
              }
            >
              <item.icon className="w-5 h-5" />
              {!compact && (
                <>
                  <span className="flex-1">{item.label}</span>
                  {counts[item.to] != null && (
                    <span className="text-[10px] tabular-nums text-ghg-muted bg-ghg-surface2 rounded-full px-1.5 py-0.5">
                      {counts[item.to]}
                    </span>
                  )}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <button
          onClick={() => navigate("/profiles")}
          title="Profil wechseln"
          className={clsx(
            "m-3 flex items-center gap-3 rounded-lg hover:bg-ghg-surface2 transition text-left",
            compact ? "justify-center px-0 py-2" : "px-3 py-2.5",
          )}
        >
          <div className="w-9 h-9 rounded-lg bg-ghg-red flex items-center justify-center shrink-0">
            <User className="w-5 h-5" />
          </div>
          {!compact && (
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate">{profileName}</p>
              <p className="text-xs text-ghg-muted">Profil wechseln</p>
            </div>
          )}
        </button>

        {!compact && (
          <div className="px-5 pb-4 pt-1">
            <ZigZag className="h-1.5 w-16 opacity-60 mb-1.5" />
            <p className="text-[10px] text-ghg-muted/70 tracking-wide">GHGFlix{version ? ` · v${version}` : ""} · ZickZack Edition</p>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 shrink-0 flex items-center gap-4 px-8 border-b border-ghg-line bg-ghg-bg/80 backdrop-blur">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ghg-muted" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submitSearch()}
              placeholder="Suchen …  (Strg+F)"
              className="w-full bg-ghg-surface2 border border-ghg-line rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-ghg-red transition"
            />
          </div>

          <div className="flex items-center gap-3">
            {scan && (() => {
              const active = scan.stage !== "done" && scan.stage !== "error";
              const hasBar = scan.total > 0;
              const pct = hasBar ? Math.min(100, Math.round((scan.current / scan.total) * 100)) : 0;
              let eta = "";
              const s = startRef.current;
              if (active && hasBar && s && scan.current > s.current) {
                const elapsed = (Date.now() - s.t) / 1000;
                const rate = (scan.current - s.current) / elapsed; // items / sec
                if (rate > 0) eta = formatEta((scan.total - scan.current) / rate);
              }
              return (
                <div className="flex items-center gap-3 w-72">
                  {active && <Spinner className="w-4 h-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 text-xs text-ghg-muted">
                      <span className={scan.stage === "error" ? "truncate text-ghg-red" : "truncate"}>{scan.message}</span>
                      {hasBar && active && (
                        <span className="shrink-0 tabular-nums">
                          {pct}%{eta ? ` · noch ~${eta}` : ""}
                        </span>
                      )}
                    </div>
                    {hasBar && (
                      <div className="mt-1 h-1.5 w-full rounded-full bg-ghg-surface2 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-ghg-red transition-all duration-500"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
            <button
              onClick={rescan}
              className="p-2 rounded-lg bg-ghg-surface2 hover:bg-ghg-elevated text-ghg-text transition"
              title="Bibliothek scannen"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {/* re-mount on route change for a subtle page-transition fade (configurable) */}
          <div
            key={pageTransition ? location.pathname : "static"}
            className={pageTransition ? "fade-in min-h-full" : "min-h-full"}
          >
            <Outlet />
          </div>
        </main>
      </div>

      <Mascot />
      <Toasts />
    </div>
  );
}

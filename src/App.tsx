import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow, listen } from "./lib/backend";
import { IS_WEB, setWebToken, webToken } from "./lib/platform";
import { useEffect, useState } from "react";
import { Wordmark } from "./components/Brand";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ContextMenu } from "./components/ContextMenu";
import { Layout } from "./components/Layout";
import { MiniPlayer } from "./components/MiniPlayer";
import { openCtx } from "./lib/contextmenu";
import { scanLibraries } from "./lib/api";
import { loadAccent, useUiPrefs } from "./lib/uiPrefs";
import { loadServerConfig, startServerSync } from "./lib/serverSync";
import { useGlobalHorizontalWheel } from "./lib/useHorizontalWheel";
import Home from "./pages/Home";
import Login from "./pages/Login";
import MovieDetail from "./pages/MovieDetail";
import Movies from "./pages/Movies";
import MyList from "./pages/MyList";
import Player from "./pages/Player";
import Profiles from "./pages/Profiles";
import SearchPage from "./pages/SearchPage";
import Settings from "./pages/Settings";
import Stats from "./pages/Stats";
import ShowDetail from "./pages/ShowDetail";
import Shows from "./pages/Shows";

/** Web build only: if the server has a password (GHGFLIX_PASSWORD), gate the
 *  whole UI behind a login — same look as the rest of the app. */
function WebAuthGate({ children }: { children: React.ReactNode }) {
  const [needed, setNeeded] = useState<boolean | null>(IS_WEB ? null : false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!IS_WEB) return;
    fetch("/api/ping")
      .then((r) => r.json())
      .then((r) => setNeeded(!!r.auth && !webToken()))
      .catch(() => setNeeded(false));
    const onUnauthorized = () => setNeeded(true);
    window.addEventListener("ghgflix:unauthorized", onUnauthorized);
    return () => window.removeEventListener("ghgflix:unauthorized", onUnauthorized);
  }, []);

  if (needed === null) return null;
  if (!needed) return <>{children}</>;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok || !body.token) throw new Error(String(body.error ?? "Falsches Passwort"));
      setWebToken(body.token);
      window.location.reload();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-screen flex flex-col items-center justify-center gap-6 bg-ghg-bg">
      <Wordmark size="lg" />
      <div className="w-80 bg-ghg-surface border border-ghg-line rounded-2xl p-6 space-y-3">
        <p className="font-bold">Server-Passwort</p>
        <input
          type="password"
          value={pw}
          autoFocus
          onChange={(e) => setPw(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          className="w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-ghg-red"
          placeholder="Passwort"
        />
        {err && <p className="text-xs text-ghg-red">{err}</p>}
        <button
          onClick={() => void submit()}
          disabled={busy}
          className="w-full py-2 rounded-lg bg-ghg-red hover:bg-ghg-red-bright transition font-semibold text-sm disabled:opacity-50"
        >
          Anmelden
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const prefs = useUiPrefs();

  // ONE document-level horizontal-wheel handler — cannot go stale on re-renders.
  useGlobalHorizontalWheel();

  // load user preferences once, then honor the configured start page
  useEffect(() => {
    void useUiPrefs
      .getState()
      .load()
      .then(() => {
        const p = useUiPrefs.getState();
        if (p.startPage !== "home" && window.location.hash.replace(/^#/, "") === "/") {
          navigate(p.startPage === "movies" ? "/movies" : p.startPage === "shows" ? "/shows" : "/list", {
            replace: true,
          });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The native window starts hidden (tauri.conf `visible:false`) so the user never
  // sees the transparent window flash the desktop before React paints. Reveal it
  // once React has committed the first render.
  // NOTE: do NOT use requestAnimationFrame to defer this — rAF does not fire while
  // the window is hidden, which would leave the app running invisibly. A short
  // setTimeout (which does fire when hidden) gives the webview a beat to paint its
  // opaque background first. Rust also force-shows the window as a safety net.
  useEffect(() => {
    const show = () => {
      const w = getCurrentWindow();
      w.show().catch(() => {});
      w.setFocus().catch(() => {});
    };
    const t = setTimeout(show, 60);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const un = listen("library://updated", () => {
      qc.invalidateQueries();
    });
    return () => {
      un.then((f) => f());
    };
  }, [qc]);

  // preference-driven root classes: card size, animations, hover zoom, UI scale
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("cards-sm", prefs.cardSize === "sm");
    root.classList.toggle("cards-lg", prefs.cardSize === "lg");
    root.classList.toggle("no-anim", !prefs.animations);
    root.classList.toggle("no-zoom", !prefs.hoverZoom);
    root.style.fontSize = prefs.fontScale && prefs.fontScale !== 100 ? `${Math.min(130, Math.max(80, prefs.fontScale))}%` : "";
  }, [prefs.cardSize, prefs.animations, prefs.hoverZoom, prefs.fontScale]);

  // custom accent color persists across restarts
  useEffect(() => {
    loadAccent();
  }, []);

  // background sync with a GHGFlix server (ZimaOS box), if configured.
  // In the web app WE ARE that server — syncing with ourselves is pointless.
  useEffect(() => {
    if (IS_WEB) return;
    void loadServerConfig().then((cfg) => {
      if (cfg.enabled) startServerSync();
    });
  }, []);

  const defaultMenu = (e: React.MouseEvent) =>
    openCtx(e, [
      { label: "Start", onClick: () => navigate("/") },
      { label: "Filme", onClick: () => navigate("/movies") },
      { label: "Serien", onClick: () => navigate("/shows") },
      { separator: true, label: "", onClick: () => {} },
      { label: "Bibliothek aktualisieren", onClick: () => qc.invalidateQueries() },
      { label: "Neu scannen", onClick: () => void scanLibraries().catch(() => {}) },
      { label: "Einstellungen", onClick: () => navigate("/settings") },
    ]);

  // key the layout content on pathname only when page transitions are on
  const pageKey = prefs.pageTransition && prefs.animations ? location.pathname : "static";

  return (
    <WebAuthGate>
    <div className="h-screen" onContextMenu={defaultMenu} data-pagekey={pageKey}>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/movies" element={<Movies />} />
          <Route path="/shows" element={<Shows />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/movie/:id" element={<MovieDetail />} />
          <Route path="/show/:id" element={<ShowDetail />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/play/:type/:id" element={<Player />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profiles" element={<Profiles />} />
      </Routes>
      <MiniPlayer />
      <ContextMenu />
    </div>
    </WebAuthGate>
  );
}

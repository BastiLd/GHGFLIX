import { useQueryClient } from "@tanstack/react-query";
import { getCurrentWindow, listen } from "./lib/backend";
import { IS_WEB } from "./lib/platform";
import { AccountGate } from "./components/AccountGate";
import { useAccount } from "./lib/accounts";
import { ServerConnection } from "./components/ServerConnection";
import { UpdateNotice } from "./components/AppUpdates";
import { useEffect } from "react";

import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Fehlerfang } from "./components/Fehlerfang";
import { ContextMenu } from "./components/ContextMenu";
import { Layout } from "./components/Layout";
import { MiniPlayer } from "./components/MiniPlayer";
import { openCtx } from "./lib/contextmenu";
import { scanLibraries } from "./lib/api";
import { loadAccent, useUiPrefs } from "./lib/uiPrefs";
import { loadServerConfig } from "./lib/serverSync";
import { useGlobalHorizontalWheel } from "./lib/useHorizontalWheel";
import Feeds from "./pages/Feeds";
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
import More from "./pages/More";
import ShowDetail from "./pages/ShowDetail";
import Shows from "./pages/Shows";

export default function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const prefs = useUiPrefs();
  const accountsEnabled = useAccount(s => s.enabled);
  const accountSession = useAccount(s => s.session);
  useEffect(() => {
    const refresh=()=>{void qc.invalidateQueries({queryKey:['progress']});void qc.invalidateQueries({queryKey:['favorites']});};
    window.addEventListener('ghgflix:sync',refresh);
    return()=>window.removeEventListener('ghgflix:sync',refresh);
  },[qc]);

  // Der Vollbildzustand gehoert nur dem Player. Auch automatische Rueckkehr,
  // Browser-Zurueck und veraltete Player-Callbacks muessen ihn verlassen.
  useEffect(() => {
    if (!location.pathname.startsWith("/play/")) void getCurrentWindow().setFullscreen(false).catch(() => {});
  }, [location.pathname]);

  // ONE document-level horizontal-wheel handler — cannot go stale on re-renders.
  useGlobalHorizontalWheel();

  // load user preferences once, then honor the configured start page
  useEffect(() => {
    const load=async()=>{
    if(IS_WEB || (await loadServerConfig()).enabled)return;
    await useUiPrefs
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
    };
    void load();
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
    // Subscribe after profile selection, and rebind when desktop switches from
    // its local backend to a server. Account setup needs no library polling.
    if (accountsEnabled && !accountSession?.profile) return;
    const un = listen("library://updated", () => {
      qc.invalidateQueries();
    });
    return () => {
      un.then((f) => f());
    };
  }, [qc, accountsEnabled, accountSession?.account.id, accountSession?.profile?.id]);

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
      if (cfg.enabled) { /* AccountGate uses the authenticated server directly. */ }
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
    <AccountGate>
    <div className="h-screen" onContextMenu={defaultMenu} data-pagekey={pageKey}>
      <UpdateNotice />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/movies" element={<Movies />} />
          <Route path="/shows" element={<Shows />} />
          <Route path="/list" element={<MyList />} />
          {/* Fehlerfang: eine klemmende Detailseite darf nicht die ganze
              Oberflaeche schwarz machen (siehe components/Fehlerfang.tsx). */}
          <Route path="/movie/:id" element={<Fehlerfang schluessel={location.pathname}><MovieDetail /></Fehlerfang>} />
          <Route path="/show/:id" element={<Fehlerfang schluessel={location.pathname}><ShowDetail /></Fehlerfang>} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/more" element={<More />} />
          {/* Punkt 5: abonnierte YouTube-Kanäle plus Leaks/Blog */}
          <Route path="/kanaele" element={<Feeds />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="/play/:type/:id" element={<Player />} />
        <Route path="/login" element={<Login />} />
        <Route path="/profiles" element={<Profiles />} />
        {!IS_WEB&&<Route path="/connect" element={<div className="h-dvh overflow-y-auto p-5"><div className="w-full max-w-lg mx-auto py-6 space-y-4"><button onClick={()=>navigate('/profiles')}>Zurück zu Account & Profile</button><ServerConnection/></div></div>}/>}
      </Routes>
      <MiniPlayer />
      <ContextMenu />
    </div>
    </AccountGate>
  );
}

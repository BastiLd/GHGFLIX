import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ContextMenu } from "./components/ContextMenu";
import { Layout } from "./components/Layout";
import { openCtx } from "./lib/contextmenu";
import { scanLibraries } from "./lib/api";
import { useUiPrefs } from "./lib/uiPrefs";
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

  // preference-driven root classes: card size, animations, hover zoom
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("cards-sm", prefs.cardSize === "sm");
    root.classList.toggle("cards-lg", prefs.cardSize === "lg");
    root.classList.toggle("no-anim", !prefs.animations);
    root.classList.toggle("no-zoom", !prefs.hoverZoom);
  }, [prefs.cardSize, prefs.animations, prefs.hoverZoom]);

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
      <ContextMenu />
    </div>
  );
}

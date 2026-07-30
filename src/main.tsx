import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { autoStartSync } from "./lib/supabase";
import { initTheme } from "./lib/themes";
import { initTvMode } from "./lib/tvMode";
import { useStore } from "./lib/store";

initTheme();
initTvMode(); // TV-044: Fernbedienungs-Modus für Smart-TV-Browser

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 },
  },
});

// Cloud-Abgleich beim App-Start hochfahren — jetzt für JEDES Profil, auch für
// „Lokal“. Vorher lief er nur für ausdrücklich gewählte Cloud-Profile, weshalb
// beim normalen Benutzen NIE etwas in Supabase ankam.
{
  const { profileId, profileName } = useStore.getState();
  void autoStartSync(profileId || "local", profileName || "Lokal");
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

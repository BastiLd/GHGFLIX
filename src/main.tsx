import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { initSupabase, startSupabaseSync } from "./lib/supabase";
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

// S-006/S-014: resume the cloud-profile sync loop on app start (it also runs an
// immediate pull-on-focus tick), so progress from other devices arrives after a
// restart without re-picking the profile.
void initSupabase().then((client) => {
  const { profileId } = useStore.getState();
  if (client && profileId && profileId !== "local") startSupabaseSync(profileId);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

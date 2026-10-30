import React from "react";
import { createRoot } from "react-dom/client";
globalThis.__GHG_DEVICE__ = new URLSearchParams(location.search).get("device") === "mobile" ? "mobile" : "tv";
const { installFixtures, image } = await import("./fixtures.js");
const live = new URLSearchParams(location.search).get("live") === "1";
if (!live) installFixtures();
const storage = (await import("./storage.js")).default;
if (new URLSearchParams(location.search).get("setup") !== "1") {
  await storage.setItem("ghgflix.conn", JSON.stringify({ manualUrl: location.origin, list: [], token: "", profile: 1 }));
}
// Bilder werden aus lokalen SVG-Testmotiven erzeugt; kein API-Schlüssel erforderlich.
if (!live) globalThis.__GHG_PREVIEW_IMAGE__ = image;
const { default: App } = await import("../../mobile/App.js");
createRoot(document.getElementById("root")).render(<App />);

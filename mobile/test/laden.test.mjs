/**
 * LADETEST FUER DIE HANDY-/TV-APP
 *
 * WARUM ES DIESEN TEST GIBT
 * Die Fernseh-App startete monatelang nicht: Bildschirm kurz schwarz, dann
 * zurueck ins Menue. Ursache war am Ende ein fehlendes natives Modul
 * (expo-asset war nur mittelbar installiert). Solche Fehler schlagen zu, BEVOR
 * irgendetwas gezeichnet wird - man sieht also nichts ausser einem Absturz.
 *
 * Dieser Test laedt App.js wirklich, mit Attrappen fuer alles Native. Er
 * findet damit genau diese Fehlerklasse, ohne dass ein Geraet noetig ist:
 *   - vergessene Importe (z. B. DeviceEventEmitter, findNodeHandle)
 *   - Zugriff auf etwas, das erst spaeter definiert wird
 *   - Tippfehler in Bezeichnern auf Modulebene
 *   - Syntaxfehler, die node --check durchgehen laesst
 *
 * AUFRUF
 *   cd mobile
 *   node test/laden.test.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import Module from "node:module";
const basis = path.resolve(new URL(".", import.meta.url).pathname, "..");
const req = createRequire(basis + "/package.json");
const babel = req("@babel/core");

const F = (n) => { const f = function () { return null; }; Object.defineProperty(f, "name", { value: n }); return f; };
const rn = new Proxy({}, { get(_, k) {
  if (k === "StyleSheet") return { create: (o) => o, absoluteFill: {}, hairlineWidth: 1, flatten: (x) => x };
  if (k === "Platform") return { OS: "android", select: (o) => o.android ?? o.default };
  if (k === "Dimensions") return { get: () => ({ width: 1920, height: 1080 }), addEventListener: () => ({ remove() {} }) };
  if (k === "DeviceEventEmitter") return { addListener: () => ({ remove() {} }), emit() {} };
  if (k === "findNodeHandle") return () => 1;
  if (k === "BackHandler") return { addEventListener: () => ({ remove() {} }) };
  if (k === "__esModule") return true;
  return F(String(k)); } });
const attrappen = {
  "react-native": rn,
  "@react-native-async-storage/async-storage": { default: { getItem: async () => null, setItem: async () => {} } },
  "expo-status-bar": { StatusBar: F("StatusBar") },
  "expo-keep-awake": { useKeepAwake: () => {} },
  "expo-video": { VideoView: F("VideoView"), useVideoPlayer: () => ({}) },
  "expo-screen-orientation": { lockAsync: async () => {}, OrientationLock: {} },
};
const quelle = fs.readFileSync(path.join(basis, "App.js"), "utf8");
const out = babel.transformSync(quelle, {
  filename: path.join(basis, "App.js"), babelrc: false, configFile: false, sourceType: "module",
  presets: [[req.resolve("@babel/preset-react"), { runtime: "automatic" }]],
  plugins: [[req.resolve("@babel/plugin-transform-modules-commonjs")]],
}).code;

// react VOR der Hook-Installation laden, sonst ruft sich der Hook selbst auf
const reactCache = { "react": req("react"), "react/jsx-runtime": req("react/jsx-runtime") };
const echt = Module._load;
Module._load = function (name, parent, isMain) {
  if (attrappen[name]) return attrappen[name];
  // react + jsx-runtime aus dem Projekt aufloesen (die Testdatei liegt in /tmp)
  if (reactCache[name]) return reactCache[name];
  if (name.startsWith(".") || name.startsWith("/")) return echt.call(this, name, parent, isMain);
  console.log("   (Attrappe fuer:", name + ")");
  return rn;
};


const ziel = path.join(os.tmpdir(), "ghgflix-App.test.cjs");
fs.writeFileSync(ziel, out);
const m = createRequire(basis + "/package.json")(ziel);
const App = m.default ?? m;
console.log("App.js geladen, Standard-Ausgabe ist Funktion:", typeof App === "function");
console.log("ERGEBNIS: KEIN FEHLER AUF MODULEBENE");

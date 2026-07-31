/**
 * LADETEST FÜR DIE HANDY-/TV-APP
 *
 * WARUM ES DIESEN TEST GIBT
 * Die Fernseh-App startete monatelang nicht: Bildschirm kurz schwarz, dann
 * zurück ins Menü. Ursache war am Ende ein fehlendes natives Modul
 * (expo-asset war nur mittelbar installiert). Solche Fehler schlagen zu,
 * BEVOR irgendetwas gezeichnet wird — man sieht also nichts außer einem
 * Absturz.
 *
 * Dieser Test übersetzt alle Quelldateien mit Babel und lädt sie wirklich,
 * mit Attrappen für alles Native. Er findet damit genau diese Fehlerklasse,
 * ohne dass ein Gerät nötig ist:
 *   - vergessene Importe (z. B. DeviceEventEmitter, findNodeHandle)
 *   - Tippfehler in Bezeichnern und in JSX
 *   - Zugriff auf etwas, das erst später definiert wird
 *   - falsche oder fehlende Exporte zwischen den Modulen
 *
 * ACHTUNG, FALLE: `node --check` reicht dafür NICHT. Bei Dateien mit
 * import/export prüft Node sie als ES-Modul und meldet JSX-Fehler nicht —
 * eine Datei voller kaputtem JSX kommt dort als „in Ordnung" durch. Nur das
 * echte Übersetzen und Laden gibt Sicherheit.
 *
 * AUFRUF
 *   cd mobile
 *   node test/laden.test.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module from "node:module";

const basis = path.resolve(new URL(".", import.meta.url).pathname, "..");
const req = createRequire(path.join(basis, "package.json"));
const babel = req("@babel/core");

let gut = 0;
const fehler = [];
function pruefe(was, bedingung) {
  if (bedingung) { gut++; console.log("  ✓ " + was); }
  else { fehler.push(was); console.log("  ✗ " + was); }
}

/* ── Attrappen für alles Native ──────────────────────────────────────── */
const F = (n) => {
  const f = function () { return null; };
  Object.defineProperty(f, "name", { value: n });
  return f;
};
const rn = new Proxy({}, {
  get(_, k) {
    if (k === "StyleSheet") return { create: (o) => o, absoluteFill: {}, hairlineWidth: 1, flatten: (x) => x };
    if (k === "Platform") return { OS: "android", select: (o) => o.android ?? o.default };
    if (k === "Dimensions") return { get: () => ({ width: 1920, height: 1080 }), addEventListener: () => ({ remove() {} }) };
    if (k === "DeviceEventEmitter") return { addListener: () => ({ remove() {} }), emit() {} };
    if (k === "findNodeHandle") return () => 1;
    if (k === "BackHandler") return { addEventListener: () => ({ remove() {} }) };
    if (k === "Appearance") return { getColorScheme: () => "dark" };
    if (k === "__esModule") return true;
    return F(String(k));
  },
});
const attrappen = {
  "react-native": rn,
  "@react-native-async-storage/async-storage": {
    default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  },
  "expo-status-bar": { StatusBar: F("StatusBar") },
  "expo-keep-awake": { useKeepAwake: () => {} },
  "expo-video": { VideoView: F("VideoView"), useVideoPlayer: () => ({}) },
  "expo-screen-orientation": { lockAsync: async () => {}, OrientationLock: {} },
};

/* ── Babel-Hook: eigene Quelldateien beim Laden übersetzen ───────────── */
const echt = Module._load;
const reactCache = { react: req("react"), "react/jsx-runtime": req("react/jsx-runtime") };
const uebersetzt = new Map();
/** Temp-Datei -> ursprünglicher Ort im Projekt (für relative Importe). */
const herkunft = new Map();

function uebersetze(datei) {
  if (uebersetzt.has(datei)) return uebersetzt.get(datei);
  const quelle = fs.readFileSync(datei, "utf8");
  /* Babel lädt beim Übersetzen selbst Module nach ("path", "gensync", …).
     Läuft dabei der eigene Lade-Hook, bekommt Babel Attrappen statt der
     echten Module und bricht ab. Deshalb wird der Hook für die Dauer des
     Übersetzens abgeschaltet. */
  const hook = Module._load;
  Module._load = echt;
  let out;
  try {
    out = babel.transformSync(quelle, {
      filename: datei, babelrc: false, configFile: false, sourceType: "module",
      presets: [[req.resolve("@babel/preset-react"), { runtime: "automatic" }]],
      plugins: [[req.resolve("@babel/plugin-transform-modules-commonjs")]],
    }).code;
  } finally {
    Module._load = hook;
  }
  const ziel = path.join(os.tmpdir(), "ghgflix-" + path.basename(datei) + ".cjs");
  fs.writeFileSync(ziel, out);
  uebersetzt.set(datei, ziel);
  herkunft.set(ziel, datei);
  return ziel;
}

Module._load = function (name, parent, isMain) {
  if (attrappen[name]) return attrappen[name];
  if (reactCache[name]) return reactCache[name];
  // Eigene Dateien: erst übersetzen, dann laden
  if (name.startsWith(".") || name.startsWith("/")) {
    /* Die übersetzte Fassung liegt im Temp-Ordner, ihre relativen Importe
       ("./fokus-kern.js") beziehen sich aber auf den ursprünglichen Ort im
       Projekt. Deshalb wird für die Auflösung immer das ORIGINAL als
       Ausgangspunkt genommen, nicht die Datei im Temp-Ordner. */
    const elternOriginal = herkunft.get(parent?.filename) || parent?.filename;
    const roh = name.startsWith(".")
      ? path.resolve(path.dirname(elternOriginal || basis), name)
      : name;
    const kandidaten = [roh, roh + ".js", path.join(roh, "index.js")];
    const treffer = kandidaten.find((k) => {
      try { return fs.statSync(k).isFile(); } catch { return false; }
    });
    if (treffer && !treffer.includes("node_modules") && !treffer.endsWith(".cjs")) {
      return echt.call(this, uebersetze(treffer), parent, isMain);
    }
    return echt.call(this, name, parent, isMain);
  }
  console.log("   (Attrappe ergänzt für: " + name + ")");
  return rn;
};

/* ── Test ────────────────────────────────────────────────────────────── */
console.log("\n── Alle Quelldateien übersetzen und laden ──────────────────");

const dateien = [
  "src/fokus-kern.js", "src/stile.js", "src/fokus.js", "src/bausteine.js",
  "src/netzsuche.js", "src/seitenleiste.js", "src/seiten.js",
  "src/player.js", "src/verbindung.js", "App.js",
];

for (const d of dateien) {
  const voll = path.join(basis, d);
  try {
    const m = req(uebersetze(voll));
    const namen = Object.keys(m).filter((k) => k !== "__esModule");
    pruefe(`${d.padEnd(22)} lädt  (${namen.length} Export${namen.length === 1 ? "" : "e"})`, true);
  } catch (e) {
    pruefe(`${d.padEnd(22)} lädt  → ${String(e?.message || e).split("\n")[0]}`, false);
  }
}

console.log("\n── Erwartete Exporte vorhanden ─────────────────────────────");
{
  const p = (d) => req(uebersetze(path.join(basis, d)));
  const soll = {
    "src/fokus-kern.js": ["erzeugeFokusKern"],
    "src/fokus.js": ["FokusProvider", "FKnopf", "FokusReihe", "useFokusElement", "useFernbedienung", "useDialog", "useFokusSystem"],
    "src/stile.js": ["C", "M", "st", "gross"],
    "src/bausteine.js": ["PosterReihe", "BreitReihe", "Hero", "Knopf", "FFeld", "Dialog", "DialogListe", "Laden", "fmtZeit", "se", "parseGenres", "BackdropKopf"],
    "src/netzsuche.js": ["ping", "sucheServer", "sucheImNetz", "normUrl"],
    "src/seitenleiste.js": ["Seitenleiste", "NAV"],
    "src/seiten.js": ["StartSeite", "RasterSeite", "SuchSeite", "SerienSeite", "FilmSeite", "ProfilSeite", "EinstellungenSeite"],
    "src/player.js": ["PlayerScreen"],
    "src/verbindung.js": ["VerbindungsScreen"],
  };
  for (const [datei, namen] of Object.entries(soll)) {
    const m = p(datei);
    const fehlend = namen.filter((n) => m[n] === undefined);
    pruefe(
      `${datei.padEnd(22)} ${fehlend.length ? "FEHLT: " + fehlend.join(", ") : namen.length + " Exporte vollständig"}`,
      fehlend.length === 0,
    );
  }
}

console.log("\n── App liefert eine Komponente ─────────────────────────────");
{
  const m = req(uebersetze(path.join(basis, "App.js")));
  const App = m.default ?? m;
  pruefe("Standard-Ausgabe von App.js ist eine Funktion", typeof App === "function");
}

console.log("\n────────────────────────────────────────────────────────────");
Module._load = echt;
if (fehler.length) {
  console.log(`\nFEHLGESCHLAGEN: ${fehler.length} von ${gut + fehler.length}`);
  for (const f of fehler) console.log("   - " + f);
  process.exit(1);
}
console.log(`\nAlle ${gut} Ladetests bestanden — kein Fehler auf Modulebene.`);

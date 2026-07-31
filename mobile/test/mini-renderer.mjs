/**
 * MINI-RENDERER FÜR TESTS
 *
 * react-test-renderer lässt sich in dieser Umgebung nicht nachinstallieren
 * (die Paketquelle ist gesperrt). Für den Zweck hier reicht aber ein sehr
 * kleiner eigener Renderer: Er ruft die Funktionskomponenten auf, bedient
 * die Hooks, die diese App benutzt, und läuft durch den Elementbaum.
 *
 * Damit lässt sich das prüfen, worauf es wirklich ankommt:
 *   - Rendert der Startbildschirm ohne Ausnahme durch?
 *   - Melden sich alle Kacheln und Knöpfe beim Fokus-System an?
 *   - Führt das Steuerkreuz danach sinnvoll durch die Oberfläche?
 *
 * Was er NICHT kann: Layout, Bilder, Animationen, echtes Neuzeichnen. Das
 * ist in Ordnung — dafür gibt es das Gerät. Hier geht es um Logik.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import Module from "node:module";

export function baueUmgebung(basis) {
  const req = createRequire(path.join(basis, "package.json"));
  const babel = req("@babel/core");
  const React = req("react");

  /* ── Hooks ─────────────────────────────────────────────────────────── */
  let aktuell = null;          // { zustand: [], index: 0, neuZeichnen }
  const effekte = [];          // nach dem Durchlauf auszuführen
  const kontextWerte = new Map();

  const hooks = {
    useState(anfang) {
      // WICHTIG: die Instanz hier festhalten, nicht `aktuell` in der Closure
      // lesen. Der Setzer wird oft später aufgerufen (aus einem Effekt oder
      // aus einem Ereignis) — dann läuft gerade kein Durchlauf und `aktuell`
      // ist null.
      const inst = aktuell;
      const i = inst.index++;
      const s = inst.zustand;
      if (!(i in s)) s[i] = typeof anfang === "function" ? anfang() : anfang;
      const setzen = (v) => {
        const neu = typeof v === "function" ? v(s[i]) : v;
        if (Object.is(neu, s[i])) return;
        s[i] = neu;
        inst.neuZeichnen?.();
      };
      return [s[i], setzen];
    },
    useRef(anfang) {
      const inst = aktuell;
      const i = inst.index++;
      const s = inst.zustand;
      if (!(i in s)) s[i] = { current: anfang };
      return s[i];
    },
    useMemo(fn, deps) {
      const inst = aktuell;
      const i = inst.index++;
      const s = inst.zustand;
      const alt = s[i];
      if (!alt || !gleich(alt.deps, deps)) s[i] = { wert: fn(), deps };
      return s[i].wert;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const inst = aktuell;
      const i = inst.index++;
      const s = inst.zustand;
      const alt = s[i];
      if (!alt || !gleich(alt.deps, deps)) {
        effekte.push(() => {
          try { alt?.aufraeumen?.(); } catch {}
          let aufraeumen;
          try { aufraeumen = fn(); } catch (e) { fehlerSammler.push(e); }
          s[i] = { deps, aufraeumen: typeof aufraeumen === "function" ? aufraeumen : null };
        });
      }
    },
    useLayoutEffect(fn, deps) { return hooks.useEffect(fn, deps); },
    useContext(ctx) {
      return kontextWerte.has(ctx) ? kontextWerte.get(ctx) : ctx._standard;
    },
    useReducer(red, anfang) {
      const [w, setzen] = hooks.useState(anfang);
      return [w, (a) => setzen((alt) => red(alt, a))];
    },
  };
  const fehlerSammler = [];
  const gleich = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));

  /* ── React-Attrappe ────────────────────────────────────────────────── */
  const erzeugtesElement = (type, props, key) => ({ $$typeof: Symbol.for("react.element"), type, props, key });

  /** Kontext-Attrappe: der Provider merkt sich den Wert, useContext liest ihn. */
  function createContextAttrappe(standard) {
    const ctx = { _standard: standard };
    ctx.Provider = function Provider({ value, children }) {
      kontextWerte.set(ctx, value);
      return children;
    };
    ctx.Consumer = function Consumer({ children }) { return children(kontextWerte.get(ctx)); };
    return ctx;
  }

  /* ACHTUNG, HART ERKAUFTE ERKENNTNIS: Hier stand einmal ein Proxy um React.
     Der sah richtig aus, wirkte aber nicht.
     Babel übersetzt `import React, { createContext } from "react"` zu
     `_interopRequireWildcard(require("react"))`. Diese Hilfsfunktion KOPIERT
     die Eigenschaften des Moduls in ein frisches Objekt — die Attrappen aus
     dem Proxy gingen dabei verloren und fokus.js bekam den ECHTEN
     React-Kontext. Der echte useContext lieferte dann brav den Standardwert
     (null), der FokusProvider setzte nie etwas, und der Test meldete
     „Fokus-Kern nicht erreichbar" — obwohl an der App selbst nichts fehlte.
     Ein Test, der aus dem falschen Grund fehlschlägt, ist schlimmer als gar
     keiner: Man sucht den Fehler dort, wo keiner ist.

     Deshalb jetzt ein ganz gewöhnliches Objekt. `__esModule: true` sorgt
     zusätzlich dafür, dass _interopRequireWildcard es unverändert
     zurückgibt, statt es zu kopieren. */
  const ReactAttrappe = {};
  for (const k of Object.getOwnPropertyNames(React)) {
    try { ReactAttrappe[k] = React[k]; } catch { /* nicht lesbar — überspringen */ }
  }
  Object.assign(ReactAttrappe, hooks, {
    createContext: createContextAttrappe,
    __esModule: true,
  });
  ReactAttrappe.default = ReactAttrappe;

  /* ── Native Attrappen: geben ihre Kinder weiter ────────────────────── */
  const durchreicher = (name) => {
    const K = function (props) { return props?.children ?? null; };
    Object.defineProperty(K, "name", { value: name });
    K._attrappe = name;
    return K;
  };

  const FlatListAttrappe = function FlatList(props) {
    const { data = [], renderItem } = props;
    if (!renderItem) return props.children ?? null;
    return data.map((item, index) => renderItem({ item, index }));
  };

  const rn = new Proxy({}, {
    get(_, k) {
      if (k === "StyleSheet") return { create: (o) => o, absoluteFill: {}, hairlineWidth: 1, flatten: (x) => x };
      if (k === "Platform") return { OS: "android", select: (o) => o.android ?? o.default };
      if (k === "Dimensions") return { get: () => ({ width: 1920, height: 1080 }), addEventListener: () => ({ remove() {} }) };
      if (k === "DeviceEventEmitter") return tastenBus;
      if (k === "findNodeHandle") return () => Math.floor(Math.random() * 1e6);
      if (k === "BackHandler") return { addEventListener: () => ({ remove() {} }) };
      if (k === "FlatList") return FlatListAttrappe;
      if (k === "__esModule") return true;
      return durchreicher(String(k));
    },
  });

  /* ── Ereignisbus für onHWKeyEvent ──────────────────────────────────── */
  const hoerer = new Set();
  const tastenBus = {
    addListener(name, fn) {
      if (name === "onHWKeyEvent") hoerer.add(fn);
      return { remove: () => hoerer.delete(fn) };
    },
    emit(name, e) { if (name === "onHWKeyEvent") [...hoerer].forEach((f) => f(e)); },
  };
  /** Eine Taste drücken UND loslassen, wie die echte Fernbedienung. */
  function taste(art) {
    tastenBus.emit("onHWKeyEvent", { eventType: art, eventKeyAction: 0 });
    tastenBus.emit("onHWKeyEvent", { eventType: art, eventKeyAction: 1 });
    lauf();
  }

  /* ── Modul-Laden mit Babel ─────────────────────────────────────────── */
  const attrappen = {
    "react-native": rn,
    react: ReactAttrappe,
    "react/jsx-runtime": {
      jsx: erzeugtesElement,
      jsxs: erzeugtesElement,
      Fragment: durchreicher("Fragment"),
    },
    "@react-native-async-storage/async-storage": {
      default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
    },
    "expo-status-bar": { StatusBar: durchreicher("StatusBar") },
    "expo-keep-awake": { useKeepAwake: () => {} },
    "expo-video": { VideoView: durchreicher("VideoView"), useVideoPlayer: () => ({ addListener: () => ({ remove() {} }) }) },
  };

  const echt = Module._load;
  const cache = new Map();
  const herkunft = new Map();
  function uebersetze(datei) {
    if (cache.has(datei)) return cache.get(datei);
    const hook = Module._load;
    Module._load = echt;
    let out;
    try {
      out = babel.transformSync(fs.readFileSync(datei, "utf8"), {
        filename: datei, babelrc: false, configFile: false, sourceType: "module",
        presets: [[req.resolve("@babel/preset-react"), { runtime: "automatic" }]],
        plugins: [[req.resolve("@babel/plugin-transform-modules-commonjs")]],
      }).code;
    } finally { Module._load = hook; }
    const ziel = path.join(os.tmpdir(), "ghgflix-r-" + path.basename(datei) + ".cjs");
    fs.writeFileSync(ziel, out);
    cache.set(datei, ziel);
    herkunft.set(ziel, datei);
    return ziel;
  }

  Module._load = function (name, parent, isMain) {
    if (attrappen[name]) return attrappen[name];
    /* path.isAbsolute statt name.startsWith("/"): Unter Windows sind absolute
       Pfade "C:\..." und beginnen NICHT mit einem Schrägstrich. Ohne diese
       Änderung fiel jede übersetzte Datei in den Zweig ganz unten und bekam
       statt des echten Moduls die react-native-Attrappe zurück. Die liefert
       zu JEDEM Namen eine Funktion — dadurch bestand jede Prüfung scheinbar,
       und `useFokusSystem()` gab immer null zurück. Der Test prüfte also in
       Wahrheit gar nichts mehr. */
    if (name.startsWith(".") || path.isAbsolute(name)) {
      const elt = herkunft.get(parent?.filename) || parent?.filename;
      const roh = name.startsWith(".") ? path.resolve(path.dirname(elt || basis), name) : name;
      const kand = [roh, roh + ".js"];
      const treffer = kand.find((k) => { try { return fs.statSync(k).isFile(); } catch { return false; } });
      if (treffer && !treffer.includes("node_modules") && !treffer.endsWith(".cjs")) {
        return echt.call(this, uebersetze(treffer), parent, isMain);
      }
      return echt.call(this, name, parent, isMain);
    }
    return rn;
  };

  const lade = (rel) => req(uebersetze(path.join(basis, rel)));

  /* ── Der Renderer ──────────────────────────────────────────────────── */
  const instanzen = new Map();   // Pfad im Baum -> Zustand
  let wurzelElement = null;
  let laeuft = false;
  let nochmal = false;

  function zeichne(element, pfad) {
    if (element == null || element === false || element === true) return;
    if (Array.isArray(element)) {
      element.forEach((e, i) => zeichne(e, pfad + "/" + i));
      return;
    }
    if (typeof element !== "object") return;   // Text und Zahlen
    const { type, props, key } = element;
    const eigenerPfad = pfad + "/" + (key ?? "") + (typeof type === "function" ? type.name : String(type));

    if (typeof type === "function" && !type._attrappe) {
      // Klassenkomponente (der Absturzfang)
      if (type.prototype?.isReactComponent || type.prototype?.render) {
        const inst = new type(props);
        zeichne(inst.render(), eigenerPfad);
        return;
      }
      if (!instanzen.has(eigenerPfad)) instanzen.set(eigenerPfad, { zustand: [], index: 0 });
      const inst = instanzen.get(eigenerPfad);
      const vorher = aktuell;
      aktuell = inst;
      inst.index = 0;
      inst.neuZeichnen = () => { nochmal = true; };
      let ergebnis;
      try {
        ergebnis = type(props);
      } catch (e) {
        aktuell = vorher;
        throw Object.assign(e, { komponente: type.name });
      }
      aktuell = vorher;
      zeichne(ergebnis, eigenerPfad);
      return;
    }

    // Attrappe oder String-Element: Kinder weiterverfolgen
    let kinder = props?.children;
    if (typeof type === "function" && type._attrappe) {
      const vorher = aktuell;
      aktuell = instanzen.get(eigenerPfad) || { zustand: [], index: 0 };
      try { kinder = type(props); } catch { kinder = props?.children; }
      aktuell = vorher;
    }
    if (typeof kinder === "function") return;   // Render-Prop ohne Aufruf
    zeichne(kinder, eigenerPfad);
  }

  /** Einen vollständigen Durchlauf machen, inklusive Effekten.
   *  Die Rundenzahl ist begrenzt: React selbst bricht bei „Maximum update
   *  depth exceeded" ab, hier soll ein Test nicht endlos laufen. */
  let rundenGesamt = 0;
  function lauf(max = 6) {
    laeuft = true;
    for (let runde = 0; runde < max; runde++) {
      rundenGesamt++;
      nochmal = false;
      effekte.length = 0;
      zeichne(wurzelElement, "");
      const zuTun = [...effekte];
      effekte.length = 0;
      zuTun.forEach((fn) => fn());
      if (!nochmal) break;
    }
    laeuft = false;
  }

  function render(element) {
    wurzelElement = element;
    instanzen.clear();
    lauf();
  }

  return {
    React: ReactAttrappe, lade, render, lauf, taste, tastenBus,
    fehler: fehlerSammler,
    runden: () => rundenGesamt,
    erzeuge: (type, props, ...kinder) =>
      erzeugtesElement(type, { ...props, children: kinder.length <= 1 ? kinder[0] : kinder }),
    aufraeumen: () => { Module._load = echt; },
  };
}

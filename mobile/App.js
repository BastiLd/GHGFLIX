// GHGFlix mobile (Expo Go) — native client for the GHGFlix server.
// Connection manager with Lokal/Domain/Tailscale addresses and automatic
// switching, profile picker, library, season-aware show pages and a native
// video player (expo-video) with progress sync.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Zusatzmodule vorsichtig laden ───────────────────────────────────────────
//
// WARUM NICHT EINFACH `import`:
// Ein fehlgeschlagener Modul-Import beim App-Start reisst die GANZE App mit —
// auf dem Fernseher sieht man dann nur: kurz schwarz, zurueck ins Menue, ohne
// jeden Hinweis. Genau dieses Verhalten trat auf.
//
// `expo-video` und `expo-keep-awake` bringen native Bestandteile mit. Fehlt auf
// einem Geraet etwas davon (bei Android-TV-Geraeten durchaus moeglich), soll
// die App trotzdem starten und die Bibliothek anzeigen — nur das Abspielen
// meldet dann sauber "Videowiedergabe nicht verfuegbar", statt alles zu killen.
let VideoView = null;
let useVideoPlayer = null;
let videoLadeFehler = null;
try {
  const v = require("expo-video");
  VideoView = v.VideoView;
  useVideoPlayer = v.useVideoPlayer;
  if (typeof useVideoPlayer !== "function") throw new Error("expo-video unvollstaendig geladen");
} catch (e) {
  videoLadeFehler = String(e?.message || e);
  useVideoPlayer = () => null; // Platzhalter, damit der Hook-Aufruf nicht knallt
}

let useKeepAwake = () => {};
try {
  useKeepAwake = require("expo-keep-awake").useKeepAwake || useKeepAwake;
} catch {
  /* ohne Bildschirm-Wachhalten laesst sich leben */
}
import {
  ActivityIndicator,
  BackHandler,
  DeviceEventEmitter,
  FlatList,
  Image,
  findNodeHandle,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

// ── Absturz-Anzeige ─────────────────────────────────────────────────────────
//
// Am Fernseher gibt es keine Entwicklerkonsole: Stürzt die App ab, wird der
// Bildschirm schwarz und man landet wieder im Menü — ohne jeden Hinweis.
// Deshalb wird JEDER Fehler hier abgefangen und gespeichert; beim nächsten
// Start zeigt die App ihn an. So ist die Ursache auch ohne PC ablesbar.
const CRASH_KEY = "ghgflix.lastCrash";

async function saveCrash(err, wo) {
  try {
    await AsyncStorage.setItem(
      CRASH_KEY,
      JSON.stringify({
        at: Date.now(),
        wo,
        text: String(err?.message || err),
        stack: String(err?.stack || "").split("\n").slice(0, 12).join("\n"),
      }),
    );
  } catch {
    /* Speicher voll o. Ä. — dann eben nicht */
  }
}

// Fehler außerhalb von React (z. B. in einem Timer) ebenfalls festhalten
if (typeof global !== "undefined" && global.ErrorUtils) {
  const vorher = global.ErrorUtils.getGlobalHandler?.();
  global.ErrorUtils.setGlobalHandler((e, fatal) => {
    saveCrash(e, fatal ? "schwerer Fehler" : "Fehler");
    vorher?.(e, fatal);
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err) {
    return { err };
  }
  componentDidCatch(err) {
    saveCrash(err, "Oberfläche");
  }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#0b0b0f" }} contentContainerStyle={{ padding: 24 }}>
        <Text style={{ color: "#e50914", fontSize: 22, fontWeight: "800", marginBottom: 10 }}>
          GHGFlix ist auf einen Fehler gestoßen
        </Text>
        <Text style={{ color: "#f2f2f5", fontSize: 14, marginBottom: 14 }}>
          {String(this.state.err?.message || this.state.err)}
        </Text>
        <Text style={{ color: "#9a9aa5", fontSize: 11, fontFamily: "monospace" }}>
          {String(this.state.err?.stack || "").split("\n").slice(0, 12).join("\n")}
        </Text>
        <Pressable
          onPress={() => this.setState({ err: null })}
          style={{ backgroundColor: "#e50914", borderRadius: 10, padding: 14, marginTop: 20, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Nochmal versuchen</Text>
        </Pressable>
      </ScrollView>
    );
  }
}

/** Banner mit dem zuletzt gespeicherten Absturz (erscheint nach einem Neustart). */
function CrashBanner() {
  const [crash, setCrash] = useState(null);
  // Ein fehlgeschlagenes Zusatzmodul ist kein Absturz, aber wissenswert
  const modulFehler = videoLadeFehler;
  useEffect(() => {
    AsyncStorage.getItem(CRASH_KEY)
      .then((v) => v && setCrash(JSON.parse(v)))
      .catch(() => {});
  }, []);
  if (!crash && !modulFehler) return null;
  if (!crash && modulFehler) {
    return (
      <View style={{ backgroundColor: "#3b2a0d", borderBottomWidth: 1, borderBottomColor: "#c78a00", padding: 12 }}>
        <Text style={{ color: "#ffc65c", fontWeight: "700", fontSize: 13 }}>Video-Baustein nicht geladen</Text>
        <Text style={{ color: "#f2f2f5", fontSize: 12, marginTop: 4 }}>{modulFehler}</Text>
        <Text style={{ color: "#9a9aa5", fontSize: 11, marginTop: 4 }}>
          Bibliothek und Einstellungen gehen, nur das Abspielen nicht.
        </Text>
      </View>
    );
  }
  const verwerfen = () => {
    AsyncStorage.removeItem(CRASH_KEY).catch(() => {});
    setCrash(null);
  };
  return (
    <View style={{ backgroundColor: "#3b0d10", borderBottomWidth: 1, borderBottomColor: "#e50914", padding: 12 }}>
      <Text style={{ color: "#ff6b73", fontWeight: "700", fontSize: 13 }}>
        Letzter Absturz ({crash.wo}) — {new Date(crash.at).toLocaleString("de-DE")}
      </Text>
      <Text style={{ color: "#f2f2f5", fontSize: 12, marginTop: 4 }}>{crash.text}</Text>
      {!!crash.stack && (
        <Text style={{ color: "#9a9aa5", fontSize: 10, marginTop: 4, fontFamily: "monospace" }}>{crash.stack}</Text>
      )}
      <Pressable onPress={verwerfen} style={{ alignSelf: "flex-start", marginTop: 8, backgroundColor: "#ffffff22", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
        <Text style={{ color: "#f2f2f5", fontSize: 12 }}>Verstanden, ausblenden</Text>
      </Pressable>
    </View>
  );
}

const C = {
  bg: "#0b0b0f",
  bg2: "#14141a",
  surface: "#1c1c24",
  line: "#2e2e38",
  red: "#e50914",
  text: "#f2f2f5",
  muted: "#9a9aa5",
};

// ── Bedienung mit der Fernbedienung (Android TV) ─────────────────────────────
//
// Am Fernseher wird mit den Pfeiltasten von Knopf zu Knopf gesprungen. React
// Native zeigt dabei von sich aus KEINE Markierung - man sieht also nicht, wo
// man gerade steht. Genau das war am TV das Problem: "Test" und "X" liessen
// sich nicht unterscheiden.
//
// FPressable ist ein Ersatz fuer Pressable, der bei Fokus einen roten Rahmen
// zeigt. Auf dem Handy aendert sich nichts (dort gibt es kein onFocus).
/** Eingabefeld mit Fokus-Markierung (gleiche Begruendung wie FPressable). */
/* ══ TV-FOKUS ════════════════════════════════════════════════════════════════
 * DAS PROBLEM
 * Am Fernseher war nur bei Textfeldern zu sehen, was gerade ausgewaehlt ist.
 * Bei Knoepfen und Postern fehlte jede Markierung - man wusste nie, ob man
 * gerade auf "Testen" oder auf "X" steht.
 *
 * DIE URSACHE (nachgesehen, nicht geraten)
 * In React Native 0.79 loest Android das Ereignis "topFocus" AUSSCHLIESSLICH
 * im TextInput-Manager aus:
 *     ReactAndroid/.../views/textinput/ReactTextInputManager.java
 * Fuer normale Views existiert es schlicht nicht. Die Props onFocus/onBlur
 * einer <View> oder <Pressable> werden auf Android also NIE aufgerufen -
 * genau das beobachtete Verhalten.
 *
 * DIE LOESUNG
 * React Native bringt eine eingebaute Fernseh-Unterstuetzung mit, die kaum
 * bekannt ist. ReactRootView reicht Fernbedienungstasten UND Fokuswechsel als
 * geraeteweites Ereignis "onHWKeyEvent" an JavaScript weiter:
 *     ReactAndroid/.../ReactAndroidHWInputDeviceHelper.java
 * Der Inhalt:
 *     eventType : "focus" | "blur"                       <- Fokuswechsel
 *                 "select" | "up" | "down" | "left" | "right"
 *                 "playPause" | "rewind" | "fastForward"
 *                 "next" | "previous" | "info" | "menu"  <- Tasten
 *     tag       : die native View-Nummer - dieselbe Zahl, die findNodeHandle()
 *                 fuer eine Komponente liefert
 *     eventKeyAction : 0 = Taste gedrueckt, 1 = losgelassen
 *
 * Damit laesst sich der Fokus vollstaendig nachbilden: jeder Knopf meldet
 * seine View-Nummer an, und wenn das Ereignis genau diese Nummer nennt, zeigt
 * er den Rahmen. Kein Wechsel auf den Fork react-native-tvos noetig, keine
 * native Aenderung, kein Risiko fuer die Handy-Fassung.
 *
 * WICHTIG FUER SPAETER
 * Das funktioniert nur mit der bewaehrten Architektur (newArchEnabled: false
 * in app.json - dort aus einem anderen Grund bereits so gesetzt). Unter der
 * neuen Architektur (Fabric) gibt es ReactRootView nicht mehr. Beim spaeteren
 * Umstieg auf SDK 54 mit neuer Architektur muss dieser Block neu bewertet
 * werden; dann waere @react-native-tvos/config-tv der Weg.
 * ═════════════════════════════════════════════════════════════════════════ */

/** View-Nummer -> Melder der jeweiligen Komponente. */
const tvHoerer = new Map();
/** Fernbedienungstasten (ohne focus/blur) -> Abonnenten, z. B. der Player. */
const tvTasten = new Set();
let tvAktiv = null;
let tvGestartet = false;

function tvStart() {
  if (tvGestartet) return;
  tvGestartet = true;
  try {
    DeviceEventEmitter.addListener("onHWKeyEvent", (e) => {
      const art = e?.eventType;
      if (!art) return;
      if (art === "focus") {
        const alt = tvAktiv;
        tvAktiv = e.tag ?? null;
        if (alt != null && alt !== tvAktiv) tvHoerer.get(alt)?.(false);
        if (tvAktiv != null) tvHoerer.get(tvAktiv)?.(true);
        return;
      }
      if (art === "blur") {
        if (e.tag != null) tvHoerer.get(e.tag)?.(false);
        if (tvAktiv === e.tag) tvAktiv = null;
        return;
      }
      // Nur beim Loslassen auswerten, sonst feuert Halten mehrfach.
      if (e.eventKeyAction === 1 || e.eventKeyAction === -1) {
        for (const fn of tvTasten) {
          try { fn(art); } catch {}
        }
      }
    });
  } catch {
    /* Auf iOS gibt es das Ereignis nicht - dort greift onFocus regulaer. */
  }
}

/** Fernbedienungstasten abonnieren (Wiedergabe, Vor/Zurueck ...). */
function useFernbedienung(fn) {
  const halt = useRef(fn);
  halt.current = fn;
  useEffect(() => {
    tvStart();
    const weiter = (art) => halt.current?.(art);
    tvTasten.add(weiter);
    return () => { tvTasten.delete(weiter); };
  }, []);
}

function FInput({ style, ...rest }) {
  const [fokus, setFokus] = useState(false);
  return (
    <TextInput
      {...rest}
      onFocus={(e) => { setFokus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFokus(false); rest.onBlur?.(e); }}
      style={[style, fokus && st.inputFokus]}
    />
  );
}

/**
 * Knopf mit sichtbarer Fernseh-Markierung.
 * @param fokusStil  eigener Stil statt des Standardrahmens (z. B. Poster:
 *                   leicht vergroessern statt umranden)
 */
function FPressable({ style, children, fokusStil, ...rest }) {
  const [fokus, setFokus] = useState(false);
  const nummer = useRef(null);

  // Callback-Ref: meldet sich an, sobald die native View existiert, und wieder
  // ab, sobald sie verschwindet (wichtig bei langen, recycelten Listen).
  const setzeRef = useCallback((node) => {
    if (nummer.current != null) {
      tvHoerer.delete(nummer.current);
      nummer.current = null;
    }
    if (!node) return;
    tvStart();
    const tag = findNodeHandle(node);
    if (tag == null) return;
    nummer.current = tag;
    tvHoerer.set(tag, setFokus);
    if (tvAktiv === tag) setFokus(true); // schon fokussiert beim Einhaengen
  }, []);

  useEffect(() => () => {
    if (nummer.current != null) tvHoerer.delete(nummer.current);
  }, []);

  const basis = typeof style === "function" ? style({ pressed: false }) : style;
  return (
    <Pressable
      {...rest}
      ref={setzeRef}
      focusable
      onFocus={(e) => { setFokus(true); rest.onFocus?.(e); }}
      onBlur={(e) => { setFokus(false); rest.onBlur?.(e); }}
      style={[basis, fokus && (fokusStil ?? st.tvFokus)]}
    >
      {children}
    </Pressable>
  );
}

// ── connection manager ──────────────────────────────────────────────────────
const CONN_KEY = "ghgflix.conn";
const defaultConn = { mode: "auto", list: [], manualUrl: "", token: "", profile: 0 };

async function loadConn() {
  try {
    const raw = await AsyncStorage.getItem(CONN_KEY);
    return raw ? { ...defaultConn, ...JSON.parse(raw) } : { ...defaultConn };
  } catch {
    return { ...defaultConn };
  }
}
const saveConn = (c) => AsyncStorage.setItem(CONN_KEY, JSON.stringify(c));

async function ping(base, ms = 3500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    const res = await fetch(`${base.replace(/\/$/, "")}/api/ping`, { signal: ctrl.signal });
    clearTimeout(t);
    const j = await res.json();
    return j && j.app === "ghgflix-server" ? j : null;
  } catch {
    return null;
  }
}

/** Auto mode: first reachable address wins (Lokal zuerst eintragen!). */
async function resolveBase(conn) {
  const candidates = conn.mode === "manual" && conn.manualUrl ? [conn.manualUrl] : conn.list.map((e) => e.url);
  for (const url of candidates.filter(Boolean)) {
    const base = normUrl(url);
    if (await ping(base)) return base;
  }
  return null;
}

// ── tiny helpers ────────────────────────────────────────────────────────────
const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
};
const se = (s, e) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;

// MOB-034: Nutzer vergessen beim Eintippen oft das "http://" — automatisch
// ergänzen und Slash am Ende entfernen, statt still an einer kaputten URL
// zu scheitern.
const normUrl = (u) => {
  u = (u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "http://" + u;
  return u.replace(/\/$/, "");
};

function AppInner() {
  const [conn, setConn] = useState(null);
  const [base, setBase] = useState(null); // active server URL
  const [checking, setChecking] = useState(true);
  // simple stack navigation: [{name, ...params}]
  const [stack, setStack] = useState([{ name: "home" }]);
  const top = stack[stack.length - 1];
  const push = (s) => setStack((st) => [...st, s]);
  const pop = useCallback(() => setStack((st) => (st.length > 1 ? st.slice(0, -1) : st)), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stack.length > 1) {
        pop();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [stack.length, pop]);

  const reconnect = useCallback(async (c) => {
    setChecking(true);
    const b = await resolveBase(c);
    setBase(b);
    setChecking(false);
  }, []);

  useEffect(() => {
    loadConn().then((c) => {
      setConn(c);
      reconnect(c);
    });
  }, [reconnect]);

  const api = useCallback(
    async (path, opts = {}) => {
      if (!base) throw new Error("offline");
      const sep = path.includes("?") ? "&" : "?";
      let url = `${base}${path}${sep}profile=${conn?.profile || 1}`;
      if (conn?.token) url += `&token=${conn.token}`;
      const res = await fetch(url, {
        method: opts.method || "GET",
        headers: opts.body ? { "Content-Type": "application/json" } : {},
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      return res.json();
    },
    [base, conn],
  );

  const img = (path, size = "w500") =>
    path ? `${base}/api/img?path=${encodeURIComponent(path)}&size=${size}&profile=1${conn?.token ? `&token=${conn.token}` : ""}` : null;

  const updateConn = async (patch) => {
    const next = { ...conn, ...patch };
    setConn(next);
    await saveConn(next);
    return next;
  };

  if (!conn || checking) {
    return (
      <View style={[st.center, { backgroundColor: C.bg }]}>
        <Text style={st.brand}>GHGFlix</Text>
        <ActivityIndicator color={C.red} style={{ marginTop: 16 }} />
        <Text style={{ color: C.muted, marginTop: 12 }}>Suche Server …</Text>
      </View>
    );
  }
  if (!base || top.name === "connect") {
    return (
      <ConnectScreen
        conn={conn}
        onSave={async (patch) => {
          const next = await updateConn(patch);
          await reconnect(next);
          setStack([{ name: "home" }]);
        }}
      />
    );
  }
  if (!conn.profile) return <ProfileScreen api={api} onPick={(id) => updateConn({ profile: id })} />;

  const common = { api, img, push, pop, conn, base, updateConn, openSettings: () => push({ name: "connect" }) };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar style="light" />
      {top.name === "home" && <HomeScreen {...common} />}
      {top.name === "show" && <ShowScreen {...common} id={top.id} initialSeason={top.season} />}
      {top.name === "movie" && <MovieScreen {...common} id={top.id} />}
      {top.name === "play" && <PlayerScreen {...common} type={top.type} id={top.id} title={top.title} subtitle={top.subtitle} nextEp={top.nextEp} />}
    </View>
  );
}

// ── connect / settings ──────────────────────────────────────────────────────
function ConnectScreen({ conn, onSave }) {
  const [mode, setMode] = useState(conn.mode);
  const [manualUrl, setManualUrl] = useState(conn.manualUrl);
  const [list, setList] = useState(conn.list.length ? conn.list : [{ name: "Zuhause", url: "" }]);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  // MOB-008: konkrete Fehlermeldung statt pauschalem "Nicht erreichbar" —
  // Timeout, falscher Dienst und Netzwerkfehler sind unterschiedliche Probleme
  // mit unterschiedlichen Lösungen.
  const test = async (url) => {
    setMsg("Teste …");
    url = normUrl(url);
    if (!url) return setMsg("✗ Keine Adresse eingetragen");
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const res = await fetch(`${url}/api/ping`, { signal: ctrl.signal });
      clearTimeout(t);
      const j = await res.json().catch(() => null);
      if (j && j.app === "ghgflix-server") setMsg(`✓ Verbunden: ${j.name}${j.auth ? " (Passwort nötig)" : ""}`);
      else setMsg(`✗ Adresse antwortet (HTTP ${res.status}), ist aber kein GHGFlix-Server — Port 8484 vergessen?`);
    } catch (e) {
      setMsg(
        String(e && (e.name || e)).includes("Abort")
          ? "✗ Zeitüberschreitung — IP/Port prüfen. Gleiches WLAN? Tailscale an?"
          : `✗ Nicht erreichbar — ${String((e && e.message) || e)}`,
      );
    }
  };

  const save = async () => {
    const cleanList = list.map((e) => ({ ...e, url: normUrl(e.url) })).filter((e) => e.url);
    const cleanManual = normUrl(manualUrl);
    let token = conn.token;
    if (password) {
      const url = mode === "manual" ? cleanManual : cleanList[0]?.url || "";
      if (!url) return setMsg("✗ Zuerst eine Server-Adresse eintragen");
      try {
        const r = await fetch(`${url}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        }).then((x) => x.json());
        if (r.token) token = r.token;
        else return setMsg("✗ Falsches Passwort");
      } catch {
        return setMsg("✗ Server nicht erreichbar — zuerst „Test“ bei der Adresse drücken");
      }
    }
    onSave({ mode, manualUrl: cleanManual, list: cleanList, token });
  };

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 20, paddingTop: 70 }}>
      <Text style={st.brand}>GHGFlix</Text>
      <Text style={{ color: C.muted, marginTop: 4, marginBottom: 20 }}>Mit deinem Server verbinden</Text>

      <View style={st.panel}>
        <View style={st.rowBetween}>
          <Text style={st.h3}>Automatisch wechseln</Text>
          <Switch value={mode === "auto"} onValueChange={(v) => setMode(v ? "auto" : "manual")} trackColor={{ true: C.red }} />
        </View>
        <Text style={st.desc}>
          {mode === "auto"
            ? "Die erste erreichbare Adresse wird benutzt — zuhause die lokale IP, unterwegs Tailscale oder Domain."
            : "Es wird nur die eine Adresse unten benutzt."}
        </Text>

        {mode === "manual" ? (
          <FInput style={st.input} value={manualUrl} onChangeText={setManualUrl} placeholder="http://192.168.1.50:8484" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
        ) : (
          <>
            {list.map((e, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <FInput
                  style={[st.input, { flex: 0.55, marginTop: 0 }]}
                  value={e.name}
                  onChangeText={(v) => setList(list.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                  placeholder="Name"
                  placeholderTextColor={C.muted}
                />
                <FInput
                  style={[st.input, { flex: 1, marginTop: 0 }]}
                  value={e.url}
                  onChangeText={(v) => setList(list.map((x, j) => (j === i ? { ...x, url: v } : x)))}
                  placeholder="http://…"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <FPressable style={st.iconBtn} onPress={() => test(e.url)}>
                  <Text style={{ color: C.text }}>Test</Text>
                </FPressable>
                <FPressable style={st.iconBtn} onPress={() => setList(list.filter((_, j) => j !== i))}>
                  <Text style={{ color: C.muted }}>✕</Text>
                </FPressable>
              </View>
            ))}
            <FPressable onPress={() => setList([...list, { name: "", url: "" }])}>
              <Text style={{ color: C.red, marginTop: 12, fontWeight: "600" }}>+ Adresse (Lokal / Domain / Tailscale)</Text>
            </FPressable>
          </>
        )}
      </View>

      <View style={st.panel}>
        <Text style={st.h3}>Server-Passwort (falls gesetzt)</Text>
        <FInput style={st.input} value={password} onChangeText={setPassword} placeholder="••••••" placeholderTextColor={C.muted} secureTextEntry />
      </View>

      {msg ? <Text style={{ color: msg.startsWith("✓") ? "#4ade80" : C.red, marginBottom: 12 }}>{msg}</Text> : null}
      <FPressable style={st.btn} onPress={save}>
        <Text style={st.btnText}>Verbinden & Speichern</Text>
      </FPressable>
      <Text style={{ color: C.muted, fontSize: 12, marginTop: 16, lineHeight: 18 }}>
        Beispiele: http://192.168.1.50:8484 (Zuhause) · http://zimaboard.tail1234.ts.net:8484 (Tailscale) ·
        https://flix.meinedomain.de (Domain)
      </Text>
    </ScrollView>
  );
}

function ProfileScreen({ api, onPick }) {
  const [profiles, setProfiles] = useState(null);
  useEffect(() => {
    api("/api/profiles").then(setProfiles).catch(() => setProfiles([]));
  }, [api]);
  if (!profiles)
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.red} />
      </View>
    );
  return (
    <View style={st.center}>
      <Text style={st.brand}>GHGFlix</Text>
      <Text style={{ color: C.muted, marginVertical: 20 }}>Wer schaut?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 20, justifyContent: "center" }}>
        {profiles.map((p) => (
          <FPressable key={p.id} onPress={() => onPick(p.id)} style={{ alignItems: "center", gap: 8 }}>
            <View style={st.avatar}>
              <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800" }}>{p.name[0].toUpperCase()}</Text>
            </View>
            <Text style={{ color: C.text }}>{p.name}</Text>
          </FPressable>
        ))}
      </View>
    </View>
  );
}

// ── home ────────────────────────────────────────────────────────────────────
function HomeScreen({ api, img, push, openSettings }) {
  const [lib, setLib] = useState(null);
  const [cont, setCont] = useState([]);
  const [hist, setHist] = useState([]);
  const [favs, setFavs] = useState([]);
  const [q, setQ] = useState("");
  const [heroIdx, setHeroIdx] = useState(0);

  const load = useCallback(() => {
    api("/api/library").then(setLib).catch(() => setLib({ shows: [], movies: [] }));
    api("/api/continue").then((c) => setCont(Array.isArray(c) ? c : [])).catch(() => {});
    api("/api/history").then((h) => setHist(Array.isArray(h) ? h : [])).catch(() => {});
    api("/api/favorites").then((f) => setFavs(Array.isArray(f) ? f : [])).catch(() => {});
  }, [api]);
  useEffect(load, [load]);

  const filt = (arr) => (q ? arr.filter((x) => (x.title || "").toLowerCase().includes(q.toLowerCase())) : arr);

  /* Alles in EINE Liste werfen, damit sich daraus dieselben Reihen bauen
     lassen wie am Desktop (Neu hinzugefuegt, Top bewertet, Genres). */
  const alle = useMemo(() => {
    if (!lib) return [];
    return [
      ...(lib.shows || []).map((x) => ({ ...x, _t: "show" })),
      ...(lib.movies || []).map((x) => ({ ...x, _t: "movie" })),
    ];
  }, [lib]);

  const oeffne = useCallback((x) => push(x._t === "show" ? { name: "show", id: x.id } : { name: "movie", id: x.id }), [push]);

  // Hero: die zuletzt hinzugekommenen Titel MIT Hintergrundbild, im Wechsel
  const heroKandidaten = useMemo(
    () => alle.filter((x) => x.backdrop).sort((a, b) => (b.added_at || 0) - (a.added_at || 0)).slice(0, 8),
    [alle],
  );
  const hero = heroKandidaten[heroIdx % (heroKandidaten.length || 1)];
  useEffect(() => {
    if (heroKandidaten.length < 2) return;
    const t = setInterval(() => setHeroIdx((i) => i + 1), 12000);
    return () => clearInterval(t);
  }, [heroKandidaten.length]);

  const neu = useMemo(() => [...alle].sort((a, b) => (b.added_at || 0) - (a.added_at || 0)).slice(0, 20), [alle]);
  const top = useMemo(
    () => alle.filter((x) => (x.rating || 0) >= 7).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 20),
    [alle],
  );

  const favItems = useMemo(() => {
    if (!lib) return [];
    return favs
      .map((f) =>
        f.mediaType === "show"
          ? { ...((lib.shows || []).find((s2) => s2.id === f.refId) || {}), _t: "show" }
          : { ...((lib.movies || []).find((m) => m.id === f.refId) || {}), _t: "movie" },
      )
      .filter((x) => x.id);
  }, [favs, lib]);

  // Genre-Reihen wie am Desktop: die fuenf haeufigsten Genres
  const genreReihen = useMemo(() => {
    const zaehler = new Map();
    for (const x of alle) {
      for (const g of parseGenres(x.genres)) zaehler.set(g, (zaehler.get(g) || 0) + 1);
    }
    return [...zaehler.entries()]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([g]) => ({ genre: g, items: alle.filter((x) => parseGenres(x.genres).includes(g)).slice(0, 20) }));
  }, [alle]);

  if (!lib)
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.red} />
      </View>
    );

  const suche = q.trim().length > 0;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 48 }}>
      {/* ── Hero: grosses Bild wie am Desktop ───────────────────────────── */}
      {hero && !suche ? (
        <View style={st.hero}>
          <Image source={{ uri: img(hero.backdrop, "w1280") }} style={st.heroImg} />
          {/* Weicher Uebergang nach unten, ohne zusaetzliches Verlaufs-Modul:
             mehrere Streifen mit zunehmender Deckkraft. */}
          {[0.0, 0.15, 0.35, 0.6, 0.85, 1].map((deck, i) => (
            <View
              key={i}
              pointerEvents="none"
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: (5 - i) * 34,
                height: 36,
                backgroundColor: C.bg,
                opacity: deck,
              }}
            />
          ))}
          <View style={st.heroText}>
            <Text numberOfLines={2} style={st.heroTitle}>{hero.title}</Text>
            <Text style={st.heroMeta}>
              {[
                hero._t === "show" ? "Serie" : "Film",
                hero.year,
                hero.rating ? "\u2605 " + Number(hero.rating).toFixed(1) : null,
                hero._t === "show" && hero.seasons ? hero.seasons + " Staffeln" : null,
              ].filter(Boolean).join("  \u00b7  ")}
            </Text>
            {!!hero.overview && (
              <Text numberOfLines={2} style={st.heroDesc}>{hero.overview}</Text>
            )}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <FPressable style={st.heroBtn} onPress={() => oeffne(hero)}>
                <Text style={st.heroBtnText}>▶  Ansehen</Text>
              </FPressable>
              <FPressable style={[st.heroBtn, st.heroBtnGhost]} onPress={() => oeffne(hero)}>
                <Text style={[st.heroBtnText, { color: C.text }]}>Mehr Infos</Text>
              </FPressable>
            </View>
          </View>
          <View style={st.heroTop}>
            <Text style={st.brand}>GHGFlix</Text>
            <FPressable onPress={openSettings} style={st.iconRound}>
              <Text style={{ fontSize: 18 }}>⚙️</Text>
            </FPressable>
          </View>
        </View>
      ) : (
        <View style={[st.rowBetween, { paddingHorizontal: 16, paddingTop: 54, marginBottom: 8 }]}>
          <Text style={st.brand}>GHGFlix</Text>
          <FPressable onPress={openSettings} style={st.iconRound}>
            <Text style={{ fontSize: 18 }}>⚙️</Text>
          </FPressable>
        </View>
      )}

      <FInput
        style={[st.input, { marginHorizontal: 16, marginTop: hero && !suche ? 4 : 0 }]}
        value={q}
        onChangeText={setQ}
        placeholder="Suchen …"
        placeholderTextColor={C.muted}
      />

      {suche ? (
        <>
          <Text style={st.rowTitle}>Serien</Text>
          <PosterRow items={filt(lib.shows || [])} img={img} onPress={(x) => push({ name: "show", id: x.id })} />
          <Text style={st.rowTitle}>Filme</Text>
          <PosterRow items={filt(lib.movies || [])} img={img} onPress={(x) => push({ name: "movie", id: x.id })} />
        </>
      ) : (
        <>
          {cont.length > 0 && (
            <>
              <Text style={st.rowTitle}>Weiterschauen</Text>
              <WideRow
                items={cont}
                img={img}
                onPress={(x) =>
                  push({
                    name: "play",
                    type: x.mediaType,
                    id: x.refId,
                    title: x.title,
                    subtitle: x.mediaType === "episode" ? se(x.season, x.episode) : "",
                  })
                }
              />
            </>
          )}

          {neu.length > 0 && (
            <>
              <Text style={st.rowTitle}>Neu hinzugefügt</Text>
              <PosterRow items={neu} img={img} onPress={oeffne} />
            </>
          )}

          {favItems.length > 0 && (
            <>
              <Text style={st.rowTitle}>Meine Liste</Text>
              <PosterRow items={favItems} img={img} onPress={oeffne} />
            </>
          )}

          <Text style={st.rowTitle}>Serien</Text>
          <PosterRow items={lib.shows || []} img={img} onPress={(x) => push({ name: "show", id: x.id })} />

          <Text style={st.rowTitle}>Filme</Text>
          <PosterRow items={lib.movies || []} img={img} onPress={(x) => push({ name: "movie", id: x.id })} />

          {top.length > 0 && (
            <>
              <Text style={st.rowTitle}>Top bewertet</Text>
              <PosterRow items={top} img={img} onPress={oeffne} />
            </>
          )}

          {hist.length > 0 && (
            <>
              <Text style={st.rowTitle}>Zuletzt gesehen</Text>
              <WideRow
                items={hist}
                img={img}
                ohneFortschritt
                onPress={(x) =>
                  push({
                    name: "play",
                    type: x.mediaType,
                    id: x.refId,
                    title: x.title,
                    subtitle: x.mediaType === "episode" ? se(x.season, x.episode) : "",
                  })
                }
              />
            </>
          )}

          {genreReihen.map((r) => (
            <View key={r.genre}>
              <Text style={st.rowTitle}>{r.genre}</Text>
              <PosterRow items={r.items} img={img} onPress={oeffne} />
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

/** Genres kommen je nach Quelle als JSON-Liste oder als "Action, Drama". */
function parseGenres(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g;
  const s2 = String(g).trim();
  if (s2.startsWith("[")) {
    try { return JSON.parse(s2); } catch { return []; }
  }
  return s2.split(",").map((x) => x.trim()).filter(Boolean);
}

/** Breite Karten mit Fortschrittsbalken - fuer "Weiterschauen"/"Zuletzt gesehen". */
function WideRow({ items, img, onPress, ohneFortschritt }) {
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(x, i) => `${x.mediaType}${x.refId}${i}`}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item: x }) => {
        const bild = x.still || x.mBackdrop || x.sBackdrop || x.poster;
        const anteil = x.duration > 0 ? Math.min(1, x.position / x.duration) : 0;
        return (
          <FPressable
            onPress={() => onPress(x)}
            style={[st.kachel, { width: 218 }]}
            fokusStil={st.tvFokusKachel}
          >
            <View style={st.wideWrap}>
              {bild ? (
                <Image source={{ uri: img(bild, "w500") }} style={st.wideImg} />
              ) : (
                <View style={[st.wideImg, st.center]}>
                  <Text style={{ color: C.muted, fontSize: 11 }}>kein Bild</Text>
                </View>
              )}
              {!ohneFortschritt && anteil > 0 && (
                <View style={st.progressBg}>
                  <View style={[st.progressFg, { width: `${Math.round(anteil * 100)}%` }]} />
                </View>
              )}
              <View style={st.playDot}>
                <Text style={{ color: "#fff", fontSize: 16 }}>▶</Text>
              </View>
            </View>
            <Text numberOfLines={1} style={st.cardTitle}>{x.title}</Text>
            <Text numberOfLines={1} style={st.cardSub}>
              {x.mediaType === "episode" && x.season != null ? se(x.season, x.episode) + "  " : ""}
              {!ohneFortschritt && x.duration > 0 ? fmtTime(x.duration - x.position) + " übrig" : ""}
            </Text>
          </FPressable>
        );
      }}
    />
  );
}

/** Poster-Kachel wie am Desktop: Bild, NEU-Abzeichen, Bewertung, Titel. */
function PosterRow({ items, img, onPress }) {
  const jung = Date.now() - 14 * 24 * 3600 * 1000; // "neu" = letzte 14 Tage
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(x, i) => String(x.id ?? i) + (x._t || "")}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 12 }}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item: x }) => (
        <FPressable
          onPress={() => onPress(x)}
          style={[st.kachel, { width: 126 }]}
          fokusStil={st.tvFokusKachel}
        >
          <View style={st.posterWrap}>
            {x.poster ? (
              <Image source={{ uri: img(x.poster, "w500") }} style={st.poster} />
            ) : (
              <View style={[st.poster, st.center, { padding: 6 }]}>
                <Text numberOfLines={4} style={{ color: C.muted, fontSize: 10, textAlign: "center" }}>{x.title}</Text>
              </View>
            )}
            {(x.added_at || 0) > jung && (
              <View style={st.badgeNeu}>
                <Text style={st.badgeText}>NEU</Text>
              </View>
            )}
            {!!x.rating && Number(x.rating) > 0 && (
              <View style={st.badgeNote}>
                <Text style={st.badgeText}>★ {Number(x.rating).toFixed(1)}</Text>
              </View>
            )}
          </View>
          <Text numberOfLines={2} style={st.cardTitle}>{x.title}</Text>
          <Text numberOfLines={1} style={st.cardSub}>
            {x.seasons
              ? `${x.seasons} Staffel${x.seasons > 1 ? "n" : ""}`
              : x.year
                ? String(x.year)
                : ""}
          </Text>
        </FPressable>
      )}
    />
  );
}

/**
 * Kopfbereich der Detailseiten: Hintergrundbild mit weichem Uebergang.
 *
 * Vorher lag ueber dem ganzen Bild pauschal opacity 0.55 - dadurch wirkte es
 * flau und der Schnitt nach unten war eine harte Kante. Jetzt bleibt das Bild
 * oben voll kraeftig und laeuft nach unten in den Hintergrund aus, genau wie
 * in der Desktop-App und bei Plex/Jellyfin.
 *
 * Der Verlauf entsteht aus gestapelten Streifen zunehmender Deckkraft. Das
 * spart die Zusatz-Abhaengigkeit expo-linear-gradient - und jedes native
 * Modul weniger ist eines, das beim Start nicht fehlen kann (siehe die
 * Geschichte mit expo-asset in BERICHT.md).
 */
function BackdropKopf({ uri, hoehe = 230 }) {
  if (!uri) return <View style={{ height: 74 }} />;
  const streifen = [0.05, 0.2, 0.42, 0.68, 0.88, 1];
  return (
    <View style={{ height: hoehe }}>
      <Image source={{ uri }} style={{ width: "100%", height: hoehe, opacity: 0.9 }} />
      {streifen.map((deck, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: (streifen.length - 1 - i) * 26,
            height: 28,
            backgroundColor: C.bg,
            opacity: deck,
          }}
        />
      ))}
    </View>
  );
}

function ShowScreen({ api, img, push, pop, id, initialSeason }) {
  const [data, setData] = useState(null);
  const [prog, setProg] = useState([]);
  const [fav, setFav] = useState(false); // MOB-041
  const [season, setSeason] = useState(initialSeason ?? seasonMemory[id] ?? null);

  useEffect(() => {
    api(`/api/shows/${id}`).then(setData).catch(() => {});
    api("/api/progress").then(setProg).catch(() => {});
    api("/api/favorites")
      .then((f) => setFav(!!(Array.isArray(f) && f.find((x) => x.mediaType === "show" && x.refId === +id))))
      .catch(() => {});
  }, [api, id]);

  const toggleFav = () =>
    api("/api/favorites", { method: "POST", body: { mediaType: "show", refId: +id } })
      .then((r) => setFav(!!r.favorite))
      .catch(() => {});

  // MOB-042: Folge gedrückt halten = gesehen/ungesehen umschalten
  const toggleWatched = (e, watched) =>
    api("/api/watched", { method: "POST", body: { mediaType: "episode", refId: e.id, watched } })
      .then(() => api("/api/progress").then(setProg))
      .catch(() => {});

  const progMap = useMemo(() => new Map(prog.filter((x) => x.mediaType === "episode").map((x) => [x.refId, x])), [prog]);

  if (!data)
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.red} />
      </View>
    );

  const { show, seasons } = data;
  const cur = season != null && seasons.some((s) => s.season === season) ? season : (seasons.find((s) => s.season > 0) ?? seasons[0])?.season;
  const pick = (s) => {
    seasonMemory[id] = s;
    setSeason(s);
  };
  const flat = seasons.flatMap((s) => s.episodes);
  const nextEpOf = (epId) => {
    const i = flat.findIndex((e) => e.id === epId);
    return i >= 0 ? flat[i + 1] ?? null : null;
  };
  const playEp = (e) =>
    push({
      name: "play",
      type: "episode",
      id: e.id,
      title: show.title,
      subtitle: `${se(e.season, e.episode)}${e.title ? " · " + e.title : ""}`,
      nextEp: nextEpOf(e.id),
    });
  const nextUnwatched = flat.find((e) => !progMap.get(e.id)?.watched) ?? flat[0];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
      <BackdropKopf uri={show.backdrop ? img(show.backdrop, "w1280") : null} />
      <FPressable onPress={pop} style={st.backBtn}>
        <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
      </FPressable>
      <View style={{ paddingHorizontal: 16 }}>
        <View style={[st.rowBetween, { alignItems: "flex-start" }]}>
          <Text style={[st.h1, { flex: 1, paddingRight: 10 }]}>{show.title}</Text>
          <FPressable onPress={toggleFav} hitSlop={10} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 22, color: fav ? C.red : C.muted }}>{fav ? "♥" : "♡"}</Text>
          </FPressable>
        </View>
        <Text style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>
          {show.year ?? ""} · {seasons.length} Staffeln · {flat.length} Folgen{show.rating ? ` · ★ ${show.rating.toFixed(1)}` : ""}
        </Text>
        {nextUnwatched && (
          <FPressable style={[st.btn, { alignSelf: "flex-start" }]} onPress={() => playEp(nextUnwatched)}>
            <Text style={st.btnText}>▶ Abspielen · {se(nextUnwatched.season, nextUnwatched.episode)}</Text>
          </FPressable>
        )}
        {!!show.overview && <Text style={{ color: "#c9c9d2", fontSize: 13, lineHeight: 19, marginTop: 12 }}>{show.overview}</Text>}
      </View>

      <FlatList
        horizontal
        data={seasons}
        keyExtractor={(s) => String(s.season)}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 8, marginVertical: 14 }}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item: s }) => (
          <FPressable onPress={() => pick(s.season)} style={[st.tab, s.season === cur && { backgroundColor: C.red }]}>
            <Text style={{ color: s.season === cur ? "#fff" : C.muted, fontWeight: s.season === cur ? "700" : "400" }}>
              {s.season === 0 ? "Specials" : `Staffel ${s.season}`}
            </Text>
          </FPressable>
        )}
      />

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <Text style={{ color: C.muted, fontSize: 11 }}>Tipp: Folge gedrückt halten = als gesehen/ungesehen markieren</Text>
        {(seasons.find((s) => s.season === cur)?.episodes ?? []).map((e) => {
          const p = progMap.get(e.id);
          const pct = p && p.duration > 0 ? Math.min(100, (p.position / p.duration) * 100) : 0;
          return (
            <FPressable
              key={e.id}
              onPress={() => playEp(e)}
              onLongPress={() => toggleWatched(e, !p?.watched)}
              delayLongPress={450}
              style={st.epRow}
            >
              <Image source={{ uri: e.still ? img(e.still, "w500") : undefined }} style={st.epImg} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: C.text, fontWeight: "600", fontSize: 13 }}>
                  {e.episode}. {e.title ?? `Folge ${e.episode}`}
                  {p?.watched ? "  ✓" : ""}
                </Text>
                {!!e.overview && (
                  <Text numberOfLines={2} style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                    {e.overview}
                  </Text>
                )}
                {pct > 0 && !p?.watched && (
                  <View style={[st.progressBg, { position: "relative", bottom: 0, marginTop: 6 }]}>
                    <View style={[st.progressFg, { width: `${pct}%` }]} />
                  </View>
                )}
              </View>
            </FPressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function MovieScreen({ api, img, push, pop, id }) {
  const [mv, setMv] = useState(null);
  const [fav, setFav] = useState(false); // MOB-041
  const [watched, setWatched] = useState(false); // MOB-042
  useEffect(() => {
    api(`/api/movies/${id}`).then(setMv).catch(() => {});
    api("/api/favorites")
      .then((f) => setFav(!!(Array.isArray(f) && f.find((x) => x.mediaType === "movie" && x.refId === +id))))
      .catch(() => {});
    api("/api/progress")
      .then((ps) => setWatched(!!(Array.isArray(ps) && ps.find((p) => p.mediaType === "movie" && p.refId === +id)?.watched)))
      .catch(() => {});
  }, [api, id]);
  const toggleFav = () =>
    api("/api/favorites", { method: "POST", body: { mediaType: "movie", refId: +id } })
      .then((r) => setFav(!!r.favorite))
      .catch(() => {});
  const toggleWatched = () =>
    api("/api/watched", { method: "POST", body: { mediaType: "movie", refId: +id, watched: !watched } })
      .then(() => setWatched(!watched))
      .catch(() => {});
  if (!mv)
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.red} />
      </View>
    );
  return (
    <ScrollView style={{ flex: 1 }}>
      <BackdropKopf uri={mv.backdrop ? img(mv.backdrop, "w1280") : null} />
      <FPressable onPress={pop} style={st.backBtn}>
        <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
      </FPressable>
      <View style={{ padding: 16 }}>
        <View style={[st.rowBetween, { alignItems: "flex-start" }]}>
          <Text style={[st.h1, { flex: 1, paddingRight: 10 }]}>{mv.title}</Text>
          <FPressable onPress={toggleFav} hitSlop={10} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 22, color: fav ? C.red : C.muted }}>{fav ? "♥" : "♡"}</Text>
          </FPressable>
        </View>
        <Text style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
          {mv.year ?? ""}
          {mv.rating ? ` · ★ ${mv.rating.toFixed(1)}` : ""}
          {mv.duration ? ` · ${Math.round(mv.duration / 60)} Min.` : ""}
          {watched ? " · ✓ gesehen" : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <FPressable style={st.btn} onPress={() => push({ name: "play", type: "movie", id: mv.id, title: mv.title, subtitle: mv.year ? String(mv.year) : "" })}>
            <Text style={st.btnText}>▶ Abspielen</Text>
          </FPressable>
          <FPressable style={[st.btn, { backgroundColor: C.surface }]} onPress={toggleWatched}>
            <Text style={st.btnText}>{watched ? "✓ Gesehen" : "Als gesehen markieren"}</Text>
          </FPressable>
        </View>
        {!!mv.overview && <Text style={{ color: "#c9c9d2", fontSize: 13, lineHeight: 19, marginTop: 14 }}>{mv.overview}</Text>}
      </View>
    </ScrollView>
  );
}

// ── player ──────────────────────────────────────────────────────────────────
//
// WICHTIG ZUM ABSTURZ "NativeSharedObjectNotFoundException":
// expo-video gibt das native Player-Objekt frei, sobald der Bildschirm
// verlassen wird. Jeder spätere Zugriff auf `player.currentTime` &Co. wirft
// dann. Genau das passierte im Aufräum-Teil des Speicher-Timers.
//
// Lösung: Position und Dauer werden fortlaufend in Refs gespiegelt (gefüttert
// vom timeUpdate-Ereignis). Gespeichert wird NUR aus diesen Refs — nach dem
// Verlassen wird das native Objekt also nie mehr angefasst. Zusätzlich läuft
// jeder direkte Zugriff über `safe()`.
function PlayerScreen({ api, pop, push, base, conn, type, id, title, subtitle, nextEp }) {
  useKeepAwake();
  const [info, setInfo] = useState(null);
  const [resume, setResume] = useState(0);
  const [uiVisible, setUiVisible] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [buffering, setBuffering] = useState(true);
  const [pos, setPos] = useState(0);          // Anzeige
  const [dur, setDur] = useState(0);
  const [barWidth, setBarWidth] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubT, setScrubT] = useState(0);

  // AV-20: Beim Umwandeln startet der Datenstrom an dieser Stelle.
  const offsetRef = useRef(0);
  const modeRef = useRef("direct");
  const posRef = useRef(0);     // letzte bekannte Position (überlebt den Player)
  const durRef = useRef(0);
  const aliveRef = useRef(true); // false, sobald der Bildschirm verlassen wurde
  const hideRef = useRef(null);

  /** Jeder Zugriff auf das native Player-Objekt — niemals ungeschützt. */
  const safe = (fn, fallback = undefined) => {
    if (!aliveRef.current) return fallback;
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      if (hideRef.current) clearTimeout(hideRef.current);
    };
  }, []);

  useEffect(() => {
    (async () => {
      const [i, prog] = await Promise.all([api(`/api/play/${type}/${id}`), api("/api/progress")]);
      const saved = prog.find?.((x) => x.mediaType === type && x.refId === +id);
      const at = saved && !saved.watched && saved.position > 30 && saved.position < (saved.duration || 1e9) * 0.95 ? saved.position : 0;
      modeRef.current = i.direct ? "direct" : "transcode";
      offsetRef.current = i.direct ? 0 : at;
      posRef.current = at;
      durRef.current = i.duration || 0;
      setResume(at);
      setDur(i.duration || 0);
      setPos(at);
      setInfo(i);
    })().catch(() => {});
  }, [api, type, id]);

  const tok = conn?.token ? `&token=${conn.token}` : "";
  const srcFor = (i, t) =>
    modeRef.current === "direct" ? `${base}${i.directUrl}${tok}&profile=1` : `${base}${i.transcodeUrl}${tok}&profile=1&t=${Math.floor(t)}`;

  const player = useVideoPlayer(null, (p) => {
    p.timeUpdateEventInterval = 1; // 1 s -> flüssige Fortschrittsleiste
  });

  // Quelle laden, sobald die Infos da sind
  useEffect(() => {
    if (!info) return;
    safe(() => {
      player.replace(srcFor(info, resume));
      player.play();
    });
    if (modeRef.current === "direct" && resume > 0) {
      const t = setTimeout(() => safe(() => { player.currentTime = resume; }), 600);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  // Position/Dauer/Zustand fortlaufend spiegeln
  useEffect(() => {
    const subs = [];
    safe(() => {
      subs.push(
        player.addListener("timeUpdate", ({ currentTime }) => {
          if (!aliveRef.current) return;
          const p = offsetRef.current + (currentTime || 0);
          posRef.current = p;
          setPos(p);
          if (!durRef.current) {
            const d = safe(() => player.duration, 0) || 0;
            if (d) { durRef.current = d; setDur(d); }
          }
        }),
      );
      subs.push(
        player.addListener("playingChange", ({ isPlaying }) => aliveRef.current && setPlaying(!!isPlaying)),
      );
      subs.push(
        player.addListener("statusChange", ({ status }) => {
          if (!aliveRef.current) return;
          setBuffering(status === "loading");
          // Direktwiedergabe klappt nicht -> auf Umwandeln umschalten
          if (status === "error" && modeRef.current === "direct" && info) {
            modeRef.current = "transcode";
            offsetRef.current = posRef.current;
            safe(() => {
              player.replace(srcFor(info, posRef.current));
              player.play();
            });
          }
        }),
      );
    });
    return () => subs.forEach((s) => { try { s.remove(); } catch { /* schon weg */ } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  /** Speichern liest AUSSCHLIESSLICH die Refs — kein nativer Zugriff. */
  const save = useCallback(
    (watched = false) => {
      const d = durRef.current;
      const p = posRef.current;
      if (!d) return;
      const done = watched || p >= d * 0.95;
      api("/api/progress", {
        method: "POST",
        body: { mediaType: type, refId: +id, position: p, duration: d, watched: done },
      }).catch(() => {});
    },
    [api, type, id],
  );

  useEffect(() => {
    const t = setInterval(() => save(), 10000);
    return () => {
      clearInterval(t);
      save(); // gefahrlos: greift nur auf Refs zu
    };
  }, [save]);

  // Bedienelemente nach 4 s ausblenden
  const wake = useCallback(() => {
    setUiVisible(true);
    if (hideRef.current) clearTimeout(hideRef.current);
    hideRef.current = setTimeout(() => setUiVisible(false), 4000);
  }, []);
  useEffect(() => { wake(); }, [wake]);

  const seekTo = (t) => {
    const target = Math.max(0, Math.min(t, durRef.current || t));
    posRef.current = target;
    setPos(target);
    if (modeRef.current === "direct") {
      safe(() => { player.currentTime = target - offsetRef.current; });
    } else {
      offsetRef.current = target;
      safe(() => {
        player.replace(srcFor(info, target));
        player.play();
      });
    }
    wake();
  };
  const seekBy = (d) => seekTo(posRef.current + d);

  const togglePlay = () => {
    safe(() => (player.playing ? player.pause() : player.play()));
    wake();
  };

  const leave = () => {
    save();
    aliveRef.current = false; // ab hier keine Player-Zugriffe mehr
    pop();
  };
  const playNext = () => {
    save(true);
    aliveRef.current = false;
    pop();
    if (nextEp) push({ name: "play", type: "episode", id: nextEp.id, title, subtitle: se(nextEp.season, nextEp.episode) + (nextEp.title ? " · " + nextEp.title : "") });
  };

  /* ── Fernbedienung ────────────────────────────────────────────────────────
     Die Medientasten des Fernsehers (Wiedergabe/Pause, Vor- und Ruecklauf,
     naechster Titel) kommen als "onHWKeyEvent" an - siehe die ausfuehrliche
     Erklaerung beim TV-Fokus weiter oben. Ohne das hier waeren sie am
     Fernseher wirkungslos, und man muesste alles ueber die Bildschirmknoepfe
     erledigen.

     Bewusst NICHT belegt: "select" (die mittlere Taste). Ist gerade ein Knopf
     ausgewaehlt, hat Android den Druck bereits an ihn weitergereicht - eine
     zweite Reaktion hier wuerde doppelt ausloesen. Bei ausgeblendeter
     Bedienleiste holt die Taste sie nur zurueck. */
  useFernbedienung((taste) => {
    switch (taste) {
      case "playPause":
        togglePlay();
        break;
      case "fastForward":
        seekBy(30);
        break;
      case "rewind":
        seekBy(-10);
        break;
      case "right":
        if (!uiVisible) seekBy(30); else wake();
        break;
      case "left":
        if (!uiVisible) seekBy(-10); else wake();
        break;
      case "next":
        if (nextEp) playNext();
        break;
      case "stop":
        leave();
        break;
      default:
        wake(); // jede andere Taste holt die Bedienleiste zurueck
    }
  });

  // Konnte das Video-Modul nicht geladen werden, hier sauber Bescheid geben
  if (videoLadeFehler || !VideoView) {
    return (
      <View style={[st.center, { backgroundColor: "#000", padding: 28 }]}>
        <Text style={{ color: C.red, fontSize: 18, fontWeight: "800", marginBottom: 10 }}>
          Videowiedergabe nicht verfuegbar
        </Text>
        <Text style={{ color: C.text, fontSize: 13, textAlign: "center", marginBottom: 6 }}>
          Auf diesem Geraet fehlt der Video-Baustein der App.
        </Text>
        <Text style={{ color: C.muted, fontSize: 11, textAlign: "center", marginBottom: 18 }}>
          {videoLadeFehler || "expo-video nicht geladen"}
        </Text>
        <FPressable onPress={pop} style={st.btn}>
          <Text style={st.btnText}>Zurueck</Text>
        </FPressable>
      </View>
    );
  }

  if (!info)
    return (
      <View style={[st.center, { backgroundColor: "#000" }]}>
        <ActivityIndicator color={C.red} />
      </View>
    );

  const shown = scrubbing ? scrubT : pos;
  const pct = dur > 0 ? Math.min(1, Math.max(0, shown / dur)) : 0;
  const tFromX = (x) => (barWidth > 0 && dur > 0 ? (Math.min(Math.max(x, 0), barWidth) / barWidth) * dur : 0);

  return (
    <View style={{ flex: 1, backgroundColor: "#000" }}>
      <FPressable style={{ flex: 1 }} onPress={() => (uiVisible ? setUiVisible(false) : wake())}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" allowsFullscreen />
      </FPressable>

      {buffering && (
        <View pointerEvents="none" style={st.playerSpinner}>
          <ActivityIndicator color={C.red} size="large" />
        </View>
      )}

      {uiVisible && (
        <>
          <View style={st.playerTop}>
            <FPressable onPress={leave} style={st.pbtn} hitSlop={8}>
              <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
            </FPressable>
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: C.text, fontWeight: "700" }}>{title}</Text>
              {!!subtitle && <Text numberOfLines={1} style={{ color: C.muted, fontSize: 12 }}>{subtitle}</Text>}
            </View>
            <View style={st.playerBadge}>
              <Text style={{ color: C.muted, fontSize: 11 }}>
                {modeRef.current === "direct" ? "Direkt" : "Umgewandelt"}
              </Text>
            </View>
          </View>

          <View style={st.playerBottom}>
            {/* Fortschrittsleiste: tippen oder ziehen zum Spulen */}
            <View style={st.seekRow}>
              <Text style={st.timeText}>{fmtTime(shown)}</Text>
              <View
                style={st.seekHit}
                onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(e) => { setScrubbing(true); setScrubT(tFromX(e.nativeEvent.locationX)); }}
                onResponderMove={(e) => setScrubT(tFromX(e.nativeEvent.locationX))}
                onResponderRelease={(e) => { const t = tFromX(e.nativeEvent.locationX); setScrubbing(false); seekTo(t); }}
                onResponderTerminate={() => setScrubbing(false)}
              >
                <View style={st.seekTrack}>
                  <View style={[st.seekFill, { width: `${pct * 100}%` }]} />
                  <View style={[st.seekKnob, { left: `${pct * 100}%` }]} />
                </View>
              </View>
              <Text style={st.timeText}>{dur ? "-" + fmtTime(Math.max(0, dur - shown)) : "--:--"}</Text>
            </View>

            <View style={st.playerButtons}>
              <FPressable onPress={() => seekBy(-10)} style={st.pbtn} hitSlop={8}>
                <Text style={{ color: C.text }}>« 10</Text>
              </FPressable>
              <FPressable onPress={togglePlay} style={[st.pbtn, st.pbtnMain]} hitSlop={8}>
                <Text style={{ color: "#fff", fontSize: 22 }}>{playing ? "❚❚" : "▶"}</Text>
              </FPressable>
              <FPressable onPress={() => seekBy(10)} style={st.pbtn} hitSlop={8}>
                <Text style={{ color: C.text }}>10 »</Text>
              </FPressable>
              {nextEp && (
                <FPressable onPress={playNext} style={st.pbtn} hitSlop={8}>
                  <Text style={{ color: C.text }}>Nächste ▶</Text>
                </FPressable>
              )}
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ── styles ──────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: C.bg },
  brand: { color: C.red, fontSize: 26, fontWeight: "800", letterSpacing: 0.5 },
  h1: { color: C.text, fontSize: 22, fontWeight: "800", marginTop: 8 },
  h3: { color: C.text, fontSize: 15, fontWeight: "700" },
  desc: { color: C.muted, fontSize: 12, marginTop: 4, marginBottom: 8, lineHeight: 17 },
  rowTitle: { color: C.text, fontSize: 16, fontWeight: "700", margin: 16, marginBottom: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panel: { backgroundColor: C.bg2, borderColor: C.line, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 14 },
  input: { backgroundColor: C.surface, borderColor: C.line, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, color: C.text, marginTop: 8 },
  inputFokus: { borderColor: C.red, borderWidth: 3, backgroundColor: "#e5091415" },
  btn: { backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  iconBtn: { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 10, justifyContent: "center" },
  avatar: { width: 80, height: 80, borderRadius: 14, backgroundColor: C.red, alignItems: "center", justifyContent: "center" },
  // ── Kacheln und Reihen (dem Desktop nachempfunden) ──
  posterWrap: { position: "relative" },
  poster: { width: 118, height: 177, borderRadius: 10, backgroundColor: C.surface },
  wideWrap: { position: "relative" },
  wideImg: { width: 210, height: 118, borderRadius: 10, backgroundColor: C.surface },
  progressBg: { position: "absolute", left: 0, right: 0, bottom: 0, height: 4, backgroundColor: "#00000088", borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  progressFg: { height: 4, backgroundColor: C.red },
  playDot: {
    position: "absolute", right: 8, top: 8, width: 30, height: 30, borderRadius: 15,
    backgroundColor: "#000000aa", alignItems: "center", justifyContent: "center",
  },
  cardTitle: { color: C.text, fontSize: 12, fontWeight: "600", marginTop: 6, lineHeight: 15 },
  cardSub: { color: C.muted, fontSize: 11, marginTop: 1 },
  badgeNeu: { position: "absolute", left: 6, top: 6, backgroundColor: C.red, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  badgeNote: { position: "absolute", right: 6, top: 6, backgroundColor: "#000000bb", borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "800" },
  // ── Hero (grosses Bild oben, wie am Desktop) ──
  hero: { height: 300, position: "relative", marginBottom: 4 },
  heroImg: { width: "100%", height: 300, backgroundColor: C.bg2 },
  heroTop: { position: "absolute", top: 46, left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  heroText: { position: "absolute", left: 16, right: 16, bottom: 10 },
  heroTitle: { color: C.text, fontSize: 26, fontWeight: "900", textShadowColor: "#000", textShadowRadius: 8 },
  heroMeta: { color: C.red, fontSize: 12, fontWeight: "700", marginTop: 4 },
  heroDesc: { color: "#dcdce4", fontSize: 12, marginTop: 6, lineHeight: 17 },
  heroBtn: { backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  heroBtnGhost: { backgroundColor: "#ffffff22" },
  heroBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  iconRound: { backgroundColor: "#00000088", borderRadius: 20, width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  tab: { backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  epRow: { flexDirection: "row", gap: 10, backgroundColor: C.bg2, borderRadius: 12, padding: 10, alignItems: "center" },
  epImg: { width: 110, height: 62, borderRadius: 8, backgroundColor: C.surface },
  backBtn: { position: "absolute", top: 50, left: 14, backgroundColor: "#00000088", borderRadius: 10, padding: 8, zIndex: 5 },
  playerTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingTop: 48, backgroundColor: "#000000aa" },
  playerBottom: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30, backgroundColor: "#000000cc" },
  pbtn: { backgroundColor: "#ffffff22", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
  // Markierung fuer die Fernbedienung: dicker roter Rahmen + heller Hintergrund.
  // Ohne das sieht man am Fernseher nicht, welcher Knopf gerade dran ist.
  // Markierung fuer die Fernbedienung. Heller Rahmen + Schein, damit er auf
  // dunklem Hintergrund aus drei Metern Entfernung sicher zu erkennen ist.
  tvFokus: {
    borderWidth: 3,
    borderColor: "#ffffff",
    backgroundColor: "#e5091433",
    borderRadius: 12,
    // Erhoeht die Kachel optisch - wie bei Plex/Jellyfin
    transform: [{ scale: 1.04 }],
  },
  // Fuer Poster und breite Karten: staerker skalieren, roter Rahmen ums Bild.
  // Kachel-Grundzustand: Rahmen ist IMMER vorhanden, nur unsichtbar. Sonst
  // wuerde beim Fokussieren die Breite wachsen und die ganze Reihe verrutschen.
  kachel: {
    borderWidth: 3,
    borderColor: "transparent",
    borderRadius: 13,
    padding: 1,
  },
  tvFokusKachel: {
    borderColor: "#ffffff",
    backgroundColor: "#ffffff14",
    transform: [{ scale: 1.07 }],
  },
  pbtnMain: { backgroundColor: C.red, paddingHorizontal: 26 },
  playerButtons: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 14, marginTop: 12 },
  playerBadge: { backgroundColor: "#ffffff1a", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  playerSpinner: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  seekRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  seekHit: { flex: 1, height: 30, justifyContent: "center" },
  seekTrack: { height: 4, backgroundColor: "#ffffff40", borderRadius: 2, justifyContent: "center" },
  seekFill: { height: 4, backgroundColor: C.red, borderRadius: 2 },
  seekKnob: { position: "absolute", width: 14, height: 14, borderRadius: 7, backgroundColor: C.red, borderWidth: 2, borderColor: "#fff", marginLeft: -7 },
  timeText: { color: C.text, fontSize: 12, fontVariant: ["tabular-nums"], minWidth: 46, textAlign: "center" },
});

/**
 * Der eigentliche Einstieg: Fehlerfänger drumherum, darüber das Banner mit dem
 * zuletzt gespeicherten Absturz. Am Fernseher ist das die einzige Möglichkeit,
 * überhaupt zu sehen, WAS schiefgelaufen ist.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <CrashBanner />
        <View style={{ flex: 1 }}>
          <AppInner />
        </View>
      </View>
    </ErrorBoundary>
  );
}

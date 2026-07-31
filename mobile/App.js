// GHGFlix mobile (Expo Go) — native client for the GHGFlix server.
// Connection manager with Lokal/Domain/Tailscale addresses and automatic
// switching, profile picker, library, season-aware show pages and a native
// video player (expo-video) with progress sync.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useKeepAwake } from "expo-keep-awake";
import { StatusBar } from "expo-status-bar";
import { VideoView, useVideoPlayer } from "expo-video";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Image,
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
  useEffect(() => {
    AsyncStorage.getItem(CRASH_KEY)
      .then((v) => v && setCrash(JSON.parse(v)))
      .catch(() => {});
  }, []);
  if (!crash) return null;
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
          <TextInput style={st.input} value={manualUrl} onChangeText={setManualUrl} placeholder="http://192.168.1.50:8484" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} />
        ) : (
          <>
            {list.map((e, i) => (
              <View key={i} style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
                <TextInput
                  style={[st.input, { flex: 0.55, marginTop: 0 }]}
                  value={e.name}
                  onChangeText={(v) => setList(list.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                  placeholder="Name"
                  placeholderTextColor={C.muted}
                />
                <TextInput
                  style={[st.input, { flex: 1, marginTop: 0 }]}
                  value={e.url}
                  onChangeText={(v) => setList(list.map((x, j) => (j === i ? { ...x, url: v } : x)))}
                  placeholder="http://…"
                  placeholderTextColor={C.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Pressable style={st.iconBtn} onPress={() => test(e.url)}>
                  <Text style={{ color: C.text }}>Test</Text>
                </Pressable>
                <Pressable style={st.iconBtn} onPress={() => setList(list.filter((_, j) => j !== i))}>
                  <Text style={{ color: C.muted }}>✕</Text>
                </Pressable>
              </View>
            ))}
            <Pressable onPress={() => setList([...list, { name: "", url: "" }])}>
              <Text style={{ color: C.red, marginTop: 12, fontWeight: "600" }}>+ Adresse (Lokal / Domain / Tailscale)</Text>
            </Pressable>
          </>
        )}
      </View>

      <View style={st.panel}>
        <Text style={st.h3}>Server-Passwort (falls gesetzt)</Text>
        <TextInput style={st.input} value={password} onChangeText={setPassword} placeholder="••••••" placeholderTextColor={C.muted} secureTextEntry />
      </View>

      {msg ? <Text style={{ color: msg.startsWith("✓") ? "#4ade80" : C.red, marginBottom: 12 }}>{msg}</Text> : null}
      <Pressable style={st.btn} onPress={save}>
        <Text style={st.btnText}>Verbinden & Speichern</Text>
      </Pressable>
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
          <Pressable key={p.id} onPress={() => onPick(p.id)} style={{ alignItems: "center", gap: 8 }}>
            <View style={st.avatar}>
              <Text style={{ color: "#fff", fontSize: 30, fontWeight: "800" }}>{p.name[0].toUpperCase()}</Text>
            </View>
            <Text style={{ color: C.text }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

// ── home ────────────────────────────────────────────────────────────────────
function HomeScreen({ api, img, push, openSettings }) {
  const [lib, setLib] = useState(null);
  const [cont, setCont] = useState([]);
  const [favs, setFavs] = useState([]); // MOB-041: "Meine Liste" (server-API /api/favorites)
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    api("/api/library").then(setLib).catch(() => setLib({ shows: [], movies: [] }));
    api("/api/continue").then(setCont).catch(() => {});
    api("/api/favorites").then((f) => setFavs(Array.isArray(f) ? f : [])).catch(() => {});
  }, [api]);
  useEffect(load, [load]);

  const filt = (arr) => (q ? arr.filter((x) => x.title.toLowerCase().includes(q.toLowerCase())) : arr);

  const favItems = useMemo(() => {
    if (!lib) return [];
    return favs
      .map((f) =>
        f.mediaType === "show"
          ? { ...(lib.shows.find((s) => s.id === f.refId) || {}), _t: "show" }
          : { ...(lib.movies.find((m) => m.id === f.refId) || {}), _t: "movie" },
      )
      .filter((x) => x.id);
  }, [favs, lib]);

  if (!lib)
    return (
      <View style={st.center}>
        <ActivityIndicator color={C.red} />
      </View>
    );

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: 54, paddingBottom: 40 }}>
      <View style={[st.rowBetween, { paddingHorizontal: 16, marginBottom: 8 }]}>
        <Text style={st.brand}>GHGFlix</Text>
        <Pressable onPress={openSettings}>
          <Text style={{ fontSize: 20 }}>⚙️</Text>
        </Pressable>
      </View>
      <TextInput style={[st.input, { marginHorizontal: 16 }]} value={q} onChangeText={setQ} placeholder="Suchen …" placeholderTextColor={C.muted} />

      {cont.length > 0 && !q && (
        <>
          <Text style={st.rowTitle}>Weiterschauen</Text>
          <FlatList
            horizontal
            data={cont}
            keyExtractor={(x) => `${x.mediaType}${x.refId}`}
            contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
            showsHorizontalScrollIndicator={false}
            renderItem={({ item: x }) => (
              <Pressable
                onPress={() =>
                  push({
                    name: "play",
                    type: x.mediaType,
                    id: x.refId,
                    title: x.title,
                    subtitle: x.mediaType === "episode" ? se(x.season, x.episode) : "",
                  })
                }
                style={{ width: 190 }}
              >
                <Image source={{ uri: x.still ? img(x.still, "w500") : img(x.mBackdrop || x.sBackdrop, "w500") }} style={st.wideImg} />
                <View style={st.progressBg}>
                  <View style={[st.progressFg, { width: `${Math.round((x.position / x.duration) * 100)}%` }]} />
                </View>
                <Text numberOfLines={1} style={{ color: C.text, fontSize: 12, marginTop: 4 }}>{x.title}</Text>
                <Text style={{ color: C.muted, fontSize: 11 }}>{fmtTime(x.duration - x.position)} übrig</Text>
              </Pressable>
            )}
          />
        </>
      )}

      {favItems.length > 0 && !q && (
        <>
          <Text style={st.rowTitle}>Meine Liste</Text>
          <PosterRow
            items={favItems}
            img={img}
            onPress={(x) => push(x._t === "show" ? { name: "show", id: x.id } : { name: "movie", id: x.id })}
          />
        </>
      )}

      <Text style={st.rowTitle}>Serien</Text>
      <PosterRow items={filt(lib.shows)} img={img} onPress={(x) => push({ name: "show", id: x.id })} />
      <Text style={st.rowTitle}>Filme</Text>
      <PosterRow items={filt(lib.movies)} img={img} onPress={(x) => push({ name: "movie", id: x.id })} />
    </ScrollView>
  );
}

function PosterRow({ items, img, onPress }) {
  if (!items.length) return <Text style={{ color: C.muted, paddingHorizontal: 16 }}>Nichts gefunden</Text>;
  return (
    <FlatList
      horizontal
      data={items}
      keyExtractor={(x) => String(x.id)}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
      showsHorizontalScrollIndicator={false}
      renderItem={({ item: x }) => (
        <Pressable onPress={() => onPress(x)} style={{ width: 105 }}>
          {x.poster ? (
            <Image source={{ uri: img(x.poster) }} style={st.poster} />
          ) : (
            <View style={[st.poster, st.center]}>
              <Text style={{ color: C.muted, fontSize: 11, textAlign: "center", padding: 6 }}>{x.title}</Text>
            </View>
          )}
          <Text numberOfLines={1} style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{x.title}</Text>
        </Pressable>
      )}
    />
  );
}

// ── show detail (remembers the season!) ─────────────────────────────────────
const seasonMemory = {};

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
      {show.backdrop && <Image source={{ uri: img(show.backdrop, "w1280") }} style={{ width: "100%", height: 190, opacity: 0.55 }} />}
      <Pressable onPress={pop} style={st.backBtn}>
        <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
      </Pressable>
      <View style={{ paddingHorizontal: 16 }}>
        <View style={[st.rowBetween, { alignItems: "flex-start" }]}>
          <Text style={[st.h1, { flex: 1, paddingRight: 10 }]}>{show.title}</Text>
          <Pressable onPress={toggleFav} hitSlop={10} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 22, color: fav ? C.red : C.muted }}>{fav ? "♥" : "♡"}</Text>
          </Pressable>
        </View>
        <Text style={{ color: C.muted, fontSize: 12, marginBottom: 10 }}>
          {show.year ?? ""} · {seasons.length} Staffeln · {flat.length} Folgen{show.rating ? ` · ★ ${show.rating.toFixed(1)}` : ""}
        </Text>
        {nextUnwatched && (
          <Pressable style={[st.btn, { alignSelf: "flex-start" }]} onPress={() => playEp(nextUnwatched)}>
            <Text style={st.btnText}>▶ Abspielen · {se(nextUnwatched.season, nextUnwatched.episode)}</Text>
          </Pressable>
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
          <Pressable onPress={() => pick(s.season)} style={[st.tab, s.season === cur && { backgroundColor: C.red }]}>
            <Text style={{ color: s.season === cur ? "#fff" : C.muted, fontWeight: s.season === cur ? "700" : "400" }}>
              {s.season === 0 ? "Specials" : `Staffel ${s.season}`}
            </Text>
          </Pressable>
        )}
      />

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <Text style={{ color: C.muted, fontSize: 11 }}>Tipp: Folge gedrückt halten = als gesehen/ungesehen markieren</Text>
        {(seasons.find((s) => s.season === cur)?.episodes ?? []).map((e) => {
          const p = progMap.get(e.id);
          const pct = p && p.duration > 0 ? Math.min(100, (p.position / p.duration) * 100) : 0;
          return (
            <Pressable
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
            </Pressable>
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
      {mv.backdrop && <Image source={{ uri: img(mv.backdrop, "w1280") }} style={{ width: "100%", height: 190, opacity: 0.55 }} />}
      <Pressable onPress={pop} style={st.backBtn}>
        <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
      </Pressable>
      <View style={{ padding: 16 }}>
        <View style={[st.rowBetween, { alignItems: "flex-start" }]}>
          <Text style={[st.h1, { flex: 1, paddingRight: 10 }]}>{mv.title}</Text>
          <Pressable onPress={toggleFav} hitSlop={10} style={{ marginTop: 10 }}>
            <Text style={{ fontSize: 22, color: fav ? C.red : C.muted }}>{fav ? "♥" : "♡"}</Text>
          </Pressable>
        </View>
        <Text style={{ color: C.muted, fontSize: 12, marginBottom: 12 }}>
          {mv.year ?? ""}
          {mv.rating ? ` · ★ ${mv.rating.toFixed(1)}` : ""}
          {mv.duration ? ` · ${Math.round(mv.duration / 60)} Min.` : ""}
          {watched ? " · ✓ gesehen" : ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Pressable style={st.btn} onPress={() => push({ name: "play", type: "movie", id: mv.id, title: mv.title, subtitle: mv.year ? String(mv.year) : "" })}>
            <Text style={st.btnText}>▶ Abspielen</Text>
          </Pressable>
          <Pressable style={[st.btn, { backgroundColor: C.surface }]} onPress={toggleWatched}>
            <Text style={st.btnText}>{watched ? "✓ Gesehen" : "Als gesehen markieren"}</Text>
          </Pressable>
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
      <Pressable style={{ flex: 1 }} onPress={() => (uiVisible ? setUiVisible(false) : wake())}>
        <VideoView player={player} style={{ flex: 1 }} nativeControls={false} contentFit="contain" allowsFullscreen />
      </Pressable>

      {buffering && (
        <View pointerEvents="none" style={st.playerSpinner}>
          <ActivityIndicator color={C.red} size="large" />
        </View>
      )}

      {uiVisible && (
        <>
          <View style={st.playerTop}>
            <Pressable onPress={leave} style={st.pbtn} hitSlop={8}>
              <Text style={{ color: C.text, fontSize: 18 }}>←</Text>
            </Pressable>
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
              <Pressable onPress={() => seekBy(-10)} style={st.pbtn} hitSlop={8}>
                <Text style={{ color: C.text }}>« 10</Text>
              </Pressable>
              <Pressable onPress={togglePlay} style={[st.pbtn, st.pbtnMain]} hitSlop={8}>
                <Text style={{ color: "#fff", fontSize: 22 }}>{playing ? "❚❚" : "▶"}</Text>
              </Pressable>
              <Pressable onPress={() => seekBy(10)} style={st.pbtn} hitSlop={8}>
                <Text style={{ color: C.text }}>10 »</Text>
              </Pressable>
              {nextEp && (
                <Pressable onPress={playNext} style={st.pbtn} hitSlop={8}>
                  <Text style={{ color: C.text }}>Nächste ▶</Text>
                </Pressable>
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
  btn: { backgroundColor: C.red, borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11, alignItems: "center" },
  btnText: { color: "#fff", fontWeight: "700" },
  iconBtn: { backgroundColor: C.surface, borderRadius: 10, paddingHorizontal: 10, justifyContent: "center" },
  avatar: { width: 80, height: 80, borderRadius: 14, backgroundColor: C.red, alignItems: "center", justifyContent: "center" },
  poster: { width: 105, height: 158, borderRadius: 10, backgroundColor: C.surface },
  wideImg: { width: 190, height: 107, borderRadius: 10, backgroundColor: C.surface },
  progressBg: { position: "absolute", left: 0, right: 0, bottom: 40, height: 3, backgroundColor: "#ffffff33", borderRadius: 2 },
  progressFg: { height: 3, backgroundColor: C.red, borderRadius: 2 },
  tab: { backgroundColor: C.surface, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  epRow: { flexDirection: "row", gap: 10, backgroundColor: C.bg2, borderRadius: 12, padding: 10, alignItems: "center" },
  epImg: { width: 110, height: 62, borderRadius: 8, backgroundColor: C.surface },
  backBtn: { position: "absolute", top: 50, left: 14, backgroundColor: "#00000088", borderRadius: 10, padding: 8, zIndex: 5 },
  playerTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, paddingTop: 48, backgroundColor: "#000000aa" },
  playerBottom: { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 30, backgroundColor: "#000000cc" },
  pbtn: { backgroundColor: "#ffffff22", borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, justifyContent: "center" },
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

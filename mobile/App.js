/**
 * ══════════════════════════════════════════════════════════════════════════
 *  GHGFlix — Handy und Fernseher
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Der Aufbau folgt genau der Desktop-App: links die Navigation, rechts der
 * Inhalt. Wer die Desktop-Fassung kennt, findet sich hier sofort zurecht —
 * das war die ausdrückliche Vorgabe („so wie in Plex, so wie bei Jellyfin,
 * so wie in der Desktop-App").
 *
 * WO WAS STEHT
 *   src/fokus-kern.js   Auswahl-Logik der Fernbedienung (ohne React, testbar)
 *   src/fokus.js        Verbindung dieser Logik mit React Native
 *   src/stile.js        Farben und Maße, aus der Desktop-App übernommen
 *   src/bausteine.js    Kacheln, Reihen, Kopfbild, Dialoge
 *   src/seitenleiste.js die Navigation links
 *   src/seiten.js       Start, Filme, Serien, Liste, Suche, Einstellungen
 *   src/player.js       Wiedergabe
 *   src/netzsuche.js    findet den Server im Heimnetz von selbst
 *   src/verbindung.js   erster Bildschirm, falls noch kein Server bekannt
 *
 * Diese Datei hält nur noch alles zusammen: Verbindung, Navigation, Daten.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { StatusBar } from "expo-status-bar";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BackHandler, Text, View } from "react-native";

import { FokusProvider, useFokusSystem } from "./src/fokus.js";
import { Laden, se } from "./src/bausteine.js";
import { Seitenleiste, Unterleiste } from "./src/seitenleiste.js";
import { PlayerScreen } from "./src/player.js";
import { VerbindungsScreen } from "./src/verbindung.js";
import { normUrl, ping } from "./src/netzsuche.js";
import { pruefeUpdate, starteUpdate } from "./src/update.js";
import { laden as ladeEinstellungen } from "./src/einstellungen.js";
import { C, M, istHandy, st } from "./src/stile.js";
import {
  EinstellungenSeite, FilmSeite, ProfilSeite, RasterSeite,
  SerienSeite, StartSeite, SuchSeite,
} from "./src/seiten.js";

const APP_VERSION = "3.1.0";

/* ══ Absturzfang ═════════════════════════════════════════════════════════
 * Stürzt irgendwo etwas ab, soll der Bildschirm nicht schwarz bleiben,
 * sondern die Ursache anzeigen. Am Fernseher gibt es sonst keinerlei
 * Anhaltspunkt, was schiefging — genau das hat früher Wochen gekostet.
 */
class Absturzfang extends React.Component {
  constructor(p) { super(p); this.state = { fehler: null }; }
  static getDerivedStateFromError(fehler) { return { fehler }; }
  componentDidCatch(fehler, info) {
    AsyncStorage.setItem(
      "ghgflix.absturz",
      JSON.stringify({
        zeit: Date.now(),
        text: String(fehler?.message || fehler),
        stapel: info?.componentStack,
      }),
    ).catch(() => {});
  }
  render() {
    if (!this.state.fehler) return this.props.children;
    return (
      <View style={[st.center, { padding: 28 }]}>
        <Text style={[st.h2, { marginBottom: 12, textAlign: "center" }]}>
          Da ist etwas schiefgelaufen
        </Text>
        <Text style={[st.gedaempft, { textAlign: "center" }]}>
          {String(this.state.fehler?.message || this.state.fehler)}
        </Text>
        <Text style={[st.gedaempft, { marginTop: 18, textAlign: "center", fontSize: M.klein }]}>
          App schließen und neu öffnen. Bleibt es dabei, hilft{"\n"}
          scripts\tv-log-holen.ps1 auf dem PC weiter.
        </Text>
      </View>
    );
  }
}

/* ══ Verbindungsdaten ════════════════════════════════════════════════════ */

const CONN_KEY = "ghgflix.conn";
const standardConn = { list: [], manualUrl: "", token: "", profile: 0 };

async function ladeConn() {
  try {
    const roh = await AsyncStorage.getItem(CONN_KEY);
    return roh ? { ...standardConn, ...JSON.parse(roh) } : { ...standardConn };
  } catch {
    return { ...standardConn };
  }
}
const sichereConn = (c) => AsyncStorage.setItem(CONN_KEY, JSON.stringify(c)).catch(() => {});

/* ══ Hauptteil ═══════════════════════════════════════════════════════════ */

function AppInner() {
  const [conn, setConn] = useState(null);
  const [basis, setBasis] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [pruefe, setPruefe] = useState(true);
  const [seite, setSeite] = useState("home");
  const [stapel, setStapel] = useState([]);      // Detailseiten über der Hauptseite
  const [navOffen, setNavOffen] = useState(false);

  /* Wo die Navigation sitzt: unten (Handy) oder seitlich (Fernseher).
     Vorbelegt aus der Geräteart, damit schon der allererste Aufbau richtig
     ist und nichts sichtbar umspringt; die gespeicherte Einstellung kann das
     unten überschreiben. */
  const [navUnten, setNavUnten] = useState(istHandy);

  const [lib, setLib] = useState(null);
  const [weiter, setWeiter] = useState([]);
  const [verlauf, setVerlauf] = useState([]);
  const [favoriten, setFavoriten] = useState([]);
  const [profile, setProfile] = useState([]);
  const [appAktuell, setAppAktuell] = useState(null);

  const oben = stapel[stapel.length - 1] || null;
  const push = useCallback((s) => setStapel((alt) => [...alt, s]), []);
  const pop = useCallback(() => setStapel((alt) => alt.slice(0, -1)), []);

  /* ── Zurück-Taste ─────────────────────────────────────────────────── */
  useEffect(() => {
    const ab = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stapel.length > 0) { pop(); return true; }
      if (seite !== "home") { setSeite("home"); return true; }
      return false;
    });
    return () => ab.remove();
  }, [stapel.length, seite, pop]);

  /* ── Verbindung herstellen ────────────────────────────────────────── */
  const verbinden = useCallback(async (c) => {
    setPruefe(true);
    const kandidaten = [c.manualUrl, ...(c.list || []).map((e) => e.url)].filter(Boolean);
    for (const u of kandidaten) {
      const r = await ping(normUrl(u), 3000);
      if (r) {
        setBasis(normUrl(u));
        setServerInfo(r);
        setPruefe(false);
        return true;
      }
    }
    setBasis(null);
    setPruefe(false);
    return false;
  }, []);

  useEffect(() => {
    // Einstellungen zuerst laden — der Player greift ohne Warten darauf zu
    ladeEinstellungen()
      .then((E) => {
        // "auto" richtet sich nach dem Gerät, sonst gilt die Wahl des Nutzers.
        const w = E?.navigation || "auto";
        setNavUnten(w === "auto" ? istHandy : w === "unten");
      })
      .catch(() => {});
    ladeConn().then((c) => { setConn(c); verbinden(c); });
  }, [verbinden]);

  /* Beim Start nachsehen, ob auf dem Server eine neuere App-Fassung liegt.
     Damit entfaellt das laestige Eintippen der Adresse im Downloader. */
  useEffect(() => {
    if (!basis) return;
    ladeEinstellungen().then((E) => {
      if (E.updatePruefen === false) return;
      pruefeUpdate(api, APP_VERSION).then(setAppAktuell).catch(() => {});
    });
  }, [basis, api]);

  /* ── Serverzugriff ────────────────────────────────────────────────── */
  const api = useCallback(
    async (pfad, opt = {}) => {
      if (!basis) throw new Error("offline");
      const tr = pfad.includes("?") ? "&" : "?";
      let url = `${basis}${pfad}${tr}profile=${conn?.profile || 1}`;
      if (conn?.token) url += `&token=${conn.token}`;
      const res = await fetch(url, {
        method: opt.method || "GET",
        headers: opt.body ? { "Content-Type": "application/json" } : {},
        body: opt.body ? JSON.stringify(opt.body) : undefined,
      });
      return res.json();
    },
    [basis, conn],
  );

  const img = useCallback(
    (pfad, groesse = "w500") =>
      pfad
        ? `${basis}/api/img?path=${encodeURIComponent(pfad)}&size=${groesse}&profile=1${
            conn?.token ? `&token=${conn.token}` : ""
          }`
        : null,
    [basis, conn],
  );

  const aendereConn = useCallback(
    async (teil) => {
      const naechste = { ...conn, ...teil };
      setConn(naechste);
      await sichereConn(naechste);
      return naechste;
    },
    [conn],
  );

  /* ── Daten laden ──────────────────────────────────────────────────── */
  const datenLaden = useCallback(() => {
    if (!basis || !conn?.profile) return;
    api("/api/library").then(setLib).catch(() => setLib({ shows: [], movies: [] }));
    api("/api/continue").then((c) => setWeiter(Array.isArray(c) ? c : [])).catch(() => {});
    api("/api/history").then((h) => setVerlauf(Array.isArray(h) ? h : [])).catch(() => {});
    api("/api/favorites").then((f) => setFavoriten(Array.isArray(f) ? f : [])).catch(() => {});
    api("/api/profiles").then((p) => setProfile(Array.isArray(p) ? p : [])).catch(() => {});
  }, [api, basis, conn?.profile]);

  useEffect(datenLaden, [datenLaden]);

  /* Nach dem Verlassen einer Detailseite den Fortschritt auffrischen,
     damit „Weiterschauen“ sofort stimmt. */
  const stapelHoehe = stapel.length;
  useEffect(() => {
    if (stapelHoehe !== 0 || !basis || !conn?.profile) return;
    api("/api/continue").then((c) => setWeiter(Array.isArray(c) ? c : [])).catch(() => {});
    api("/api/history").then((h) => setVerlauf(Array.isArray(h) ? h : [])).catch(() => {});
    api("/api/favorites").then((f) => setFavoriten(Array.isArray(f) ? f : [])).catch(() => {});
  }, [stapelHoehe, api, basis, conn?.profile]);

  /* ── Navigation ───────────────────────────────────────────────────── */
  const aufTitel = useCallback(
    (x) => {
      const typ = x._t || (x.seasons != null || x.mediaType === "show" ? "show" : "movie");
      push(typ === "show" ? { name: "show", id: x.id } : { name: "movie", id: x.id });
    },
    [push],
  );

  const aufAbspielen = useCallback(
    (x) => {
      // Aus „Weiterschauen“/Verlauf kommen Einträge mit mediaType/refId
      if (x.mediaType && x.refId != null) {
        push({
          name: "play", type: x.mediaType, id: x.refId, title: x.title,
          subtitle: x.mediaType === "episode" && x.season != null ? se(x.season, x.episode) : "",
        });
        return;
      }
      // Aus dem Kopfbild: Film sofort abspielen, Serie zur Übersicht
      if ((x._t || "") === "show" || x.seasons != null) push({ name: "show", id: x.id });
      else push({ name: "play", type: "movie", id: x.id, title: x.title, subtitle: "" });
    },
    [push],
  );

  const spielAus = useCallback((p) => push({ name: "play", ...p }), [push]);

  /* ── Frühe Zustände ───────────────────────────────────────────────── */
  if (!conn || pruefe) return <Laden text="Server wird gesucht …" />;

  if (!basis || seite === "verbindung") {
    return (
      <VerbindungsScreen
        conn={conn}
        aufAbbruch={basis ? () => setSeite("settings") : null}
        aufSpeichern={async (teil) => {
          const naechste = await aendereConn(teil);
          await verbinden(naechste);
          setSeite("home");
          setStapel([]);
        }}
      />
    );
  }

  if (!conn.profile) {
    return <ProfilSeite api={api} aufWahl={(id) => aendereConn({ profile: id })} />;
  }

  /* ── Player läuft im Vollbild, ohne Seitenleiste ──────────────────── */
  if (oben?.name === "play") {
    return (
      <PlayerScreen
        api={api} pop={pop} push={push} base={basis} conn={conn}
        type={oben.type} id={oben.id} title={oben.title}
        subtitle={oben.subtitle} nextEp={oben.nextEp}
      />
    );
  }

  const profilName = profile.find((p) => p.id === conn.profile)?.name;

  /* ── Inhalt bestimmen ─────────────────────────────────────────────── */
  let inhalt;
  if (oben?.name === "show") {
    inhalt = (
      <SerienSeite
        api={api} img={img} id={oben.id} startStaffel={oben.season}
        aufAbspielen={spielAus} aufZurueck={pop}
      />
    );
  } else if (oben?.name === "movie") {
    inhalt = <FilmSeite api={api} img={img} id={oben.id} aufAbspielen={spielAus} aufZurueck={pop} />;
  } else if (seite === "home") {
    inhalt = (
      <StartSeite
        lib={lib} weiter={weiter} verlauf={verlauf} favoriten={favoriten}
        img={img} aufTitel={aufTitel} aufAbspielen={aufAbspielen}
      />
    );
  } else if (seite === "movies") {
    inhalt = (
      <RasterSeite
        titel="Filme" img={img} aufTitel={aufTitel}
        items={lib ? (lib.movies || []).map((x) => ({ ...x, _t: "movie" })) : null}
        leerText="Noch keine Filme eingelesen."
      />
    );
  } else if (seite === "shows") {
    inhalt = (
      <RasterSeite
        titel="Serien" img={img} aufTitel={aufTitel}
        items={lib ? (lib.shows || []).map((x) => ({ ...x, _t: "show" })) : null}
        leerText="Noch keine Serien eingelesen."
      />
    );
  } else if (seite === "list") {
    const meine = lib
      ? favoriten
          .map((f) =>
            f.mediaType === "show"
              ? { ...((lib.shows || []).find((s) => s.id === f.refId) || {}), _t: "show" }
              : { ...((lib.movies || []).find((m) => m.id === f.refId) || {}), _t: "movie" },
          )
          .filter((x) => x.id)
      : null;
    inhalt = (
      <RasterSeite
        titel="Meine Liste" items={meine} img={img} aufTitel={aufTitel}
        leerText={'Noch nichts vorgemerkt.\nAuf einer Detailseite „Zu meiner Liste“ wählen.'}
      />
    );
  } else if (seite === "search") {
    inhalt = <SuchSeite lib={lib} img={img} aufTitel={aufTitel} />;
  } else if (seite === "profiles") {
    inhalt = (
      <ProfilSeite
        api={api}
        aufWahl={(id) => { aendereConn({ profile: id }); setSeite("home"); }}
        aufZurueck={() => setSeite("home")}
      />
    );
  } else {
    inhalt = (
      <EinstellungenSeite
        conn={conn} base={basis} serverInfo={serverInfo}
        profilName={profilName} version={APP_VERSION} appAktuell={appAktuell}
        aufUpdate={() => starteUpdate(basis, appAktuell?.url || "/apk", conn?.token)}
        aufServerAendern={() => setSeite("verbindung")}
        aufProfilWechseln={() => setSeite("profiles")}
        aufNeuEinlesen={() => api("/api/scan", { method: "POST", body: {} }).catch(() => {})}
        aufAbmelden={async () => {
          await aendereConn({ profile: 0 });
          setSeite("home");
        }}
      />
    );
  }

  const zahlen = {
    movies: lib?.movies?.length,
    shows: lib?.shows?.length,
    list: favoriten?.length || undefined,
  };
  const wechsle = (s) => { setStapel([]); setSeite(s); };

  /* ── Handy: Navigation unten, Inhalt darüber ───────────────────────
     Die Leiste wird bei offener Detailseite NICHT ausgeblendet — man soll
     jederzeit umschalten können, ohne vorher zurückzugehen (so machen es
     Netflix und Disney+ ebenfalls). */
  if (navUnten) {
    return (
      <View style={st.wurzelHandy}>
        <StatusBar style="light" />
        <View style={st.inhalt}>{inhalt}</View>
        <Unterleiste seite={oben ? null : seite} aufSeite={wechsle} zahlen={zahlen} />
      </View>
    );
  }

  /* ── Fernseher: Seitenleiste, fährt bei Fokus aus ──────────────────── */
  return (
    <View style={st.wurzel}>
      <StatusBar style="light" hidden />
      <NavBeobachter aufOffen={setNavOffen} />
      <Seitenleiste
        seite={oben ? null : seite}
        aufSeite={wechsle}
        zahlen={zahlen}
        profilName={profilName}
        version={APP_VERSION}
        offen={navOffen}
      />
      <View style={st.inhalt}>{inhalt}</View>
    </View>
  );
}

/**
 * Fährt die Seitenleiste aus, sobald die Auswahl in ihr steht.
 *
 * Steckt in einer eigenen Komponente, weil sie den Fokus-Kontext braucht —
 * den gibt es erst unterhalb von <FokusProvider>.
 */
function NavBeobachter({ aufOffen }) {
  const sys = useFokusSystem();
  const letzterRef = useRef(false);
  useEffect(() => {
    if (!sys) return;
    const t = setInterval(() => {
      const drin = sys.kern.aktivesElement?.bereich === "nav";
      if (drin !== letzterRef.current) {
        letzterRef.current = drin;
        aufOffen(drin);
      }
    }, 120);
    return () => clearInterval(t);
  }, [sys, aufOffen]);
  return null;
}

export default function App() {
  return (
    <Absturzfang>
      <View style={{ flex: 1, backgroundColor: C.bg }}>
        <FokusProvider>
          <AppInner />
        </FokusProvider>
      </View>
    </Absturzfang>
  );
}

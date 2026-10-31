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
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";

import { FokusProvider, useFokusSystem } from "./src/fokus.js";
import { Knopf, Laden, se } from "./src/bausteine.js";
import { Seitenleiste, Unterleiste } from "./src/seitenleiste.js";
import { useKanalmeldungen } from "./src/kanalmeldungen.js";
import { useNativePushNavigation } from "./src/native-push.js";
import { KanaeleSeite } from "./src/kanaele.js";
import { PlayerScreen } from "./src/player.js";
import { AccountScreen } from "./src/AccountScreen.js";
import { VerbindungsScreen } from "./src/verbindung.js";
import { normUrl, ping } from "./src/netzsuche.js";
import { pruefeUpdate, starteUpdate } from "./src/update.js";
import { laden as ladeEinstellungen } from "./src/einstellungen.js";
import { C, M, istTV, st } from "./src/stile.js";
import { APP_VERSION } from "./src/produkt.js";
import { HandyShell } from "./src/HandyShell.js";
import { TVShell } from "../tv/src/TVShell.js";
import {
  EinstellungenSeite, FilmSeite, ProfilSeite, RasterSeite,
  SerienSeite, StartSeite, SuchSeite,
} from "./src/seiten.js";


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
const standardConn = { list: [], manualUrl: "", token: "", serverToken: "", profile: 0 };

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
  const sys = useFokusSystem();
  const [conn, setConn] = useState(null);
  const [basis, setBasis] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [pruefe, setPruefe] = useState(true);
  const [seite, setSeite] = useState("home");
  const [stapel, setStapel] = useState([]);      // Detailseiten über der Hauptseite

  const [datenFehler, setDatenFehler] = useState(null);
  const [ansichtNr, setAnsichtNr] = useState(0);
  const rueckspruenge = useRef([]);

  const [lib, setLib] = useState(null);
  const [weiter, setWeiter] = useState([]);
  const [verlauf, setVerlauf] = useState([]);
  const [favoriten, setFavoriten] = useState([]);
  const [profile, setProfile] = useState([]);
  const [appAktuell, setAppAktuell] = useState(null);
  const [kanalRevision, setKanalRevision] = useState(0);
  const [account,setAccount]=useState(null),[authChecked,setAuthChecked]=useState(false);
  const identityRef=useRef('');identityRef.current=`${basis}:${conn?.token}:${conn?.profile}`;
  useNativePushNavigation(account && conn?.profile ? serverInfo?.id : null,
    () => { setStapel([]); setSeite("channels"); setKanalRevision(v => v+1); },
    () => setKanalRevision(v => v+1));

  const oben = stapel[stapel.length - 1] || null;
  const push = useCallback((s) => {
    const e = sys?.kern.aktivesElement;
    if (!s.replace) rueckspruenge.current.push(e ? { bereich: e.bereich, zeile: e.zeile, spalte: e.spalte } : undefined);
    sys?.kern.vormerken();
    setStapel((alt) => [...(s.replace ? alt.slice(0, -1) : alt), s]);
  }, [sys]);
  const pop = useCallback(() => {
    sys?.kern.vormerken(rueckspruenge.current.pop());
    setStapel((alt) => alt.slice(0, -1));
  }, [sys]);

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
    ladeEinstellungen().catch(() => {});
    ladeConn().then((c) => { setConn(c); verbinden(c); });
  }, [verbinden]);

  /* ── Serverzugriff ────────────────────────────────────────────────── */
  const api = useCallback(
    async (pfad, opt = {}) => {
      if (!basis) throw new Error("offline");
      const identity=identityRef.current;
      const tr = pfad.includes("?") ? "&" : "?";
      let url = `${basis}${pfad}${tr}profile=${conn?.profile || 0}`;
      if (conn?.token) url += `&token=${conn.token}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
      const res = await fetch(url, {
        method: opt.method || "GET",
        signal: controller.signal,
        headers: opt.body ? { "Content-Type": "application/json" } : {},
        body: opt.body ? JSON.stringify(opt.body) : undefined,
      });
      const data = await res.json();
      if(identity!==identityRef.current)throw new Error('Profil wurde gewechselt.');
      if (!res.ok) {
        if(res.status===401 && data?.code!=='invalid_credentials' && !pfad.endsWith('/login')) {
          setAccount(null);setStapel([]);setLib(null);setWeiter([]);setVerlauf([]);setFavoriten([]);setProfile([]);
          if(conn?.serverToken && conn.token!==conn.serverToken) {
            const next={...conn,token:conn.serverToken,profile:0};setConn(next);void sichereConn(next);
          }
        }
        throw Object.assign(new Error(data?.error || `Serverfehler (${res.status})`),{status:res.status,code:data?.code});
      }
      return data;
      } finally { clearTimeout(timeout); }
    },
    [basis, conn],
  );

  const kanalUngelesen = useKanalmeldungen(api, !!basis && !!account && !account.profile?.is_child && !!conn?.profile, kanalRevision);

  const img = useCallback(
    (pfad, groesse = "w500") =>
      globalThis.__GHG_PREVIEW_IMAGE__ ? globalThis.__GHG_PREVIEW_IMAGE__(pfad, groesse) :
      pfad
        ? `${basis}/api/img?path=${encodeURIComponent(pfad)}&size=${groesse}&profile=${conn?.profile||0}${
            conn?.token ? `&token=${conn.token}` : ""
          }`
        : null,
    [basis, conn],
  );

  useEffect(() => {
    let cancelled = false;
    setAppAktuell(null);
    if (!basis || istTV) return;
    ladeEinstellungen().then(async (E) => {
      if (E.updatePruefen === false || cancelled) return;
      const result = await pruefeUpdate(api, APP_VERSION, { isTV: istTV });
      if (!cancelled) setAppAktuell(result);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [basis, api]);

  const aendereConn = useCallback(
    async (teil) => {
      const naechste = { ...conn, ...teil };
      setConn(naechste);
      await sichereConn(naechste);
      return naechste;
    },
    [conn],
  );

  useEffect(()=>{
    if(!basis||!conn)return;
    let active=true;setAuthChecked(false);
    api('/api/accounts/me').then(data=>{if(!active)return;setAccount(data);
      if(conn.profile!==(data.profile?.id||0))void aendereConn({profile:data.profile?.id||0});
    }).catch(()=>{if(active)setAccount(null);}).finally(()=>{if(active)setAuthChecked(true);});
    return()=>{active=false;};
  },[api,basis]);
  const acceptAccount=async(data)=>{
    setStapel([]);setLib(null);setWeiter([]);setVerlauf([]);setFavoriten([]);setProfile([]);setSeite('home');
    await aendereConn({serverToken:conn.serverToken||conn.token,token:data.token,profile:data.profile?.id||0});setAccount(data);
  };
  const selectProfile=async(profile)=>{
    setStapel([]);setLib(null);setWeiter([]);setVerlauf([]);setFavoriten([]);setSeite('home');
    await aendereConn({profile:profile.id});setAccount(old=>({...old,profile}));
  };
  const logout=async()=>{
    try{const known=JSON.parse(await AsyncStorage.getItem('ghgflix.push.'+serverInfo?.id)||'[]');await api('/api/accounts/logout',{method:'POST',body:{nativePushTokens:known}});await AsyncStorage.removeItem('ghgflix.push.'+serverInfo?.id);}finally{
      setAccount(null);setStapel([]);setLib(null);setWeiter([]);setVerlauf([]);setFavoriten([]);setProfile([]);
      await aendereConn({token:conn.serverToken||'',profile:0});setSeite('home');
    }
  };

  /* ── Daten laden ──────────────────────────────────────────────────── */
  const datenLaden = useCallback(() => {
    if (!basis || !conn?.profile || !account) return;
    setDatenFehler(null);
    api("/api/library").then(setLib).catch((e) => setDatenFehler(e.message || "Die Mediathek konnte nicht geladen werden."));
    api("/api/continue").then((c) => setWeiter(Array.isArray(c) ? c : [])).catch(() => {});
    api("/api/history").then((h) => setVerlauf(Array.isArray(h) ? h : [])).catch(() => {});
    api("/api/favorites").then((f) => setFavoriten(Array.isArray(f) ? f : [])).catch(() => {});
    const refreshProfiles=()=>api("/api/profiles").then(p=>setProfile(Array.isArray(p)?p:[])).catch(()=>{});
    refreshProfiles();const profileTimer=setInterval(refreshProfiles,15000);
    return()=>clearInterval(profileTimer);
  }, [api, basis, conn?.profile, account]);

  useEffect(datenLaden, [datenLaden]);

  /* Nach dem Verlassen einer Detailseite den Fortschritt auffrischen,
     damit „Weiterschauen“ sofort stimmt. */
  const stapelHoehe = stapel.length;
  useEffect(() => {
    if (stapelHoehe !== 0 || !basis || !conn?.profile || !account) return;
    api("/api/continue").then((c) => setWeiter(Array.isArray(c) ? c : [])).catch(() => {});
    api("/api/history").then((h) => setVerlauf(Array.isArray(h) ? h : [])).catch(() => {});
    api("/api/favorites").then((f) => setFavoriten(Array.isArray(f) ? f : [])).catch(() => {});
  }, [stapelHoehe, api, basis, conn?.profile, account]);

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
          showId: x.showId,
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
          const naechste = await aendereConn({...teil,serverToken:teil.token||"",profile:0});
          setAccount(null);
          await verbinden(naechste);
          setSeite("home");
          setStapel([]);
        }}
      />
    );
  }

  if(!authChecked)return <Laden text="Account wird geprüft …"/>;
  if(!account)return <AccountScreen api={api} onRefresh={async()=>setAccount(await api('/api/accounts/me'))} onSession={acceptAccount} onServer={()=>setSeite('verbindung')}/>;
  if (!conn.profile) {
    return <ProfilSeite base={basis} api={api} account={account.account} activeProfile={account.profile} aufWahl={selectProfile} aufAbmelden={logout} onRefresh={async()=>setAccount(await api('/api/accounts/me'))} onSession={acceptAccount}/>;
  }
  if(account.profile?.is_child && ['channels','settings'].includes(seite))return <ProfilSeite base={basis} api={api} account={account.account} activeProfile={account.profile} aufWahl={selectProfile} aufAbmelden={logout} onRefresh={async()=>setAccount(await api('/api/accounts/me'))} onSession={acceptAccount} aufZurueck={()=>setSeite('home')}/>;

  /* ── Player läuft im Vollbild, ohne Seitenleiste ──────────────────── */
  if (oben?.name === "play") {
    return (
      <PlayerScreen
        api={api} pop={pop} push={push} base={basis} conn={conn}
        type={oben.type} id={oben.id} title={oben.title}
        subtitle={oben.subtitle} nextEp={oben.nextEp} showId={oben.showId}
      />
    );
  }

  const aktivesProfil = profile.find(p => p.id === conn.profile) || (profile.length===1?profile[0]:null);
  const profilName = aktivesProfil?.name;
  const profilAvatar = aktivesProfil?.avatar;

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
  } else if (seite === "channels") {
    inhalt = <KanaeleSeite key={`${basis}:${conn.profile}`} api={api} serverId={serverInfo?.id} onChange={() => setKanalRevision((v) => v + 1)} />;
  } else if (seite === "profiles") {
    inhalt = (
      <ProfilSeite
        base={basis}
        api={api}
        aufWahl={selectProfile} account={account.account} activeProfile={account.profile} aufAbmelden={logout} onRefresh={async()=>setAccount(await api('/api/accounts/me'))} onSession={acceptAccount}
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
        aufAbmelden={logout}
      />
    );
  }

  const zahlen = {
    movies: lib?.movies?.length,
    shows: lib?.shows?.length,
    list: favoriten?.length || undefined,
    channels: kanalUngelesen || undefined,
  };
  const wechsle = (s) => {
    sys?.kern.vormerken();
    rueckspruenge.current = [];
    setAnsichtNr((n) => n + 1); setStapel([]); setSeite(s);
  };

  if (datenFehler && !oben) inhalt = (
    <View style={[st.center, { padding: M.rand, gap: 18 }]}>
      <Text style={st.h2}>Mediathek nicht erreichbar</Text>
      <Text style={[st.gedaempft, { textAlign: "center" }]}>{datenFehler}</Text>
      <Knopf text="Erneut versuchen" haupt spalte={0} zeile={0} onPress={datenLaden} />
      <Knopf text="Server wechseln" spalte={1} zeile={0} onPress={() => wechsle("verbindung")} />
    </View>
  );
  const ansicht = <View key={`${seite}:${oben?.name || "root"}:${oben?.id || ""}:${stapel.length}:${ansichtNr}`} style={{ flex: 1 }}>{inhalt}</View>;
  const Shell = istTV ? TVShell : HandyShell;
  return <Shell child={!!account.profile?.is_child} seite={seite} aufSeite={wechsle} zahlen={zahlen} profilName={profilName} profilAvatar={profilAvatar}>{ansicht}</Shell>;
}

export default function App() {
  return (
    <Absturzfang>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
          <StatusBar style="light" hidden={istTV} />
          <FokusProvider aktiv={istTV}>
            <AppInner />
          </FokusProvider>
        </SafeAreaView>
      </SafeAreaProvider>
    </Absturzfang>
  );
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 *  VIDEOPLAYER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WAS VORHER NICHT GING
 * „Ich kann ihn überhaupt nicht steuern. Es ist ganz schwer, in diese
 *  Oberfläche reinzukommen, und dann kann man nichts machen."
 *
 * Der Grund: Die Bedienleiste hing an Androids eigenem View-Fokus. Über
 * einem formatfüllenden Video findet dessen geometrische Suche kaum einen
 * Weg dorthin, und ausgeblendete Knöpfe sind gar nicht erreichbar.
 *
 * WIE ES JETZT FUNKTIONIERT
 * Der Player benutzt dasselbe Fokus-System wie der Rest der App (fokus.js).
 * Die Bedienleiste ist ein festes Raster:
 *
 *     Zeile 0   [────────── Fortschrittsbalken ──────────]
 *     Zeile 1   [−10] [⏯] [+30] [Nächste] [Ton] [Untertitel] [Tempo] [Info]
 *
 * ← → auf dem Balken springen im Video (der Balken behält die Tasten für
 * sich, siehe aufRichtung im Fokus-Kern). ↑ ↓ wechseln zwischen Balken und
 * Knöpfen. Die Medientasten der Fernbedienung wirken immer, auch bei
 * ausgeblendeter Leiste.
 *
 * ── TON UND UNTERTITEL ────────────────────────────────────────────────────
 * Der Server meldet alle Spuren der Datei (server/src/spuren.js), inklusive
 * Untertiteldateien, die neben dem Video liegen. Umgeschaltet wird so:
 *
 *   Ton bei Direktwiedergabe    expo-video schaltet die eingebettete Spur um
 *   Ton beim Umwandeln          der Server bekommt &a=<Nummer>, der Strom
 *                               wird an derselben Stelle neu aufgebaut
 *   Untertitel immer            als Text vom Server geholt und selbst
 *                               gezeichnet — dadurch sofortiges Umschalten
 *                               und einstellbare Größe und Farbe
 *
 * ── WICHTIG ZUM ABSTURZ "NativeSharedObjectNotFoundException" ─────────────
 * expo-video gibt das native Player-Objekt frei, sobald der Bildschirm
 * verlassen wird. Jeder spätere Zugriff auf player.currentTime & Co. wirft
 * dann. Deshalb werden Position und Dauer fortlaufend in Refs gespiegelt und
 * NUR aus diesen gespeichert; jeder direkte Zugriff läuft über safe().
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Dimensions, Platform, Pressable, Text, View } from "react-native";
import { FKnopf, FokusReihe, useDialog, useFernbedienung, useFokusElement } from "./fokus.js";
import { PlayerKnopfleiste } from "./playerleiste.js";
import { folgenNach } from "./folgen.js";
import { C, M, gross, st } from "./stile.js";
import { Dialog, DialogListe, fmtZeit } from "./bausteine.js";
import { untertitelHolen } from "./untertitel.js";
import { jetzt as einstellungenJetzt, waehleTon, waehleUntertitel } from "./einstellungen.js";

/* ── expo-video vorsichtig laden ──────────────────────────────────────────
   Fehlt das Modul, soll die App eine verständliche Meldung zeigen statt
   beim Start wortlos abzustürzen (die Lehre aus dem expo-asset-Vorfall). */
let VideoView = null, useVideoPlayer = null, videoLadeFehler = null;
try {
  const v = require("expo-video");
  VideoView = v.VideoView;
  useVideoPlayer = v.useVideoPlayer;
  if (typeof useVideoPlayer !== "function") throw new Error("expo-video unvollständig geladen");
} catch (e) {
  videoLadeFehler = String(e?.message || e);
  useVideoPlayer = () => null;
}

let useKeepAwake = () => {};
try { useKeepAwake = require("expo-keep-awake").useKeepAwake; } catch {}

/* ════════════════════════════════════════════════════════════════════════ */

export function PlayerScreen(props) {
  const [attempt, setAttempt] = useState(0);
  const identity = JSON.stringify([props.base, props.conn?.profile, props.type, props.id, attempt]);
  return <PlayerSession key={identity} {...props} retry={() => setAttempt((n) => n + 1)} />;
}

function PlayerSession({ api, pop, push, base, conn, type, id, title, subtitle, showId, nextEp: initialNextEp, retry }) {
  useKeepAwake();
  const E = einstellungenJetzt();

  const [info, setInfo] = useState(null);
  const [resume, setResume] = useState(0);
  const [fehler, setFehler] = useState(null);
  const [nextEp, setNextEp] = useState(initialNextEp);
  const [folgenFehler, setFolgenFehler] = useState(false);
  const [folgenVersuch, setFolgenVersuch] = useState(0);
  const [leisteAn, setLeisteAn] = useState(true);
  const [laeuft, setLaeuft] = useState(true);
  const [puffert, setPuffert] = useState(true);
  const [pos, setPos] = useState(0);
  const [dauer, setDauer] = useState(0);
  const [balkenBreite, setBalkenBreite] = useState(0);
  const [bedienBreite, setBedienBreite] = useState(Dimensions.get("window").width - 2 * M.rand);
  const [dialog, setDialog] = useState(null);   // null | "ton" | "ut" | "tempo" | "bild" | "info"
  const [tempo, setTempo] = useState(E.tempo);
  const tempoRef = useRef(tempo);
  tempoRef.current = tempo;
  const [bildmodus, setBildmodus] = useState(E.bildmodus);

  // Spuren
  const [tonSpur, setTonSpur] = useState(null);
  const [utSpur, setUtSpur] = useState(null);
  const [utSucher, setUtSucher] = useState(null);
  const [utText, setUtText] = useState(null);
  const [utLaedt, setUtLaedt] = useState(false);

  const offsetRef = useRef(0);   // beim Umwandeln: Startpunkt des Datenstroms
  const modeRef = useRef("direct");
  const posRef = useRef(0);
  const durRef = useRef(0);
  const lebtRef = useRef(true);
  const versteckRef = useRef(null);
  const tonRef = useRef(null);   // aktuelle Tonspur für den Umwandel-Neustart
  const quelleRef = useRef(null);
  const ladeKette = useRef(Promise.resolve());
  const laufWunsch = useRef(true);
  const fortschrittRef = useRef(null); // only confirmed positions, never stale/loading events
  const hlsNeustartRef = useRef(0); // letzter HLS-Neustart (gegen Endlosschleifen)

  /** Jeder Zugriff auf das native Player-Objekt — niemals ungeschützt. */
  const safe = useCallback((fn, fallback = undefined) => {
    if (!lebtRef.current) return fallback;
    try { return fn(); } catch { return fallback; }
  }, []);

  useEffect(() => {
    lebtRef.current = true;
    return () => {
      lebtRef.current = false;
      if (versteckRef.current) clearTimeout(versteckRef.current);
    };
  }, []);

  /* ── Infos und gespeicherten Fortschritt holen ─────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [i, fortschritt] = await Promise.all([
        api(`/api/play/${type}/${id}`),
        api("/api/progress"),
      ]);
      if (cancelled || !lebtRef.current) return;
      if (!i || i.error || typeof i.directUrl !== "string" || typeof i.transcodeUrl !== "string") {
        throw new Error(i?.error || "Der Server hat keine gültigen Medieninformationen geliefert.");
      }
      const gemerkt = (Array.isArray(fortschritt) ? fortschritt : []).find((x) => x.mediaType === type && x.refId === +id);
      const bei =
        gemerkt && !gemerkt.watched && gemerkt.position > (E.fortsetzenAb || 30) &&
        gemerkt.position < (gemerkt.duration || 1e9) * 0.95
          ? gemerkt.position : 0;
      modeRef.current = i.direct ? "direct" : "transcode";
      offsetRef.current = i.direct ? 0 : bei;
      posRef.current = bei;
      durRef.current = Number.isFinite(i.duration) && i.duration > 0 ? i.duration : 0;

      // Spuren nach den Vorlieben vorbelegen
      const ton = waehleTon(i.spuren?.audio, E.tonSprache);
      tonRef.current = ton;
      setTonSpur(ton);
      const ut = waehleUntertitel(i.spuren?.sub, E.utSprache, E.utAn);
      setUtSpur(ut);

      setResume(bei);
      setDauer(durRef.current);
      setPos(bei);
      setInfo(i);
    })().catch((e) => {
      if (!cancelled && lebtRef.current) { setFehler(e.message || "Medien konnten nicht geladen werden."); setPuffert(false); }
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, type, id]);

  // Continue/history entries carry the show ID, but no prebuilt episode queue.
  useEffect(() => {
    if (type !== "episode" || !showId || initialNextEp !== undefined) return;
    let cancelled = false;
    setFolgenFehler(false);
    api(`/api/shows/${showId}`).then((data) => {
      if (!cancelled && lebtRef.current) setNextEp(folgenNach(data.seasons.flatMap((s) => s.episodes), +id));
    }).catch(() => { if (!cancelled && lebtRef.current) setFolgenFehler(true); });
    return () => { cancelled = true; };
  }, [api, type, id, showId, initialNextEp, folgenVersuch]);

  const quelleFuer = useCallback(
    (i, t) => {
      /* Die Adressen aus /api/play tragen den Zugangsschlüssel bereits in
         sich. Vorher wurde er ein ZWEITES Mal mit "?" angehängt — daraus
         wurde "…?x=1&token=ABC?token=ABC", und der Server las als Token den
         Text "ABC?token=ABC". Mit gesetztem Server-Passwort endete deshalb
         jede Wiedergabe am Handy in einem 401. */
      const dran = (url, zusatz) => `${base}${url}${url.includes("?") ? "&" : "?"}${zusatz}`;
      const profil = encodeURIComponent(conn?.profile ?? 1);
      if (modeRef.current === "direct") return dran(i.directUrl, `profile=${profil}`);
      const a = tonRef.current?.nr ?? 0;
      /* Punkt 2 der Übergabe: Auf iPhone und iPad spielt AVFoundation den
         endlosen fragmentierten MP4-Strom von /api/transcode NICHT ab — das
         Bild bleibt schwarz. Für Apple liefert der Server denselben Inhalt
         als HLS (siehe server/src/hls.js). */
      const weg = Platform.OS === "ios" && i.hlsUrl ? i.hlsUrl : i.transcodeUrl;
      return dran(weg, `profile=${profil}&a=${a}&t=${Math.floor(t)}`);
    },
    [base, conn?.profile],
  );

  const player = useVideoPlayer(null, (p) => {
    if (p) p.timeUpdateEventInterval = 0.25;   // flüssige Untertitel
  });

  // A replacement has its own identity. No old stream may update the new
  // offset, and iOS asset loading must not block the UI thread.
  const ladeQuelle = useCallback((i, target) => {
    if (!lebtRef.current || !i) return;
    const offset = modeRef.current === "direct" ? 0 : Math.floor(target);
    const raw = quelleFuer(i, target);
    const source = { uri: `${raw}${raw.includes("?") ? "&" : "?"}ghg_session=${(quelleRef.current?.generation ?? 0) + 1}`,
      generation: (quelleRef.current?.generation ?? 0) + 1, pending: true,
      seek: modeRef.current === "direct" ? target : 0, offset };
    quelleRef.current = source;
    offsetRef.current = offset;
    setPuffert(true); setFehler(null);
    safe(() => player.pause());
    const replace = async () => {
      if (!lebtRef.current || quelleRef.current !== source) return;
      try {
        if (player.replaceAsync) await player.replaceAsync(source.uri);
        else player.replace(source.uri);
        if (!lebtRef.current || quelleRef.current !== source) return;
        player.playbackRate = tempoRef.current;
        if (laufWunsch.current) player.play(); else player.pause();
      } catch (e) {
        if (lebtRef.current && quelleRef.current === source) { setFehler(e.message || "Wiedergabe konnte nicht geladen werden."); setPuffert(false); }
      }
    };
    ladeKette.current = ladeKette.current.then(replace, replace);
  }, [player, quelleFuer, safe]);

  /* ── Untertitel holen, sobald eine Spur gewählt ist ────────────────── */
  useEffect(() => {
    let abgebrochen = false;
    if (!utSpur || !info?.untertitelUrl) { setUtSucher(null); setUtText(null); return; }
    setUtLaedt(true);
    const tr = info.untertitelUrl.includes("?") ? "&" : "?";
    untertitelHolen(`${base}${info.untertitelUrl}${tr}track=${utSpur.id}`.replace(base + base, base))
      .then((s) => {
        if (abgebrochen) return;
        setUtSucher(s);
        setUtLaedt(false);
      })
      .catch(() => { if (!abgebrochen) setUtLaedt(false); });
    return () => { abgebrochen = true; };
  }, [utSpur, info, base]);

  /* ── Laufende Werte spiegeln ───────────────────────────────────────── */
  useEffect(() => {
    if (!player?.addListener) return;
    const abos = [];
    try {
      abos.push(player.addListener("sourceLoad", (e) => {
        const source = quelleRef.current;
        const uri = typeof e?.videoSource === "string" ? e.videoSource : e?.videoSource?.uri;
        if (!lebtRef.current || !source || uri !== source.uri) return;
        source.pending = false;
        if (!durRef.current && Number.isFinite(e.duration) && e.duration > 0) {
          durRef.current = source.offset + e.duration; setDauer(durRef.current);
        }
        safe(() => { player.currentTime = source.seek; player.playbackRate = tempoRef.current; });
        if (source.seek === 0) source.seek = null;
        safe(() => laufWunsch.current ? player.play() : player.pause());
        setLaeuft(laufWunsch.current);
        setPuffert(safe(() => player.status) !== "readyToPlay");
      }));
      abos.push(player.addListener("timeUpdate", () => {
        const source = quelleRef.current;
        if (!lebtRef.current || !source || source.pending) return;
        // Read current native state rather than a queued event from an old seek.
        const nativeTime = safe(() => player.currentTime);
        if (!Number.isFinite(nativeTime) || nativeTime < 0) return;
        if (source.seek != null) {
          if (Math.abs(nativeTime - source.seek) > 2) return;
          source.seek = null;
        }
        const p = source.offset + nativeTime;
        posRef.current = durRef.current ? Math.min(p, durRef.current) : p;
        setPos(posRef.current);
        if (durRef.current > 0) fortschrittRef.current = { position: posRef.current, duration: durRef.current };
      }));
      abos.push(player.addListener("playingChange", (e) => {
        if (!lebtRef.current || quelleRef.current?.pending) return;
        const playing = !!(typeof e === "object" ? e?.isPlaying : e);
        // isPlaying also becomes false while buffering. It is not a pause command.
        setLaeuft(safe(() => player.status) === "loading" ? laufWunsch.current : playing);
      }));
      abos.push(player.addListener("playToEnd", () => {
        if (!lebtRef.current || quelleRef.current?.pending) return;
        laufWunsch.current = false; setLaeuft(false);
      }));
      abos.push(player.addListener("statusChange", (e) => {
        if (!lebtRef.current) return;
        const s = typeof e === "object" ? e?.status : e;
        if (s === "loading") setPuffert(true);
        if (s === "readyToPlay" && !quelleRef.current?.pending) setPuffert(false);
        if (s !== "error" || !info) return;
        if (modeRef.current === "direct") {
          modeRef.current = "transcode";
          ladeQuelle(info, posRef.current);
        } else if (Platform.OS === "ios" && hlsNeustartRef.current === 0) {
          // One recovery attempt for an expired HLS session; never an endless loop.
          hlsNeustartRef.current = 1;
          ladeQuelle(info, posRef.current);
        } else {
          setPuffert(false);
          setFehler("Dieses Medium konnte nicht abgespielt werden. Bitte erneut versuchen.");
        }
      }));
    } catch {}
    return () => abos.forEach((a) => { try { a?.remove?.(); } catch {} });
  }, [player, info, ladeQuelle, safe]);

  // Subscribe before replacing: very fast/native cached loads can emit immediately.
  useEffect(() => {
    if (info) ladeQuelle(info, resume);
    // Loading is tied to the selected media, not to playback-rate changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, player, resume]);

  /* ── Untertiteltext zur aktuellen Stelle bestimmen ─────────────────── */
  useEffect(() => {
    if (!utSucher) { setUtText(null); return; }
    const neu = utSucher.beiZeit(pos, E.utVersatz || 0);
    setUtText((alt) => (alt === neu ? alt : neu));
  }, [pos, utSucher, E.utVersatz]);

  /* ── Fortschritt sichern ───────────────────────────────────────────── */
  const sichern = useCallback(
    () => {
      const confirmed = fortschrittRef.current;
      if (!confirmed) return;
      const { duration: d, position: p } = confirmed;
      api("/api/progress", {
        method: "POST",
        body: { mediaType: type, refId: +id, position: p, duration: d, watched: p >= d * 0.95 },
      }).catch(() => {});
    },
    [api, type, id],
  );
  useEffect(() => {
    const t = setInterval(() => sichern(), 10000);
    return () => { clearInterval(t); sichern(); };
  }, [sichern]);

  /* ── Bedienleiste ein- und ausblenden ──────────────────────────────── */
  const wecken = useCallback(() => {
    setLeisteAn(true);
    if (versteckRef.current) clearTimeout(versteckRef.current);
    const nach = (E.leisteAus ?? 5) * 1000;
    if (nach > 0) versteckRef.current = setTimeout(() => setLeisteAn(false), nach);
  }, [E.leisteAus]);
  useEffect(() => { wecken(); }, [wecken]);

  /* ── Steuerung ─────────────────────────────────────────────────────── */
  const springeAuf = useCallback((t) => {
    if (!info || !Number.isFinite(t)) return;
    const ziel = Math.max(0, Math.min(t, durRef.current || t));
    posRef.current = ziel;
    setPos(ziel);
    if (modeRef.current === "direct") {
      if (quelleRef.current) quelleRef.current.seek = ziel;
      if (!quelleRef.current?.pending) safe(() => { player.currentTime = ziel; });
    } else {
      ladeQuelle(info, ziel);
    }
    wecken();
  }, [player, info, ladeQuelle, safe, wecken]);

  const springeUm = useCallback((d) => springeAuf(posRef.current + d), [springeAuf]);

  const anHalten = useCallback(() => {
    const waiting = quelleRef.current?.pending || safe(() => player.status) === "loading";
    laufWunsch.current = !(waiting ? laufWunsch.current : safe(() => player.playing, laufWunsch.current));
    setLaeuft(laufWunsch.current);
    safe(() => laufWunsch.current ? player.play() : player.pause());
    wecken();
  }, [player, safe, wecken]);

  const verlassen = useCallback(() => {
    sichern();
    lebtRef.current = false;
    pop();
  }, [sichern, pop]);

  const naechsteFolge = useCallback(() => {
    if (!nextEp || !lebtRef.current) return;
    sichern();
    lebtRef.current = false;
    pop();
    push({
      name: "play", type: "episode", id: nextEp.id, title, showId,
      subtitle: (nextEp.se || "") + (nextEp.title ? " · " + nextEp.title : ""),
      nextEp: nextEp.next ?? null,
    });
  }, [nextEp, sichern, pop, push, title, showId]);

  /* Nächste Folge von selbst starten, wenn eingestellt. */
  const autoRef = useRef(false);
  useEffect(() => {
    if (!E.autoNaechste || !nextEp || autoRef.current) return;
    if (dauer > 0 && pos >= dauer * (E.autoNaechsteAb || 0.95)) {
      autoRef.current = true;
      naechsteFolge();
    }
  }, [pos, dauer, nextEp, naechsteFolge, E.autoNaechste, E.autoNaechsteAb]);

  /* ── Tonspur wechseln ──────────────────────────────────────────────── */
  const tonWaehlen = useCallback((kennung) => {
    const spur = (info?.spuren?.audio || []).find((s) => s.id === kennung);
    if (!spur) return;
    tonRef.current = spur;
    setTonSpur(spur);
    setDialog(null);

    if (modeRef.current === "direct") {
      /* Bei Direktwiedergabe schaltet expo-video die eingebettete Spur
         selbst um — ohne Neuladen und ohne Aussetzer. */
      safe(() => {
        const verfuegbar = player.availableAudioTracks || [];
        if (verfuegbar[spur.nr]) player.audioTrack = verfuegbar[spur.nr];
      });
      return;
    }
    /* Beim Umwandeln entscheidet der Server, welche Spur im Strom landet.
       Also an derselben Stelle neu anfordern — die Position bleibt erhalten. */
    ladeQuelle(info, posRef.current);
    wecken();
  }, [info, player, ladeQuelle, safe, wecken]);

  /* ── Untertitel wechseln ───────────────────────────────────────────── */
  const utWaehlen = useCallback((kennung) => {
    setDialog(null);
    if (kennung === "aus") { setUtSpur(null); setUtSucher(null); setUtText(null); return; }
    const spur = (info?.spuren?.sub || []).find((s) => s.id === kennung);
    if (spur) setUtSpur(spur);
    wecken();
  }, [info, wecken]);

  const setzeTempo = useCallback((v) => {
    setTempo(v);
    safe(() => { player.playbackRate = v; });
    setDialog(null);
  }, [player, safe]);

  /* ── Fernbedienung: Medientasten wirken immer ──────────────────────── */
  useFernbedienung((taste) => {
    switch (taste) {
      case "playPause": anHalten(); break;
      case "fastForward": springeUm(E.sprungVor || 30); break;
      case "rewind": springeUm(-(E.sprungZurueck || 10)); break;
      case "next": naechsteFolge(); break;
      case "previous": springeAuf(0); break;
      case "stop": verlassen(); break;
      case "info": setDialog((d) => (d === "info" ? null : "info")); break;
      default: wecken();
    }
  });

  useDialog(!!dialog);

  /* ── Fortschrittsbalken als Fokus-Element ──────────────────────────── */
  const balkenRichtung = useCallback((r) => {
    if (r === "left") { springeUm(-(E.sprungZurueck || 10)); return true; }
    if (r === "right") { springeUm(E.sprungVor || 30); return true; }
    return false;
  }, [springeUm, E.sprungVor, E.sprungZurueck]);

  const balkenAn = useFokusElement({
    bereich: "inhalt", zeile: 0, spalte: 0,
    onPress: anHalten,
    aufRichtung: balkenRichtung,
    id: "player:balken",
  });

  /* ── Anzeige ───────────────────────────────────────────────────────── */
  const anteil = dauer > 0 ? Math.min(1, Math.max(0, pos / dauer)) : 0;
  const tonListe = info?.spuren?.audio || [];
  const utListe = (info?.spuren?.sub || []).filter((s) => s.text && !s.bild);
  const utBildNur = (info?.spuren?.sub || []).filter((s) => s.bild).length;

  if (fehler) return <View style={[st.center, { padding: 30 }]}>
    <Text accessibilityRole="alert" style={st.fliess}>{fehler}</Text>
    <FKnopf zeile={0} spalte={0} onPress={retry} style={st.knopf} fokusStil={st.fokus}><Text style={st.knopfText}>Erneut versuchen</Text></FKnopf>
    <FKnopf zeile={1} spalte={0} onPress={verlassen} style={st.knopf} fokusStil={st.fokus}><Text style={st.knopfText}>Zurück</Text></FKnopf>
  </View>;

  if (videoLadeFehler || !VideoView) {
    return (
      <View style={[st.center, { padding: 30 }]}>
        <Text style={[st.h2, { textAlign: "center", marginBottom: 10 }]}>
          Wiedergabe nicht verfügbar
        </Text>
        <Text style={[st.gedaempft, { textAlign: "center", marginBottom: 20 }]}>
          Das Video-Modul konnte nicht geladen werden:{"\n"}{videoLadeFehler}
        </Text>
        <FKnopf onPress={pop} spalte={0} zeile={0} style={[st.knopf, st.knopfHaupt]} fokusStil={st.fokus}>
          <Text style={[st.knopfText, st.knopfTextHaupt]}>Zurück</Text>
        </FKnopf>
      </View>
    );
  }

  const knoepfe = [
    { id: "zurueck", label: "Zurückspulen", text: String(E.sprungZurueck || 10), symbol: "⏪", onPress: () => springeUm(-(E.sprungZurueck || 10)) },
    { id: "pause", label: laeuft ? "Pausieren" : "Abspielen", symbol: laeuft ? "⏸" : "▶", haupt: true, onPress: anHalten },
    { id: "vor", label: "Vorspulen", text: String(E.sprungVor || 30), symbol: "⏩", onPress: () => springeUm(E.sprungVor || 30) },
    nextEp && { id: "naechste", label: "Nächste Folge", text: "Nächste", symbol: "⏭", onPress: naechsteFolge },
    folgenFehler && { id: "folgen", label: "Folgenliste erneut laden", text: "Folgen laden", onPress: () => setFolgenVersuch((n) => n + 1) },
    tonListe.length > 1 && { id: "ton", label: "Tonspur", symbol: "🔊", text: "Ton", onPress: () => setDialog("ton") },
    (utListe.length > 0 || utBildNur > 0) && { id: "ut", label: "Untertitel", symbol: "💬", text: utSpur ? "UT an" : "UT", onPress: () => setDialog("ut") },
    { id: "tempo", label: "Geschwindigkeit", text: `${tempo}×`, onPress: () => setDialog("tempo") },
    { id: "bild", label: "Bildanpassung", symbol: "⛶", onPress: () => setDialog("bild") },
    { id: "info", label: "Wiedergabeinformationen", symbol: "ℹ", onPress: () => setDialog("info") },
  ].filter(Boolean);

  return (
    <View style={st.playerWurzel} onTouchStart={wecken} onLayout={(e) => setBedienBreite(Math.max(1, e.nativeEvent.layout.width - 2 * M.rand))}>
      <VideoView
        style={{ flex: 1 }}
        player={player}
        contentFit={bildmodus}
        nativeControls={false}
        allowsFullscreen={false}
        pointerEvents="none"
      />

      <Pressable testID="player-wecken" accessible={false} focusable={false}
        onPress={wecken} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} />

      {puffert && (
        <View pointerEvents="none" style={[st.center, { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "transparent" }]}>
          <ActivityIndicator size="large" color={C.red} />
        </View>
      )}

      {/* ── Untertitel ────────────────────────────────────────────────── */}
      {!!utText && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: "6%", right: "6%",
            bottom: leisteAn
              ? `${Math.round((E.utPosition ?? 0.08) * 100) + (gross ? 18 : 15)}%`
              : `${Math.round((E.utPosition ?? 0.08) * 100)}%`,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              color: E.utFarbe || "#ffffff",
              fontSize: (gross ? 30 : 17) * (E.utGroesse ?? 1),
              lineHeight: (gross ? 40 : 23) * (E.utGroesse ?? 1),
              fontWeight: "600",
              textAlign: "center",
              backgroundColor: `rgba(0,0,0,${E.utHintergrund ?? 0.55})`,
              paddingHorizontal: 14,
              paddingVertical: 4,
              borderRadius: 6,
              overflow: "hidden",
              ...(E.utRand !== false
                ? { textShadowColor: "#000", textShadowRadius: 5, textShadowOffset: { width: 0, height: 1 } }
                : {}),
            }}
          >
            {utText}
          </Text>
        </View>
      )}

      {/* ── Kopfzeile ─────────────────────────────────────────────────── */}
      {leisteAn && (
        <View pointerEvents="box-none" style={st.playerKopf}>
          <FokusReihe zeile={-1}>
            <FKnopf
              spalte={0}
              onPress={verlassen}
              style={[st.rundKnopf, { minWidth: gross ? 54 : 44, height: gross ? 54 : 44 }]}
              fokusStil={st.fokus}
              id="player:zurueck"
            >
              <Text style={st.rundKnopfText}>←</Text>
            </FKnopf>
          </FokusReihe>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={st.playerTitel}>{title}</Text>
            {!!subtitle && <Text numberOfLines={1} style={st.playerUnter}>{subtitle}</Text>}
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            {modeRef.current === "transcode" && (
              <View style={[st.hinweis, { paddingVertical: 4, paddingHorizontal: 10 }]}>
                <Text style={{ color: C.text, fontSize: M.klein, fontWeight: "700" }}>Umgewandelt</Text>
              </View>
            )}
            {!!tonSpur && tonListe.length > 1 && (
              <Text style={{ color: "#c9c9d6", fontSize: M.klein }}>🔊 {tonSpur.name}</Text>
            )}
            {!!utSpur && (
              <Text style={{ color: "#c9c9d6", fontSize: M.klein }}>
                💬 {utSpur.name}{utLaedt ? " (lädt …)" : ""}
              </Text>
            )}
          </View>
        </View>
      )}

      {/* ── Bedienleiste ──────────────────────────────────────────────── */}
      {leisteAn && (
        <View pointerEvents="box-none" style={st.playerFuss}>
          {folgenFehler && <Text style={st.gedaempft}>Folgenliste konnte nicht geladen werden.</Text>}
          <View style={[st.balkenRahmen, balkenAn && st.fokus]}>
            <Text style={st.playerZeit}>{fmtZeit(pos)}</Text>
            <View style={st.balkenSpur} onLayout={(e) => setBalkenBreite(e.nativeEvent.layout.width)}>
              <View style={[st.balkenVoll, { width: balkenBreite * anteil }]} />
              <View style={[st.balkenGriff, {
                left: balkenBreite * anteil,
                transform: [{ scale: balkenAn ? 1.35 : 1 }],
              }]} />
            </View>
            <Text style={[st.playerZeit, { textAlign: "right" }]}>−{fmtZeit(Math.max(0, dauer - pos))}</Text>
          </View>

          {balkenAn && (
            <Text style={[st.gedaempft, { textAlign: "center", marginTop: 2, fontSize: M.klein }]}>
              ← {E.sprungZurueck || 10} Sek zurück   ·   OK Pause   ·   {E.sprungVor || 30} Sek vor →
            </Text>
          )}

          <PlayerKnopfleiste breite={bedienBreite} knoepfe={knoepfe} />
        </View>
      )}

      {/* ── Dialoge ───────────────────────────────────────────────────── */}
      {dialog === "ton" && (
        <Dialog titel="Tonspur">
          <DialogListe
            aktiv={tonSpur?.id}
            aufWahl={tonWaehlen}
            eintraege={tonListe.map((s) => ({ wert: s.id, text: s.name }))}
          />
          {modeRef.current === "transcode" && (
            <Text style={[st.gedaempft, { marginTop: 12, fontSize: M.klein }]}>
              Beim Umwandeln wird nach dem Wechsel kurz neu geladen.
            </Text>
          )}
        </Dialog>
      )}

      {dialog === "ut" && (
        <Dialog titel="Untertitel">
          <DialogListe
            aktiv={utSpur?.id ?? "aus"}
            aufWahl={utWaehlen}
            eintraege={[
              { wert: "aus", text: "Aus" },
              ...utListe.map((s) => ({ wert: s.id, text: s.name })),
            ]}
          />
          {utBildNur > 0 && (
            <Text style={[st.gedaempft, { marginTop: 12, fontSize: M.klein }]}>
              {utBildNur} weitere Spur{utBildNur > 1 ? "en" : ""} ist Bild-Untertitel (Blu-ray/DVD).
              {"\n"}Die enthalten keinen Text und lassen sich nicht anzeigen.
            </Text>
          )}
          <Text style={[st.gedaempft, { marginTop: 10, fontSize: M.klein }]}>
            Größe, Farbe und Position stellst du unter Einstellungen ein.
          </Text>
        </Dialog>
      )}

      {dialog === "tempo" && (
        <Dialog titel="Geschwindigkeit">
          <DialogListe
            aktiv={tempo}
            aufWahl={setzeTempo}
            eintraege={[0.75, 1, 1.25, 1.5, 2].map((v) => ({
              wert: v, text: v === 1 ? "Normal (1×)" : `${v}×`,
            }))}
          />
        </Dialog>
      )}

      {dialog === "bild" && (
        <Dialog titel="Bildanpassung">
          <DialogListe
            aktiv={bildmodus}
            aufWahl={(v) => { setBildmodus(v); setDialog(null); }}
            eintraege={[
              { wert: "contain", text: "Einpassen — nichts wird abgeschnitten" },
              { wert: "cover", text: "Füllen — schwarze Balken weg, Ränder ab" },
              { wert: "fill", text: "Verzerren — füllt alles, Bild wird gedehnt" },
            ]}
          />
        </Dialog>
      )}

      {dialog === "info" && (
        <Dialog titel={title}>
          {!!subtitle && <Text style={[st.fliess, { marginBottom: 10 }]}>{subtitle}</Text>}
          <Text style={st.gedaempft}>
            {[
              `Laufzeit: ${fmtZeit(dauer)}`,
              `Position: ${fmtZeit(pos)}`,
              modeRef.current === "direct" ? "Wird direkt abgespielt" : "Wird für dieses Gerät umgewandelt",
              info?.width ? `Auflösung: ${info.width}×${info.height}` : null,
              info?.vcodec ? `Video: ${String(info.vcodec).toUpperCase()}` : null,
              info?.acodec ? `Ton: ${String(info.acodec).toUpperCase()}` : null,
              tonListe.length ? `Tonspuren: ${tonListe.length}` : null,
              info?.spuren?.sub?.length ? `Untertitel: ${info.spuren.sub.length}` : null,
            ].filter(Boolean).join("\n")}
          </Text>
          <View style={{ height: 16 }} />
          <FKnopf
            bereich="dialog" zeile={0} spalte={0}
            onPress={() => setDialog(null)}
            style={[st.knopf, st.knopfHaupt]}
            fokusStil={st.fokus}
          >
            <Text style={[st.knopfText, st.knopfTextHaupt]}>Schließen</Text>
          </FKnopf>
        </Dialog>
      )}
    </View>
  );
}

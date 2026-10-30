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
 *     Zeile 1   [−10 s] [Play/Pause] [+30 s] [Nächste Folge]
 *     Zeile 2   [Sprache & Untertitel] [Optionen]
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
import { ActivityIndicator, BackHandler, Platform, Pressable, Text, View, useWindowDimensions } from "react-native";
import { FKnopf, FokusReihe, useDialog, useFernbedienung, useFernbedienungVorher, useFokusElement, useFokusSystem } from "./fokus.js";
import { C, M, gross, st } from "./stile.js";
import { Dialog, DialogListe, fmtZeit } from "./bausteine.js";
import { untertitelHolen } from "./untertitel.js";
import { erzeugeFortschrittsSicherung } from "./fortschritt-sicherung.js";
import { jetzt as einstellungenJetzt, sichern as einstellungenSichern, waehleTon, waehleUntertitel } from "./einstellungen.js";
import { Icon } from "./Icons.js";
import { SpurenDialog } from "./SpurenDialog.js";

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

export function PlayerScreen({ api, pop, push, base, conn, type, id, title, subtitle, nextEp }) {
  useKeepAwake();
  const { width, height } = useWindowDimensions();
  const kompakt = gross || width > height;
  const fokusSystem = useFokusSystem();
  const [E, setE] = useState(einstellungenJetzt);
  const anpassen = (patch) => { const neu = { ...einstellungenJetzt(), ...patch }; setE(neu); einstellungenSichern(neu); };

  const [info, setInfo] = useState(null);
  const [ladeFehler, setLadeFehler] = useState(null);
  const [resume, setResume] = useState(0);
  const [leisteAn, setLeisteAn] = useState(true);
  const [laeuft, setLaeuft] = useState(true);
  const [puffert, setPuffert] = useState(true);
  const [pos, setPos] = useState(0);
  const [dauer, setDauer] = useState(0);
  const [balkenBreite, setBalkenBreite] = useState(0);
  const [dialog, setDialog] = useState(null);   // null | "ton" | "ut" | "tempo" | "bild" | "info"
  const [tempo, setTempo] = useState(E.tempo);
  const [bildmodus, setBildmodus] = useState(E.bildmodus);

  // Spuren
  const [tonSpur, setTonSpur] = useState(null);
  const [utSpur, setUtSpur] = useState(null);
  const [utSucher, setUtSucher] = useState(null);
  const [utText, setUtText] = useState(null);
  const [utLaedt, setUtLaedt] = useState(false);
  const [utFehler, setUtFehler] = useState(null);
  const [tonFehler, setTonFehler] = useState(null);

  const offsetRef = useRef(0);   // beim Umwandeln: Startpunkt des Datenstroms
  const modeRef = useRef("direct");
  const posRef = useRef(0);
  const durRef = useRef(0);
  const lebtRef = useRef(true);
  const versteckRef = useRef(null);
  const tonRef = useRef(null);   // aktuelle Tonspur für den Umwandel-Neustart
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
    (async () => {
      const [i, fortschritt] = await Promise.all([
        api(`/api/play/${type}/${id}`),
        api("/api/progress"),
      ]);
      const gemerkt = fortschritt.find?.((x) => x.mediaType === type && x.refId === +id);
      const bei =
        gemerkt && !gemerkt.watched && gemerkt.position > (E.fortsetzenAb || 30) &&
        gemerkt.position < (gemerkt.duration || 1e9) * 0.95
          ? gemerkt.position : 0;
      // Die Server-Angabe beschreibt Browser. Android kann mit seinen nativen
      // Decodern oft auch MKV/HEVC/E-AC3 direkt spielen. Erst ein echter
      // Decoderfehler rechtfertigt die teure Umwandlung auf dem Server.
      const direkt = i.direct || Platform.OS === "android";
      modeRef.current = direkt ? "direct" : "transcode";
      offsetRef.current = direkt ? 0 : bei;
      posRef.current = bei;
      durRef.current = i.duration || 0;

      // Spuren nach den Vorlieben vorbelegen
      const ton = waehleTon(i.spuren?.audio, E.tonSprache);
      tonRef.current = ton;
      setTonSpur(ton);
      const ut = waehleUntertitel(i.spuren?.sub, E.utSprache, E.utAn);
      setUtSpur(ut);

      setResume(bei);
      setDauer(i.duration || 0);
      setPos(bei);
      setInfo(i);
    })().catch((e) => { setLadeFehler(e.message || "Das Video konnte nicht geladen werden."); setPuffert(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, type, id]);

  const quelleFuer = useCallback(
    (i, t) => {
      /* Die Adressen aus /api/play tragen den Zugangsschlüssel bereits in
         sich. Vorher wurde er ein ZWEITES Mal mit "?" angehängt — daraus
         wurde "…?x=1&token=ABC?token=ABC", und der Server las als Token den
         Text "ABC?token=ABC". Mit gesetztem Server-Passwort endete deshalb
         jede Wiedergabe am Handy in einem 401. */
      const dran = (url, zusatz) => `${base}${url}${url.includes("?") ? "&" : "?"}${zusatz}`;
      if (modeRef.current === "direct") return dran(i.directUrl, "profile=1");
      const a = tonRef.current?.nr ?? 0;
      /* Punkt 2 der Übergabe: Auf iPhone und iPad spielt AVFoundation den
         endlosen fragmentierten MP4-Strom von /api/transcode NICHT ab — das
         Bild bleibt schwarz. Für Apple liefert der Server denselben Inhalt
         als HLS (siehe server/src/hls.js). */
      const weg = (Platform.OS === "ios" || Platform.OS === "android") && i.hlsUrl ? i.hlsUrl : i.transcodeUrl;
      // Fallback auf maximal 1080p: Eine nicht dekodierbare 4K-Datei darf
      // nicht drei ungebremste 4K-Umwandlungen durch Player-Retries auslösen.
      return dran(weg, `profile=1&a=${a}&t=${Math.floor(t)}&q=high`);
    },
    [base],
  );

  const player = useVideoPlayer(null, (p) => {
    if (p) p.timeUpdateEventInterval = 0.25;   // flüssige Untertitel
  });

  // Die Vorliebe muss nach dem Laden auch am nativen Decoder ankommen.
  // Nur die Beschriftung zu setzen spielte bisher weiter die Standardspur.
  const nativenTonSetzen = useCallback(() => safe(() => {
    if (modeRef.current !== "direct" || !tonRef.current) return false;
    const spur = (player.availableAudioTracks || [])[tonRef.current.nr];
    if (!spur) return false;
    player.audioTrack = spur;
    return true;
  }, false), [player, safe]);
  useEffect(() => {
    if (!player?.addListener) return;
    const a = player.addListener("availableAudioTracksChange", nativenTonSetzen);
    const b = player.addListener("sourceLoad", () => { nativenTonSetzen(); safe(() => { player.subtitleTrack = null; }); });
    return () => { a.remove(); b.remove(); };
  }, [player, nativenTonSetzen, safe]);

  /* ── Quelle laden ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!info || !player) return;
    safe(() => {
      player.replace(quelleFuer(info, resume));
      player.play();
      if (tempo !== 1) player.playbackRate = tempo;
    });
    if (modeRef.current === "direct" && resume > 0) {
      const t = setTimeout(() => safe(() => { player.currentTime = resume; }), 700);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info, player, resume]);

  /* ── Untertitel holen, sobald eine Spur gewählt ist ────────────────── */
  useEffect(() => {
    let abgebrochen = false;
    setUtFehler(null); setUtSucher(null); setUtText(null); setUtLaedt(false);
    if (!utSpur) return;
    if (!info?.untertitelUrl) { setUtFehler("Der Server liefert für diese Spur keine Untertiteladresse."); return; }
    setUtLaedt(true);
    const tr = info.untertitelUrl.includes("?") ? "&" : "?";
    untertitelHolen(`${base}${info.untertitelUrl}${tr}track=${utSpur.id}`.replace(base + base, base))
      .then((s) => {
        if (abgebrochen) return;
        setUtSucher(s);
        setUtLaedt(false);
        if (!s) setUtFehler("Untertitel konnten nicht geladen werden. Bitte eine andere Spur wählen oder erneut versuchen.");
      })
      .catch(() => { if (!abgebrochen) { setUtLaedt(false); setUtFehler("Untertitel konnten nicht geladen werden."); } });
    return () => { abgebrochen = true; };
  }, [utSpur, info, base]);

  /* ── Laufende Werte spiegeln ───────────────────────────────────────── */
  useEffect(() => {
    if (!player?.addListener) return;
    const abos = [];
    try {
      abos.push(player.addListener("timeUpdate", (e) => {
        if (!lebtRef.current) return;
        const p = offsetRef.current + (e?.currentTime || 0);
        posRef.current = p;
        setPos(p);
        if (!durRef.current) {
          const d = safe(() => player.duration, 0) || 0;
          if (d) { durRef.current = d; setDauer(d); }
        }
      }));
      abos.push(player.addListener("playingChange", (e) => {
        if (!lebtRef.current) return;
        setLaeuft(!!(typeof e === "object" ? e?.isPlaying : e));
      }));
      abos.push(player.addListener("statusChange", (e) => {
        if (!lebtRef.current) return;
        const s = typeof e === "object" ? e?.status : e;
        setPuffert(s === "loading");
        if (s === "readyToPlay") setLadeFehler(null);

        /* WICHTIG — nicht entfernen:
           Nicht jedes Video läuft auf jedem Gerät direkt (etwa DTS-Ton oder
           HEVC auf schwächeren Fernsehern). Scheitert die Direktwiedergabe,
           wird hier auf den umgewandelten Datenstrom umgeschaltet und an
           derselben Stelle weitergespielt. Ohne diesen Rückfall bliebe für
           solche Titel nur ein schwarzes Bild. */
        if (s === "error" && modeRef.current === "direct" && info) {
          modeRef.current = "transcode";
          offsetRef.current = posRef.current;
          safe(() => {
            player.replace(quelleFuer(info, posRef.current));
            player.play();
          });
        } else if (s === "error" && modeRef.current === "transcode" && info && Platform.OS === "ios") {
          /* iOS/HLS: Der Server räumt eine Sitzung ab, die 5 Minuten lang
             niemand abgerufen hat (langes Pausieren). Danach bliebe die
             Wiedergabe einfach stehen. Also an derselben Stelle eine frische
             Sitzung starten — der Abstand verhindert eine Endlosschleife,
             falls die Datei wirklich kaputt ist. */
          const jetzt = Date.now();
          if (jetzt - hlsNeustartRef.current > 5000) {
            hlsNeustartRef.current = jetzt;
            offsetRef.current = posRef.current;
            safe(() => {
              player.replace(quelleFuer(info, posRef.current));
              player.play();
            });
          }
        } else if (s === "error") {
          setLadeFehler(/503/.test(String(e?.error?.message || ""))
            ? "Der Medienserver ist mit Video-Umwandlungen ausgelastet. Bitte kurz warten und erneut versuchen."
            : "Das Video konnte auch nach der Umwandlung nicht abgespielt werden. Prüfe die Verbindung und den Medienserver.");
          setLaeuft(false);
        }
      }));
    } catch {}
    return () => abos.forEach((a) => { try { a?.remove?.(); } catch {} });
  }, [player, info, quelleFuer, safe]);

  // Auch ein nicht antwortender Stream muss enden koennen. Native Player
  // melden in diesem Fall mitunter nur 'loading', aber niemals 'error'.
  useEffect(() => {
    if (!puffert || !info || ladeFehler) return;
    const t = setTimeout(() => {
      setLadeFehler("Der Videostream antwortet seit 45 Sekunden nicht. Bitte erneut versuchen oder den Medienserver prüfen.");
      setPuffert(false); setLaeuft(false);
      safe(() => player.replace(null));
    }, 45000);
    return () => clearTimeout(t);
  }, [puffert, info, ladeFehler, player, safe]);

  /* ── Untertiteltext zur aktuellen Stelle bestimmen ─────────────────── */
  useEffect(() => {
    if (!utSucher) { setUtText(null); return; }
    const neu = utSucher.beiZeit(pos, E.utVersatz || 0);
    setUtText((alt) => (alt === neu ? alt : neu));
  }, [pos, utSucher, E.utVersatz]);

  /* ── Fortschritt sichern ───────────────────────────────────────────── */
  const fortschrittSchreiben = useMemo(() => erzeugeFortschrittsSicherung((body) =>
    api("/api/progress", { method: "POST", body })), [api]);
  const sichern = useCallback(
    (gesehen = false) => {
      const d = durRef.current, p = posRef.current;
      if (!d) return;
      fortschrittSchreiben({ mediaType: type, refId: +id, position: p, duration: d, watched: gesehen || p >= d * 0.95 });
    },
    [fortschrittSchreiben, type, id],
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
    if (nach > 0 && laeuft && !puffert && !dialog) versteckRef.current = setTimeout(() => setLeisteAn(false), nach);
  }, [E.leisteAus, laeuft, puffert, dialog]);
  useEffect(() => { wecken(); }, [wecken]);


  /* ── Steuerung ─────────────────────────────────────────────────────── */
  const springeAuf = useCallback((t) => {
    const ziel = Math.max(0, Math.min(t, durRef.current || t));
    posRef.current = ziel;
    setPos(ziel);
    if (modeRef.current === "direct") {
      safe(() => { player.currentTime = ziel - offsetRef.current; });
    } else {
      offsetRef.current = ziel;
      safe(() => { player.replace(quelleFuer(info, ziel)); player.play(); });
    }
    wecken();
  }, [player, info, quelleFuer, safe, wecken]);

  const springeUm = useCallback((d) => springeAuf(posRef.current + d), [springeAuf]);

  const anHalten = useCallback(() => {
    safe(() => (player.playing ? player.pause() : player.play()));
    wecken();
  }, [player, safe, wecken]);

  const verlassen = useCallback(() => {
    sichern();
    lebtRef.current = false;
    pop();
  }, [sichern, pop]);

  const naechsteFolge = useCallback(() => {
    if (!nextEp) return;
    sichern(true);
    lebtRef.current = false;
    push({
      name: "play", replace: true, type: "episode", id: nextEp.id, title,
      subtitle: (nextEp.se || "") + (nextEp.title ? " · " + nextEp.title : ""),
      nextEp: nextEp.next ?? null,
    });
  }, [nextEp, sichern, pop, push, title]);

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
    if (!spur || spur.id === tonRef.current?.id) return;
    const vorher = tonRef.current;
    tonRef.current = spur;
    setTonFehler(null);

    if (modeRef.current === "direct") {
      /* Bei Direktwiedergabe schaltet expo-video die eingebettete Spur
         selbst um — ohne Neuladen und ohne Aussetzer. */
      if (nativenTonSetzen()) setTonSpur(spur);
      else { tonRef.current = vorher; setTonFehler("Diese Tonspur ist am Player noch nicht verfügbar. Bitte kurz warten und erneut wählen."); }
      return;
    }
    /* Beim Umwandeln entscheidet der Server, welche Spur im Strom landet.
       Also an derselben Stelle neu anfordern — die Position bleibt erhalten. */
    const stelle = posRef.current;
    setTonSpur(spur);
    const warAmLaufen = safe(() => player.playing, false);
    offsetRef.current = stelle;
    safe(() => {
      player.replace(quelleFuer(info, stelle));
      if (warAmLaufen) player.play();
    });
    wecken();
  }, [info, player, quelleFuer, safe, wecken, nativenTonSetzen]);

  /* ── Untertitel wechseln ───────────────────────────────────────────── */
  const utWaehlen = useCallback((kennung) => {
    if (kennung === "aus") { setUtSpur(null); setUtSucher(null); setUtText(null); return; }
    const spur = (info?.spuren?.sub || []).find((s) => s.id === kennung);
    if (spur) setUtSpur({ ...spur });
    wecken();
  }, [info, wecken]);

  const setzeTempo = useCallback((v) => {
    setTempo(v);
    safe(() => { player.playbackRate = v; });
    setDialog(null);
  }, [player, safe]);

  const dialogZurueck = () => setDialog((d) => d === "utstil" ? "spuren" : ["tempo", "bild", "info"].includes(d) ? "optionen" : null);

  useFernbedienungVorher((taste) => {
    if (dialog) return false;
    wecken();
    if (leisteAn) return false;
    if (taste === "select") anHalten();
    else if (taste === "left") springeUm(-(E.sprungZurueck || 10));
    else if (taste === "right") springeUm(E.sprungVor || 30);
    return true;
  });

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

  useEffect(() => {
    const ab = BackHandler.addEventListener("hardwareBackPress", () => {
      if (dialog) { dialogZurueck(); return true; }
      verlassen(); return true;
    });
    return () => ab.remove();
  }, [dialog, verlassen]);
  useDialog(!!dialog, dialogZurueck);

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
    uebersprigen: !leisteAn || !!ladeFehler || !!videoLadeFehler || !VideoView,
  });

  // Nach der Balken-Anmeldung: sie übernimmt zuerst die vorgemerkte Position.
  useEffect(() => {
    // OK im Player soll bei Play/Pause landen. Der erste registrierte Knopf
    // war bisher Zurueck; nach erneutem Einblenden konnte OK dadurch den Film
    // verlassen, statt ihn anzuhalten.
    if (leisteAn && !ladeFehler) fokusSystem?.kern.setzen("player:pause");
  }, [leisteAn, ladeFehler, fokusSystem]);

  /* ── Anzeige ───────────────────────────────────────────────────────── */
  const anteil = dauer > 0 ? Math.min(1, Math.max(0, pos / dauer)) : 0;
  const tonListe = info?.spuren?.audio || [];

  if (videoLadeFehler || !VideoView || ladeFehler) {
    return (
      <View style={[st.center, { padding: 30 }]}>
        <Text style={[st.h2, { textAlign: "center", marginBottom: 10 }]}>
          Wiedergabe nicht verfügbar
        </Text>
        <Text style={[st.gedaempft, { textAlign: "center", marginBottom: 20 }]}>
          {ladeFehler || `Das Video-Modul konnte nicht geladen werden: ${videoLadeFehler}`}
        </Text>
        {info && <FKnopf onPress={() => {
          setLadeFehler(null); setPuffert(true);
          offsetRef.current = modeRef.current === "direct" ? 0 : posRef.current;
          safe(() => { player.replace(quelleFuer(info, posRef.current)); player.play(); });
        }} spalte={0} zeile={0} style={[st.knopf, st.knopfHaupt, { marginBottom: 12 }]} fokusStil={st.fokus}>
          <Text style={[st.knopfText, st.knopfTextHaupt]}>Erneut versuchen</Text>
        </FKnopf>}
        <FKnopf onPress={pop} spalte={0} zeile={1} style={[st.knopf, st.knopfHaupt]} fokusStil={st.fokus}>
          <Text style={[st.knopfText, st.knopfTextHaupt]}>Zurück</Text>
        </FKnopf>
      </View>
    );
  }


  return (
    <View style={st.playerWurzel}>
      <VideoView
        style={{ flex: 1 }}
        player={player}
        contentFit={bildmodus}
        nativeControls={false}
        fullscreenOptions={{ enable: false }}
      />
      {!leisteAn && <Pressable accessibilityRole="button" accessibilityLabel="Bedienelemente anzeigen" onPress={wecken} style={{ position: "absolute", left: 0, top: 0, right: 0, bottom: 0 }} />}

      {puffert && (
        <View style={[st.center, { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "transparent" }]}>
          <ActivityIndicator size="large" color={C.red} />
        </View>
      )}

      {/* ── Untertitel ────────────────────────────────────────────────── */}
      {!!utText && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute", left: "6%", right: "6%",
            // Die neue zweizeilige Bedienung darf den Untertitel nicht überdecken.
            bottom: leisteAn ? (kompakt ? 140 : 180) : `${Math.round((E.utPosition ?? 0.08) * 100)}%`,
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
              style={[st.rundKnopf, { minWidth: 40, height: 40 }]}
              fokusStil={st.fokus}
              id="player:zurueck" accessibilityLabel="Wiedergabe verlassen"
            >
              <Icon name="back" />
            </FKnopf>
          </FokusReihe>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={st.playerTitel}>{title}</Text>
            {!!subtitle && <Text numberOfLines={1} style={st.playerUnter}>{subtitle}</Text>}
          </View>
        </View>
      )}

      {/* ── Bedienleiste ──────────────────────────────────────────────── */}
      {leisteAn && (
        <View pointerEvents="box-none" style={st.playerFuss}>
          <View style={[st.balkenRahmen, balkenAn && st.fokus]}>
            <Text style={st.playerZeit}>{fmtZeit(pos)}</Text>
            <Pressable focusable={false} accessibilityLabel="Wiedergabeposition" hitSlop={18}
              onPress={(e) => { if (balkenBreite > 0) springeAuf(e.nativeEvent.locationX / balkenBreite * dauer); }}
              style={st.balkenSpur} onLayout={(e) => setBalkenBreite(e.nativeEvent.layout.width)}>
              <View style={[st.balkenVoll, { width: balkenBreite * anteil }]} />
              <View style={[st.balkenGriff, {
                left: balkenBreite * anteil,
                transform: [{ scale: balkenAn ? 1.35 : 1 }],
              }]} />
            </Pressable>
            <Text style={[st.playerZeit, { textAlign: "right" }]}>−{fmtZeit(Math.max(0, dauer - pos))}</Text>
          </View>

          {balkenAn && (
            <Text style={[st.gedaempft, { textAlign: "center", marginTop: 2, fontSize: M.klein }]}>
              ← {E.sprungZurueck || 10} Sek zurück   ·   OK Pause   ·   {E.sprungVor || 30} Sek vor →
            </Text>
          )}

          <View style={{ flexDirection: kompakt ? "row" : "column", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
          <FokusReihe zeile={1}>
            <View style={st.playerKnopfReihe}>
              <PKnopf spalte={0} text={`${E.sprungZurueck || 10} s`} label={`${E.sprungZurueck || 10} Sekunden zurück`} symbol="rewind" onPress={() => springeUm(-(E.sprungZurueck || 10))} />
              <PKnopf id="player:pause" spalte={1} symbol={laeuft ? "pause" : "play"} label={laeuft ? "Pausieren" : "Abspielen"} haupt grossKnopf onPress={anHalten} aufRichtung={(r) => { if (r !== "down") return false; fokusSystem?.kern.setzen("player:spuren"); return true; }} />
              <PKnopf spalte={2} text={`${E.sprungVor || 30} s`} label={`${E.sprungVor || 30} Sekunden vor`} symbol="forward" onPress={() => springeUm(E.sprungVor || 30)} />
              {!!nextEp && <PKnopf spalte={3} label="Nächste Folge" symbol="next" onPress={naechsteFolge} />}
            </View>
          </FokusReihe>
          <FokusReihe zeile={kompakt ? 1 : 2}>
            <View style={{ flexDirection: "row", gap: 6, justifyContent: "center" }}>
              <FKnopf id="player:spuren" accessibilityLabel="Sprache & Untertitel" hitSlop={gross ? 0 : 3} spalte={kompakt ? 4 : 1} aufRichtung={(r) => { if (r !== "up") return false; fokusSystem?.kern.setzen("player:pause"); return true; }} onPress={() => { fokusSystem?.kern.setzen("player:spuren"); setDialog("spuren"); }} style={[st.rundKnopf, { flex: kompakt ? undefined : 1, paddingHorizontal: 10, gap: 7 }]} fokusStil={st.fokus}>
                <Icon name="subtitles" size={20} />
                <Text style={{ color: "white", fontSize: 12, fontWeight: "600" }}>Sprache & Untertitel</Text>
              </FKnopf>
              <PKnopf id="player:optionen" spalte={kompakt ? 5 : 2} symbol="settings" label="Optionen" onPress={() => setDialog("optionen")} />
            </View>
          </FokusReihe>
          </View>
          {(utLaedt || utFehler) && <Text accessibilityRole="alert" style={{ color: utFehler ? "#ffca85" : "#bbc2d2", textAlign: "center", marginTop: 10, fontSize: M.klein }}>{utLaedt ? "Untertitel werden geladen …" : utFehler}</Text>}
        </View>
      )}

      {/* ── Dialoge ───────────────────────────────────────────────────── */}
      {dialog === "spuren" && <SpurenDialog
        audio={tonListe} untertitel={info?.spuren?.sub || []} ton={tonSpur} ut={utSpur}
        aufTon={tonWaehlen} aufUt={utWaehlen} aufSchliessen={() => setDialog(null)}
        aufDarstellung={() => setDialog("utstil")} status={tonFehler || utFehler || (utLaedt ? "Untertitel werden geladen …" : null)}
        aufMerken={() => anpassen({ tonSprache: tonSpur?.sprache || "", utAn: !!utSpur, utSprache: utSpur?.sprache || "" })}
      />}
      {dialog === "optionen" && <Dialog titel="Wiedergabeoptionen" aufSchliessen={() => setDialog(null)}>
        <DialogListe aufWahl={setDialog} eintraege={[
          { wert: "tempo", text: `Geschwindigkeit · ${tempo}×` },
          { wert: "bild", text: `Bild · ${bildmodus === "contain" ? "Einpassen" : bildmodus === "cover" ? "Füllen" : "Strecken"}` },
          { wert: "utstil", text: "Untertitel-Darstellung" },
          { wert: "info", text: "Wiedergabeinformationen" },
        ]} />
      </Dialog>}
      {dialog === "utstil" && <Dialog titel="Untertitel-Darstellung" aufSchliessen={() => setDialog("spuren")}>
        <View style={{ alignItems: "center", backgroundColor: "#303b4a", borderRadius: 12, padding: 18, marginBottom: 14 }}><Text style={{ color: E.utFarbe, fontSize: (gross ? 24 : 18) * E.utGroesse, backgroundColor: `rgba(0,0,0,${E.utHintergrund})`, padding: 6, textAlign: "center" }}>So sehen deine Untertitel aus.</Text></View>
        <DialogListe aufWahl={(key) => {
          const werte = { utGroesse: [.8, 1, 1.25, 1.5], utHintergrund: [0, .55, .85], utFarbe: ["#ffffff", "#ffdf70"], utVersatz: [-2, -1, -.5, 0, .5, 1, 2] };
          const optionen = werte[key]; anpassen({ [key]: optionen[(optionen.indexOf(E[key]) + 1) % optionen.length] });
        }} eintraege={[
          { wert: "utGroesse", text: `Schriftgröße · ${Math.round(E.utGroesse * 100)} %` },
          { wert: "utFarbe", text: `Farbe · ${E.utFarbe === "#ffffff" ? "Weiß" : "Gelb"}` },
          { wert: "utHintergrund", text: `Hintergrund · ${Math.round(E.utHintergrund * 100)} %` },
          { wert: "utVersatz", text: `Zeitversatz · ${E.utVersatz > 0 ? "+" : ""}${E.utVersatz} s` },
        ]} />
        <Text style={{ color: "#aeb7c9", fontSize: M.klein, marginTop: 12 }}>Antippen / OK: nächster Wert. Positiver Zeitversatz zeigt den Text später.</Text>
      </Dialog>}

      {dialog === "tempo" && (
        <Dialog titel="Geschwindigkeit" aufSchliessen={dialogZurueck}>
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
        <Dialog titel="Bildanpassung" aufSchliessen={dialogZurueck}>
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
        <Dialog titel={title} aufSchliessen={dialogZurueck}>
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

/** Knopf der Bedienleiste. */
function PKnopf({ id, spalte, text, symbol, label, haupt, onPress, grossKnopf, aufRichtung }) {
  return (
    <FKnopf
      id={id}
      accessibilityLabel={label || text}
      aufRichtung={aufRichtung}
      spalte={spalte}
      onPress={onPress}
      hitSlop={gross ? 0 : 3}
      style={[
        st.rundKnopf,
        haupt && st.rundKnopfHaupt,
        grossKnopf && { minWidth: 44, height: 40 },
      ]}
      fokusStil={st.fokus}
    >
      {!!symbol && <Icon name={symbol} size={grossKnopf ? 23 : 20} />}
      {!!text && <Text style={st.rundKnopfText}>{text}</Text>}
    </FKnopf>
  );
}

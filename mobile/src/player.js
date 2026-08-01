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
import { ActivityIndicator, Platform, Text, View } from "react-native";
import { FKnopf, FokusReihe, useDialog, useFernbedienung, useFokusElement } from "./fokus.js";
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

export function PlayerScreen({ api, pop, push, base, conn, type, id, title, subtitle, nextEp }) {
  useKeepAwake();
  const E = einstellungenJetzt();

  const [info, setInfo] = useState(null);
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
      modeRef.current = i.direct ? "direct" : "transcode";
      offsetRef.current = i.direct ? 0 : bei;
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
    })().catch(() => {});
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
      const weg = Platform.OS === "ios" && i.hlsUrl ? i.hlsUrl : i.transcodeUrl;
      return dran(weg, `profile=1&a=${a}&t=${Math.floor(t)}`);
    },
    [base],
  );

  const player = useVideoPlayer(null, (p) => {
    if (p) p.timeUpdateEventInterval = 0.25;   // flüssige Untertitel
  });

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
        }
      }));
    } catch {}
    return () => abos.forEach((a) => { try { a?.remove?.(); } catch {} });
  }, [player, info, quelleFuer, safe]);

  /* ── Untertiteltext zur aktuellen Stelle bestimmen ─────────────────── */
  useEffect(() => {
    if (!utSucher) { setUtText(null); return; }
    const neu = utSucher.beiZeit(pos, E.utVersatz || 0);
    setUtText((alt) => (alt === neu ? alt : neu));
  }, [pos, utSucher, E.utVersatz]);

  /* ── Fortschritt sichern ───────────────────────────────────────────── */
  const sichern = useCallback(
    (gesehen = false) => {
      const d = durRef.current, p = posRef.current;
      if (!d) return;
      api("/api/progress", {
        method: "POST",
        body: { mediaType: type, refId: +id, position: p, duration: d, watched: gesehen || p >= d * 0.95 },
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
    pop();
    push({
      name: "play", type: "episode", id: nextEp.id, title,
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
    const stelle = posRef.current;
    offsetRef.current = stelle;
    safe(() => {
      player.replace(quelleFuer(info, stelle));
      player.play();
    });
    wecken();
  }, [info, player, quelleFuer, safe, wecken]);

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

  // Knopfspalten fortlaufend vergeben, damit übersprungene Knöpfe keine Lücke lassen
  let sp = 0;

  return (
    <View style={st.playerWurzel}>
      <VideoView
        style={{ flex: 1 }}
        player={player}
        contentFit={bildmodus}
        nativeControls={false}
        allowsFullscreen={false}
      />

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

          <FokusReihe zeile={1}>
            <View style={st.playerKnopfReihe}>
              <PKnopf spalte={sp++} text={String(E.sprungZurueck || 10)} symbol="⏪" onPress={() => springeUm(-(E.sprungZurueck || 10))} />
              <PKnopf spalte={sp++} symbol={laeuft ? "⏸" : "▶"} haupt grossKnopf onPress={anHalten} />
              <PKnopf spalte={sp++} text={String(E.sprungVor || 30)} symbol="⏩" onPress={() => springeUm(E.sprungVor || 30)} />
              {!!nextEp && <PKnopf spalte={sp++} text="Nächste" symbol="⏭" onPress={naechsteFolge} />}
              {tonListe.length > 1 && <PKnopf spalte={sp++} symbol="🔊" text="Ton" onPress={() => setDialog("ton")} />}
              {(utListe.length > 0 || utBildNur > 0) && (
                <PKnopf spalte={sp++} symbol="💬" text={utSpur ? "UT an" : "UT"} onPress={() => setDialog("ut")} />
              )}
              <PKnopf spalte={sp++} text={`${tempo}×`} onPress={() => setDialog("tempo")} />
              <PKnopf spalte={sp++} symbol="⛶" onPress={() => setDialog("bild")} />
              <PKnopf spalte={sp++} symbol="ℹ" onPress={() => setDialog("info")} />
            </View>
          </FokusReihe>
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

/** Knopf der Bedienleiste. */
function PKnopf({ spalte, text, symbol, haupt, onPress, grossKnopf }) {
  return (
    <FKnopf
      spalte={spalte}
      onPress={onPress}
      style={[
        st.rundKnopf,
        haupt && st.rundKnopfHaupt,
        grossKnopf && { minWidth: gross ? 84 : 66, height: gross ? 70 : 56 },
      ]}
      fokusStil={st.fokus}
    >
      {!!symbol && <Text style={[st.rundKnopfText, grossKnopf && { fontSize: gross ? 26 : 20 }]}>{symbol}</Text>}
      {!!text && <Text style={st.rundKnopfText}>{text}</Text>}
    </FKnopf>
  );
}

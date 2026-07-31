/**
 * ══════════════════════════════════════════════════════════════════════════
 *  VIDEOPLAYER
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WAS VORHER NICHT GING
 * „Ich kann ihn überhaupt nicht steuern. Es ist ganz schwer, in diese
 *  Oberfläche reinzukommen, und dann kann man nichts machen."
 *
 * Der Grund: Die Bedienleiste bestand aus Knöpfen, die auf Androids eigenen
 * View-Fokus angewiesen waren. Über einem Video, das den ganzen Bildschirm
 * füllt, findet Androids geometrische Fokus-Suche aber kaum einen Weg zu
 * ihnen — und ausgeblendete Knöpfe sind gar nicht erst erreichbar.
 *
 * WIE ES JETZT FUNKTIONIERT
 * Der Player benutzt dasselbe Fokus-System wie der Rest der App (fokus.js).
 * Die Bedienleiste ist ein festes Raster:
 *
 *     Zeile 0   [────────── Fortschrittsbalken ──────────]
 *     Zeile 1   [ −10 ] [ ⏯ ] [ +10 ] [ Nächste ] [ Ton ] [ Info ]
 *
 * ← → auf dem Balken springen im Video (der Balken behält die Tasten für
 * sich, siehe aufRichtung im Fokus-Kern). ↑ ↓ wechseln zwischen Balken und
 * Knöpfen. Beim Öffnen liegt die Auswahl gleich auf ⏯, damit die erste
 * OK-Taste sofort etwas Sinnvolles tut.
 *
 * Zusätzlich wirken die Medientasten der Fernbedienung direkt, ganz ohne
 * Bedienleiste — genau wie bei Netflix oder Plex.
 *
 * ── WICHTIG ZUM ABSTURZ "NativeSharedObjectNotFoundException" ─────────────
 * expo-video gibt das native Player-Objekt frei, sobald der Bildschirm
 * verlassen wird. Jeder spätere Zugriff auf player.currentTime & Co. wirft
 * dann. Deshalb werden Position und Dauer fortlaufend in Refs gespiegelt und
 * NUR aus diesen gespeichert; jeder direkte Zugriff läuft über safe().
 * Diese bewährte Absicherung ist unverändert übernommen.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { FKnopf, FokusReihe, useDialog, useFernbedienung, useFokusElement, useFokusSystem } from "./fokus.js";
import { C, M, gross, st } from "./stile.js";
import { Dialog, DialogListe, fmtZeit } from "./bausteine.js";

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
  const sys = useFokusSystem();

  const [info, setInfo] = useState(null);
  const [resume, setResume] = useState(0);
  const [leisteAn, setLeisteAn] = useState(true);
  const [laeuft, setLaeuft] = useState(true);
  const [puffert, setPuffert] = useState(true);
  const [pos, setPos] = useState(0);
  const [dauer, setDauer] = useState(0);
  const [balkenBreite, setBalkenBreite] = useState(0);
  const [dialog, setDialog] = useState(null);   // null | "info" | "tempo"
  const [tempo, setTempo] = useState(1);

  const offsetRef = useRef(0);   // beim Umwandeln: Startpunkt des Datenstroms
  const modeRef = useRef("direct");
  const posRef = useRef(0);
  const durRef = useRef(0);
  const lebtRef = useRef(true);
  const versteckRef = useRef(null);

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
      const [i, prog] = await Promise.all([
        api(`/api/play/${type}/${id}`),
        api("/api/progress"),
      ]);
      const gemerkt = prog.find?.((x) => x.mediaType === type && x.refId === +id);
      const bei =
        gemerkt && !gemerkt.watched && gemerkt.position > 30 &&
        gemerkt.position < (gemerkt.duration || 1e9) * 0.95
          ? gemerkt.position : 0;
      modeRef.current = i.direct ? "direct" : "transcode";
      offsetRef.current = i.direct ? 0 : bei;
      posRef.current = bei;
      durRef.current = i.duration || 0;
      setResume(bei);
      setDauer(i.duration || 0);
      setPos(bei);
      setInfo(i);
    })().catch(() => {});
  }, [api, type, id]);

  const tok = conn?.token ? `?token=${conn.token}` : "?";
  const quelleFuer = useCallback(
    (i, t) =>
      modeRef.current === "direct"
        ? `${base}${i.directUrl}${tok}&profile=1`
        : `${base}${i.transcodeUrl}${tok}&profile=1&t=${Math.floor(t)}`,
    [base, tok],
  );

  const player = useVideoPlayer(null, (p) => {
    if (p) p.timeUpdateEventInterval = 0.5;
  });

  /* ── Quelle laden ──────────────────────────────────────────────────── */
  useEffect(() => {
    if (!info || !player) return;
    safe(() => {
      player.replace(quelleFuer(info, resume));
      player.play();
    });
    if (modeRef.current === "direct" && resume > 0) {
      const t = setTimeout(() => safe(() => { player.currentTime = resume; }), 700);
      return () => clearTimeout(t);
    }
  }, [info, player, resume, quelleFuer, safe]);

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
        }
      }));
    } catch {}
    return () => abos.forEach((a) => { try { a?.remove?.(); } catch {} });
  }, [player, info, quelleFuer, safe]);

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
    versteckRef.current = setTimeout(() => setLeisteAn(false), 5000);
  }, []);
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
      subtitle: nextEp.se + (nextEp.title ? " · " + nextEp.title : ""),
      nextEp: nextEp.next ?? null,
    });
  }, [nextEp, sichern, pop, push, title]);

  const setzeTempo = useCallback((v) => {
    setTempo(v);
    safe(() => { player.playbackRate = v; });
    setDialog(null);
  }, [player, safe]);

  /* ── Fernbedienung: Medientasten wirken immer ──────────────────────── */
  useFernbedienung((taste) => {
    switch (taste) {
      case "playPause": anHalten(); break;
      case "fastForward": springeUm(30); break;
      case "rewind": springeUm(-10); break;
      case "next": naechsteFolge(); break;
      case "previous": springeAuf(0); break;
      case "stop": verlassen(); break;
      case "info": setDialog((d) => (d === "info" ? null : "info")); break;
      default: wecken();
    }
  });

  /* ── Ist die Leiste aus, holt die erste Taste sie zurück ───────────── */
  const leisteAnRef = useRef(leisteAn);
  leisteAnRef.current = leisteAn;

  useDialog(!!dialog);

  /* ── Fortschrittsbalken als Fokus-Element ──────────────────────────── */
  const balkenRichtung = useCallback((r) => {
    if (r === "left") { springeUm(-10); return true; }
    if (r === "right") { springeUm(30); return true; }
    return false;
  }, [springeUm]);

  const balkenAn = useFokusElement({
    bereich: "inhalt", zeile: 0, spalte: 0,
    onPress: anHalten,
    aufRichtung: balkenRichtung,
    id: "player:balken",
  });

  /* ── Anzeige ───────────────────────────────────────────────────────── */
  const anteil = dauer > 0 ? Math.min(1, Math.max(0, pos / dauer)) : 0;

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

  return (
    <View style={st.playerWurzel}>
      <VideoView
        style={{ flex: 1 }}
        player={player}
        contentFit="contain"
        nativeControls={false}
        allowsFullscreen={false}
      />

      {puffert && (
        <View style={[st.center, { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "transparent" }]}>
          <ActivityIndicator size="large" color={C.red} />
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
          {modeRef.current === "transcode" && (
            <View style={[st.hinweis, { paddingVertical: 5, paddingHorizontal: 10 }]}>
              <Text style={{ color: C.text, fontSize: M.klein, fontWeight: "700" }}>Umgewandelt</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Bedienleiste ──────────────────────────────────────────────── */}
      {leisteAn && (
        <View pointerEvents="box-none" style={st.playerFuss}>
          {/* Zeile 0: Fortschrittsbalken */}
          <View style={[st.balkenRahmen, balkenAn && st.fokus]}>
            <Text style={st.playerZeit}>{fmtZeit(pos)}</Text>
            <View
              style={st.balkenSpur}
              onLayout={(e) => setBalkenBreite(e.nativeEvent.layout.width)}
            >
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
              ← 10 Sek zurück   ·   OK Pause   ·   30 Sek vor →
            </Text>
          )}

          {/* Zeile 1: Knöpfe */}
          <FokusReihe zeile={1}>
            <View style={st.playerKnopfReihe}>
              <PKnopf spalte={0} text="10" symbol="⏪" onPress={() => springeUm(-10)} />
              <PKnopf spalte={1} symbol={laeuft ? "⏸" : "▶"} haupt onPress={anHalten} gross />
              <PKnopf spalte={2} text="30" symbol="⏩" onPress={() => springeUm(30)} />
              {!!nextEp && <PKnopf spalte={3} text="Nächste" symbol="⏭" onPress={naechsteFolge} />}
              <PKnopf spalte={nextEp ? 4 : 3} text={`${tempo}×`} onPress={() => setDialog("tempo")} />
              <PKnopf spalte={nextEp ? 5 : 4} symbol="ℹ" onPress={() => setDialog("info")} />
            </View>
          </FokusReihe>
        </View>
      )}

      {/* ── Dialoge ───────────────────────────────────────────────────── */}
      {dialog === "tempo" && (
        <Dialog titel="Wiedergabegeschwindigkeit">
          <DialogListe
            aktiv={tempo}
            aufWahl={setzeTempo}
            eintraege={[0.75, 1, 1.25, 1.5, 2].map((v) => ({
              wert: v, text: v === 1 ? "Normal (1×)" : `${v}×`,
            }))}
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
              modeRef.current === "direct" ? "Direkt abgespielt" : "Wird für dieses Gerät umgewandelt",
              info?.width ? `Auflösung: ${info.width}×${info.height}` : null,
              info?.vcodec ? `Video: ${info.vcodec}` : null,
              info?.acodec ? `Ton: ${info.acodec}` : null,
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
function PKnopf({ spalte, text, symbol, haupt, onPress, gross: grossKnopf }) {
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

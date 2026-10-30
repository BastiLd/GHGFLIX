/**
 * Bausteine der Oberfläche: Kacheln, Reihen, Kopfbild, Knöpfe, Dialog.
 *
 * Alles hier ist mit der Fernbedienung bedienbar — jedes Element meldet sich
 * beim Fokus-Kern an und zeichnet seine Markierung selbst. Am Handy
 * funktioniert weiterhin der Fingertipp; beides schließt sich nicht aus.
 */
import React, { useCallback, useMemo, useRef } from "react";
import { ActivityIndicator, FlatList, Image, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { FKnopf, FokusReihe, FokusOverlay, useFokusElement, useFokusSystem } from "./fokus.js";
import { C, M, gross, st } from "./stile.js";
import { qrErzeugen } from "./qr.js";
import { Icon } from "./Icons.js";

/* ══ Kleinkram ═══════════════════════════════════════════════════════════ */

export const fmtZeit = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`
    : `${m}:${String(x).padStart(2, "0")}`;
};

export const se = (s, e) => `S${String(s).padStart(2, "0")}E${String(e).padStart(2, "0")}`;

/** Genres kommen je nach Quelle als JSON-Liste oder als "Action, Drama". */
export function parseGenres(g) {
  if (!g) return [];
  if (Array.isArray(g)) return g;
  const s = String(g).trim();
  if (s.startsWith("[")) {
    try { return JSON.parse(s); } catch { return []; }
  }
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

export function Laden({ text }) {
  return (
    <View style={st.center}>
      <ActivityIndicator color={C.red} size="large" />
      {!!text && <Text style={[st.gedaempft, { marginTop: 14 }]}>{text}</Text>}
    </View>
  );
}

/* ══ Verlauf ohne Zusatzmodul ════════════════════════════════════════════
 * Gestapelte Streifen zunehmender Deckkraft ergeben einen weichen Übergang.
 * Das spart expo-linear-gradient — und jedes native Modul weniger ist eines,
 * das beim Start nicht fehlen kann (siehe BERICHT.md, Nachtrag 9).
 */
export function Verlauf({ hoehe = 170, farbe = C.bg, von = "unten" }) {
  const stufen = 48;
  return (
    <>
      {Array.from({ length: stufen }, (_, i) => {
        const anteil = (i + 1) / stufen;
        const h = hoehe / stufen;
        const pos = von === "unten" ? { bottom: (stufen - 1 - i) * h } : { top: (stufen - 1 - i) * h };
        return (
          <View
            key={i}
            pointerEvents="none"
            style={{
              position: "absolute", left: 0, right: 0, height: h,
              backgroundColor: farbe, opacity: Math.pow(anteil, 1.5), ...pos,
            }}
          />
        );
      })}
    </>
  );
}

/* ══ Knöpfe ══════════════════════════════════════════════════════════════ */

export function Knopf({ text, symbol, haupt, zeile, spalte, onPress, bereich, style }) {
  return (
    <FKnopf
      zeile={zeile}
      spalte={spalte}
      bereich={bereich}
      onPress={onPress}
      hitSlop={gross ? 0 : 4}
      style={[st.knopf, haupt && st.knopfHaupt, style]}
      fokusStil={st.fokus}
    >
      {!!symbol && <Icon name={symbol} size={18} />}
      <Text style={[st.knopfText, haupt && st.knopfTextHaupt]}>{text}</Text>
    </FKnopf>
  );
}

/* ══ Textfeld ════════════════════════════════════════════════════════════
 * Am Fernseher wird ein Textfeld nicht direkt getippt: Erst wählt man es mit
 * dem Steuerkreuz aus (weißer Rahmen), dann öffnet OK die Bildschirmtastatur.
 * Ohne diesen Zwischenschritt würde der Fokus-Anker (siehe fokus.js) sofort
 * zurückspringen und Tippen wäre unmöglich.
 */
export function FFeld({ zeile, spalte, bereich, wert, aufWert, platzhalter, style, ...rest }) {
  const ref = useRef(null);
  const sys = useFokusSystem();
  const an = useFokusElement({
    zeile, spalte, bereich,
    onPress: () => { try { ref.current?.focus(); } catch {} },
  });
  return (
    <TextInput
      ref={ref}
      value={wert}
      onChangeText={aufWert}
      placeholder={platzhalter}
      placeholderTextColor={C.muted}
      onSubmitEditing={() => { ref.current?.blur(); sys?.ankerHolen(); }}
      onBlur={() => sys?.ankerHolen()}
      style={[st.feld, an && st.feldFokus, style]}
      {...rest}
    />
  );
}

/* ══ Poster-Kachel ═══════════════════════════════════════════════════════ */

function PosterKachel({ x, img, onPress, onLang, spalte }) {
  const jung = Date.now() - 14 * 24 * 3600 * 1000;
  const neu = (x.added_at || 0) * 1000 > jung;
  const note = Number(x.rating) || 0;
  return (
    <FKnopf
      spalte={spalte}
      onPress={() => onPress(x)}
      onLang={onLang ? () => onLang(x) : undefined}
      style={[st.kachel, { width: M.posterB + 8 }]}
      fokusStil={st.kachelFokus}
    >
      <View>
        {x.poster ? (
          <Image source={{ uri: img(x.poster, "w500") }} style={st.poster} />
        ) : (
          <View style={[st.poster, st.center, { padding: 8 }]}>
            <Text numberOfLines={5} style={{ color: C.muted, fontSize: M.klein, textAlign: "center" }}>
              {x.title}
            </Text>
          </View>
        )}
        {neu && (
          <View style={st.abzeichenNeu}>
            <Text style={st.abzeichenText}>NEU</Text>
          </View>
        )}
        {note > 0 && (
          <View style={st.abzeichenNote}>
            <Text style={st.abzeichenText}>★ {note.toFixed(1)}</Text>
          </View>
        )}
      </View>
      <Text numberOfLines={2} style={st.kachelTitel}>{x.title}</Text>
      <Text numberOfLines={1} style={st.kachelUnter}>
        {x.seasons ? `${x.seasons} Staffel${x.seasons > 1 ? "n" : ""}` : x.year ? String(x.year) : " "}
      </Text>
    </FKnopf>
  );
}

/** Waagerechte Reihe mit Postern. */
export function PosterReihe({ zeile, items, img, onPress, onLang }) {
  const listeRef = useRef(null);
  if (!items?.length) return null;
  return (
    <FokusReihe zeile={zeile} listeRef={listeRef}>
      <FlatList
        ref={listeRef}
        horizontal
        data={items}
        keyExtractor={(x, i) => `${x._t || ""}${x.id ?? i}`}
        contentContainerStyle={{ paddingHorizontal: M.rand - 4, gap: M.luecke - 4 }}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={Math.min(items.length, 20)}
        windowSize={5}
        renderItem={({ item, index }) => (
          <PosterKachel x={item} img={img} onPress={onPress} onLang={onLang} spalte={index} />
        )}
        getItemLayout={(_, i) => ({
          length: M.posterB + 8 + M.luecke - 4,
          offset: (M.posterB + 8 + M.luecke - 4) * i,
          index: i,
        })}
      />
    </FokusReihe>
  );
}

/* ══ Breite Karte (Weiterschauen / Verlauf) ══════════════════════════════ */

function BreitKachel({ x, img, onPress, onLang, spalte, ohneFortschritt }) {
  const bild = x.still || x.mBackdrop || x.sBackdrop || x.backdrop || x.poster;
  const anteil = x.duration > 0 ? Math.min(1, x.position / x.duration) : 0;
  return (
    <FKnopf
      spalte={spalte}
      onPress={() => onPress(x)}
      onLang={onLang ? () => onLang(x) : undefined}
      style={[st.kachel, { width: M.breitB + 8 }]}
      fokusStil={st.kachelFokus}
    >
      <View>
        {bild ? (
          <Image source={{ uri: img(bild, "w500") }} style={st.breitBild} />
        ) : (
          <View style={[st.breitBild, st.center]}>
            <Text style={{ color: C.muted, fontSize: M.klein }}>kein Bild</Text>
          </View>
        )}
        <View style={st.spielPunkt}>
          <Icon name="play" size={gross ? 21 : 18} />
        </View>
        {!ohneFortschritt && anteil > 0 && (
          <View style={st.fortschrittBg}>
            <View style={[st.fortschrittFg, { width: `${Math.round(anteil * 100)}%` }]} />
          </View>
        )}
      </View>
      <Text numberOfLines={1} style={st.kachelTitel}>{x.title}</Text>
      <Text numberOfLines={1} style={st.kachelUnter}>
        {x.mediaType === "episode" && x.season != null ? se(x.season, x.episode) + "  " : ""}
        {!ohneFortschritt && x.duration > 0 ? fmtZeit(x.duration - x.position) + " übrig" : ""}
      </Text>
    </FKnopf>
  );
}

export function BreitReihe({ zeile, items, img, onPress, onLang, ohneFortschritt }) {
  const listeRef = useRef(null);
  if (!items?.length) return null;
  return (
    <FokusReihe zeile={zeile} listeRef={listeRef}>
      <FlatList
        ref={listeRef}
        horizontal
        data={items}
        keyExtractor={(x, i) => `${x.mediaType}${x.refId}${i}`}
        contentContainerStyle={{ paddingHorizontal: M.rand - 4, gap: M.luecke - 4 }}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={Math.min(items.length, 20)}
        renderItem={({ item, index }) => (
          <BreitKachel
            x={item} img={img} onPress={onPress} onLang={onLang}
            spalte={index} ohneFortschritt={ohneFortschritt}
          />
        )}
        getItemLayout={(_, i) => ({
          length: M.breitB + 8 + M.luecke - 4,
          offset: (M.breitB + 8 + M.luecke - 4) * i,
          index: i,
        })}
      />
    </FokusReihe>
  );
}

/* ══ Kopfbild ════════════════════════════════════════════════════════════ */

export function Hero({ x, img, zeile, aufAnsehen, aufInfos }) {
  if (!x) return null;
  const meta = [
    x._t === "show" ? "Serie" : "Film",
    x.year,
    x.rating ? `★ ${Number(x.rating).toFixed(1)}` : null,
    x._t === "show" && x.seasons ? `${x.seasons} Staffeln` : null,
    ...parseGenres(x.genres).slice(0, 2),
  ].filter(Boolean).join("   ·   ");

  return (
    <View style={st.hero}>
      {x.backdrop ? (
        <Image source={{ uri: img(x.backdrop, "w1280") }} style={st.heroBild} />
      ) : (
        <View style={st.heroBild} />
      )}
      <Verlauf hoehe={M.heroH * 0.85} />
      <View style={st.heroText}>
        <Text numberOfLines={2} style={st.heroTitel}>{x.title}</Text>
        <Text style={st.heroMeta}>{meta}</Text>
        {!!x.overview && (
          <Text numberOfLines={gross ? 3 : 2} style={st.heroBeschreibung}>{x.overview}</Text>
        )}
        <FokusReihe zeile={zeile}>
          <View style={st.heroKnopfReihe}>
            <Knopf text="Ansehen" symbol="▶" haupt spalte={0} onPress={aufAnsehen} />
            <Knopf text="Mehr Infos" spalte={1} onPress={aufInfos} />
          </View>
        </FokusReihe>
      </View>
    </View>
  );
}

/* ══ Kopfbereich der Detailseiten ════════════════════════════════════════ */

export function BackdropKopf({ uri, hoehe }) {
  const h = hoehe ?? (gross ? Math.min(220, M.heroH) : 174);
  if (!uri) return <View style={{ height: gross ? 40 : 20 }} />;
  return (
    <View style={{ height: h }}>
      <Image source={{ uri }} style={{ width: "100%", height: h, opacity: 0.92 }} />
      <Verlauf hoehe={gross ? 150 : 110} />
    </View>
  );
}

/* ══ Dialog ══════════════════════════════════════════════════════════════ */

export function Dialog({ titel, children, aufSchliessen }) {
  return (
    <FokusOverlay><View style={st.dialogHinter}>
      <View style={st.dialogKasten}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
          {!!titel && <Text style={[st.h2, { flex: 1 }]}>{titel}</Text>}
          {aufSchliessen && <FKnopf accessibilityLabel="Menü schließen" bereich="dialog" zeile={-1} spalte={1} onPress={aufSchliessen} style={st.rundKnopf} fokusStil={st.fokus}><Icon name="close" /></FKnopf>}
        </View>
        {children}
      </View>
    </View></FokusOverlay>
  );
}

/* ══ Auswahlliste im Dialog (Staffel, Tonspur, Profil …) ═════════════════ */

export function DialogListe({ eintraege, aktiv, aufWahl }) {
  const ref = useRef(null);
  const positionen = useRef(new Map());
  const { height } = useWindowDimensions();
  return (
    <ScrollView ref={ref} style={{ maxHeight: height * .57 }} contentContainerStyle={{ gap: 6, padding: 3 }}>
      {eintraege.map((e, i) => (
        <FKnopf
          key={e.wert ?? i}
          bereich="dialog"
          zeile={i}
          spalte={0}
          onPress={() => aufWahl(e.wert)}
          onLayout={(event) => positionen.current.set(i, event.nativeEvent.layout.y)}
          onFokus={() => ref.current?.scrollTo({ y: Math.max(0, (positionen.current.get(i) || 0) - 80), animated: true })}
          style={[
            st.knopf,
            { justifyContent: "space-between", backgroundColor: C.surface },
            aktiv === e.wert && { backgroundColor: "#e5091426", borderColor: "#e5091459" },
          ]}
          fokusStil={st.fokus}
        >
          <Text style={[st.knopfText, { flex: 1 }]}>{e.text}</Text>
          {aktiv === e.wert && <Icon name="check" color={C.red} />}
        </FKnopf>
      ))}
    </ScrollView>
  );
}

/* ══ QR-Code ═════════════════════════════════════════════════════════════
 * Gezeichnet aus einfachen Rechtecken — kein react-native-svg nötig.
 *
 * Bewusst NICHT ein Rechteck je Punkt: Bei Version 4 wären das über 1200
 * einzelne Views, was auf einem schwachen Fernseher spürbar ruckelt.
 * Stattdessen wird jede Zeile in waagerechte Streifen gleicher Farbe
 * zusammengefasst — bei einem typischen QR-Code sind das etwa zehnmal
 * weniger Elemente, und das Ergebnis sieht identisch aus.
 */
export function QrBild({ text, groesse: wunschGroesse }) {
  const q = useMemo(() => qrErzeugen(text), [text]);
  if (!q) return null;

  const rand = 4;                       // Ruhezone, von der Norm gefordert
  const felder = q.groesse + rand * 2;
  const seite = wunschGroesse ?? (gross ? 320 : 210);
  const punkt = seite / felder;

  const streifen = [];
  for (let z = 0; z < q.groesse; z++) {
    let start = -1;
    for (let s = 0; s <= q.groesse; s++) {
      const schwarz = s < q.groesse && q.punkte[z][s];
      if (schwarz && start < 0) start = s;
      if (!schwarz && start >= 0) {
        streifen.push({ z, s: start, breite: s - start });
        start = -1;
      }
    }
  }

  return (
    <View style={{
      width: seite, height: seite, backgroundColor: "#ffffff",
      borderRadius: 8, padding: rand * punkt,
    }}>
      <View style={{ width: q.groesse * punkt, height: q.groesse * punkt }}>
        {streifen.map((r, i) => (
          <View
            key={i}
            style={{
              position: "absolute",
              left: r.s * punkt,
              top: r.z * punkt,
              width: r.breite * punkt + 0.5,   // halber Punkt gegen Haarlinien
              height: punkt + 0.5,
              backgroundColor: "#000000",
            }}
          />
        ))}
      </View>
    </View>
  );
}

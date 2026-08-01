/**
 * Seitenleiste — die Navigation links, wie in der Desktop-App.
 *
 * Die Einträge sind dieselben wie dort (Layout.tsx, Liste NAV):
 *   Start · Filme · Serien · Meine Liste · Einstellungen
 * samt Zählern hinter Filme und Serien und dem Profil-Knopf unten.
 *
 * VERHALTEN AM FERNSEHER
 * Im Ruhezustand ist die Leiste schmal und zeigt nur Symbole — so bleibt für
 * die Bibliothek maximal Platz. Sobald der Fokus hineinwandert, fährt sie aus
 * und zeigt die Beschriftungen. Genau so machen es Plex und Jellyfin, und aus
 * gutem Grund: Symbole allein sind aus drei Metern nicht eindeutig, eine
 * dauerhaft breite Leiste kostet aber ein Sechstel des Bildschirms.
 *
 * Am Handy ist die Leiste immer schmal, weil dort der Platz noch knapper ist
 * und ohnehin getippt statt navigiert wird.
 */
import React from "react";
import { Text, View } from "react-native";
import { FKnopf } from "./fokus.js";
import { C, M, gross, st } from "./stile.js";

/**
 * Symbole als Text — keine Bild-Abhängigkeit, die beim Start fehlen könnte.
 *
 * Bewusst schlichte Zeichen statt bunter Emoji: Die früheren 🎬📺🔍⚙ wurden
 * vom Betriebssystem als farbige Bildchen gezeichnet und sahen neben der
 * ruhigen, dunklen Oberfläche wie Fremdkörper aus — auf dem Fernseher aus
 * drei Metern zudem unscharf. Diese Zeichen nehmen die Textfarbe an und
 * passen sich damit Auswahl und Fokus an, wie am Desktop.
 */
export const NAV = [
  { id: "home",     text: "Start",         kurz: "Start",  symbol: "⌂" },
  { id: "movies",   text: "Filme",         kurz: "Filme",  symbol: "▶" },
  { id: "shows",    text: "Serien",        kurz: "Serien", symbol: "☰" },
  { id: "list",     text: "Meine Liste",   kurz: "Liste",  symbol: "♥" },
  { id: "search",   text: "Suche",         kurz: "Suche",  symbol: "⌕" },
  { id: "settings", text: "Einstellungen", kurz: "Mehr",   symbol: "⚙" },
];

/**
 * Navigation am unteren Rand — der Weg, den Netflix, Disney+ und Prime am
 * Handy gehen.
 *
 * WARUM ES SIE GIBT: Die Seitenleiste war fest 190 Punkte breit. Auf einem
 * Handy mit rund 390 Punkten ist das die halbe Anzeige; der Inhalt daneben
 * wurde so schmal, dass Überschriften mitten im Wort umbrachen („Weitersch
 * auen") und Knopfbeschriftungen zu Buchstabensalat wurden („Serv er wech
 * seln"). Unten kostet die Navigation nur etwa 60 Punkte Höhe, und der
 * Inhalt bekommt die volle Breite.
 *
 * Der Fokus-Bereich heißt weiterhin "nav", damit die Fernbedienung dieselbe
 * Logik benutzt — nur die Richtung dreht sich: hier zählt die SPALTE.
 */
export function Unterleiste({ seite, aufSeite, zahlen }) {
  return (
    <View style={st.unten}>
      {NAV.map((n, i) => {
        const aktiv = seite === n.id;
        return (
          <FKnopf
            key={n.id}
            bereich="nav"
            zeile={0}
            spalte={i}
            id={"nav:" + n.id}
            onPress={() => aufSeite(n.id)}
            style={st.untenEintrag}
          >
            {({ fokus }) => {
              const farbe = aktiv ? C.red : fokus ? C.text : C.muted;
              return (
                <>
                  <View>
                    <Text style={[st.untenSymbol, { color: farbe }]}>{n.symbol}</Text>
                    {zahlen?.[n.id] != null && (
                      <View style={st.untenBlase}>
                        <Text style={st.untenBlaseText} numberOfLines={1}>
                          {zahlen[n.id] > 99 ? "99+" : zahlen[n.id]}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text numberOfLines={1} style={[st.untenText, { color: farbe }]}>
                    {n.kurz}
                  </Text>
                </>
              );
            }}
          </FKnopf>
        );
      })}
    </View>
  );
}

export function Seitenleiste({ seite, aufSeite, zahlen, profilName, version, offen, aufOffen }) {
  const breit = offen;
  return (
    <View style={[st.nav, { width: breit ? M.navBreit : M.navSchmal }]}>
      {breit ? (
        <Text style={st.navMarke}>GHGFlix</Text>
      ) : (
        <Text style={st.navMarkeKurz}>G</Text>
      )}

      <View style={{ flex: 1 }}>
        {NAV.map((n, i) => {
          const aktiv = seite === n.id;
          return (
            <FKnopf
              key={n.id}
              bereich="nav"
              zeile={i}
              spalte={0}
              id={"nav:" + n.id}
              onPress={() => aufSeite(n.id)}
              style={[st.navEintrag, aktiv && st.navEintragAktiv, !breit && { justifyContent: "center", paddingHorizontal: 0 }]}
              fokusStil={st.navEintragFokus}
            >
              {({ fokus }) => (
                <>
                  <Text style={[st.navSymbol, { color: aktiv ? C.red : fokus ? C.text : C.muted }]}>
                    {n.symbol}
                  </Text>
                  {breit && (
                    <>
                      <Text
                        numberOfLines={1}
                        style={[st.navText, aktiv && st.navTextAktiv, fokus && !aktiv && st.navTextFokus]}
                      >
                        {n.text}
                      </Text>
                      {zahlen?.[n.id] != null && (
                        <Text style={st.navZahl}>{zahlen[n.id]}</Text>
                      )}
                    </>
                  )}
                </>
              )}
            </FKnopf>
          );
        })}
      </View>

      {/* Profil unten — wie am Desktop */}
      <FKnopf
        bereich="nav"
        zeile={NAV.length}
        spalte={0}
        id="nav:profil"
        onPress={() => aufSeite("profiles")}
        style={[st.navEintrag, !breit && { justifyContent: "center", paddingHorizontal: 0 }]}
        fokusStil={st.navEintragFokus}
      >
        <View
          style={{
            width: gross ? 34 : 28, height: gross ? 34 : 28, borderRadius: 9,
            backgroundColor: C.red, alignItems: "center", justifyContent: "center",
          }}
        >
          <Text style={{ color: C.weiss, fontWeight: "900", fontSize: gross ? 16 : 13 }}>
            {(profilName || "P").slice(0, 1).toUpperCase()}
          </Text>
        </View>
        {breit && (
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: C.text, fontSize: gross ? 14 : 12, fontWeight: "700" }}>
              {profilName || "Profil"}
            </Text>
            <Text style={{ color: C.muted, fontSize: gross ? 11.5 : 10 }}>wechseln</Text>
          </View>
        )}
      </FKnopf>

      {breit && (
        <View style={st.navFuss}>
          <View style={{ height: 2, width: 44, backgroundColor: C.red, opacity: 0.6, marginBottom: 6, borderRadius: 1 }} />
          <Text style={st.navVersion}>GHGFlix{version ? ` · v${version}` : ""}</Text>
        </View>
      )}
    </View>
  );
}

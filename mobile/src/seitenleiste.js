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

/** Symbole als Text — keine Bild-Abhängigkeit, die beim Start fehlen könnte. */
export const NAV = [
  { id: "home",     text: "Start",         symbol: "⌂" },
  { id: "movies",   text: "Filme",         symbol: "🎬" },
  { id: "shows",    text: "Serien",        symbol: "📺" },
  { id: "list",     text: "Meine Liste",   symbol: "♥" },
  { id: "search",   text: "Suche",         symbol: "🔍" },
  { id: "settings", text: "Einstellungen", symbol: "⚙" },
];

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

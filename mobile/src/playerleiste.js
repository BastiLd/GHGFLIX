import React from "react";
import { Text, View } from "react-native";
import { FKnopf, FokusReihe } from "./fokus.js";
import { gross, st } from "./stile.js";

// Explicit rows keep the remote's logical coordinates aligned with the layout.
export function PlayerKnopfleiste({ breite, knoepfe }) {
  const gap = gross ? 14 : 10;
  const maxBreite = gross ? 128 : 100;
  const spalten = Math.max(1, Math.min(knoepfe.length, Math.floor((breite + gap) / (maxBreite + gap))));
  const knopfBreite = Math.min(maxBreite, (breite - gap * (spalten - 1)) / spalten);
  const zeilen = [];
  for (let start = 0; start < knoepfe.length; start += spalten) zeilen.push(knoepfe.slice(start, start + spalten));
  return zeilen.map((zeile, index) => (
    <FokusReihe key={index} zeile={index + 1}>
      <View style={st.playerKnopfReihe}>
        {zeile.map((k, spalte) => (
          <FKnopf key={k.id} id={`player:knopf:${k.id}`} spalte={spalte}
            accessibilityLabel={k.label} onPress={k.onPress}
            style={[st.rundKnopf, k.haupt && st.rundKnopfHaupt, { width: knopfBreite, minWidth: 0, paddingHorizontal: 4 }]}
            fokusStil={st.fokus}>
            {!!k.symbol && <Text style={st.rundKnopfText}>{k.symbol}</Text>}
            {!!k.text && <Text numberOfLines={1} style={st.rundKnopfText}>{k.text}</Text>}
          </FKnopf>
        ))}
      </View>
    </FokusReihe>
  ));
}

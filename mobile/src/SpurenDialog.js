import React, { useEffect, useRef, useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { FKnopf, FokusOverlay, useFokusSystem } from "./fokus.js";
import { Icon } from "./Icons.js";
import { C, gross, st } from "./stile.js";

/** Schmale TV-Seitenfläche mit Audio-/Untertitel-Reitern; Touch als Bottom Sheet. */
export function SpurenDialog({ audio, untertitel, ton, ut, aufTon, aufUt, aufSchliessen, aufDarstellung, aufMerken, status }) {
  const { height, width } = useWindowDimensions();
  const breit = !gross && width >= 700;
  const [tab, setTab] = useState("audio");
  const [gemerkt, setGemerkt] = useState(false);
  const sys = useFokusSystem();
  const audioId = `spur:audio:${ton?.id || audio[0]?.id}`;
  const utId = `spur:sub:${ut?.id || "aus"}`;
  const listenHoehe = Math.max(110, height - (gross ? 285 : breit ? 260 : 320));
  const sub = [{ id: "aus", name: "Aus", text: true }, ...untertitel];
  return <FokusOverlay><View style={[st.dialogHinter, { padding: gross ? 18 : 12, alignItems: gross ? "flex-end" : "center", justifyContent: gross ? "center" : "flex-end", backgroundColor: "#00000070" }]}>
    <View style={{ width: "100%", maxWidth: gross ? 400 : breit ? 720 : 440, maxHeight: "100%", backgroundColor: "#16181f", borderColor: "#363943", borderWidth: 1, borderRadius: 8, padding: gross ? 18 : 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 10 }}>
        <View style={{ flex: 1 }}><Text style={{ color: "white", fontWeight: "800", fontSize: gross ? 19 : 18 }}>Sprache & Untertitel</Text>
          <Text style={{ color: "#adb2c2", fontSize: 12, marginTop: 6 }}>Auswahl für diesen Titel</Text></View>
        <FKnopf id="spuren:fertig" accessibilityLabel="Fertig" bereich="dialog" zeile={-2} spalte={1} onPress={aufSchliessen} style={[st.rundKnopf, { minWidth: 36, height: 36 }]} fokusStil={st.fokus}><Icon name="close" /></FKnopf>
      </View>
      {!breit && <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
        {[["audio", "Audio", "audio"], ["sub", "Untertitel", "subtitles"]].map(([id, text, icon], i) => <FKnopf key={id} accessibilityLabel={text} bereich="dialog" zeile={0} spalte={i} onPress={() => setTab(id)} style={{ flex: 1, minHeight: 38, borderRadius: 8, borderWidth: 2, borderColor: tab === id ? "#ff4050" : "transparent", backgroundColor: tab === id ? "#e5091424" : C.surface, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 }} fokusStil={st.fokus}><Icon name={icon} size={20} /><Text style={{ color: "white", fontWeight: "700", fontSize: 15 }}>{text}</Text></FKnopf>)}
      </View>}
      <View style={{ flexDirection: breit ? "row" : "column", gap: 16, flexShrink: 1 }}>
        {(breit || tab === "audio") && <View style={{ flex: breit ? 1 : undefined, minWidth: 0, flexShrink: 1 }}>
          <Ueberschrift icon="audio" text="Audio" aktuell={ton?.name || "Keine Tonspur vorhanden"} />
          <SpurListe start liste={audio} art="audio" aufSeite={gross ? () => setTab("sub") : null} aktiv={ton?.id} aufWahl={(id) => { setGemerkt(false); aufTon(id); }} hoehe={listenHoehe} spalte={0} nachbar={breit ? utId : null} />
          {audio.length === 0 && <Hinweis>Diese Datei enthält keine Tonspur.</Hinweis>}
          {audio.length === 1 && <Hinweis>Diese Datei enthält nur diese Tonspur.</Hinweis>}
        </View>}
        {(breit || tab === "sub") && <View style={{ flex: breit ? 1 : undefined, minWidth: 0, flexShrink: 1 }}>
          <Ueberschrift icon="subtitles" text="Untertitel" aktuell={ut?.name || "Aus"} />
          <SpurListe start={!audio.length || !breit} liste={sub} art="sub" aufSeite={gross ? () => setTab("audio") : null} aktiv={ut?.id || "aus"} aufWahl={(id) => { setGemerkt(false); aufUt(id); }} hoehe={listenHoehe} spalte={breit ? 1 : 0} nachbar={breit && audio.length ? audioId : null} />
          {!untertitel.length && <Hinweis>Für diesen Titel sind keine Untertitel vorhanden.</Hinweis>}
        </View>}
      </View>
      {!!status && <Text accessibilityRole="alert" style={{ color: "#ffca85", fontSize: 12, marginTop: 10 }}>{status}</Text>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 12, paddingTop: 10, borderTopColor: "#343741", borderTopWidth: 1 }}>
        <FKnopf id="spuren:darstellung" bereich="dialog" zeile={100} spalte={0} onPress={aufDarstellung} style={[st.knopf, { flex: 1, minWidth: 120, paddingHorizontal: 10 }]} fokusStil={st.fokus}><Icon name="text" size={20} /><Text style={{ color: "white", fontWeight: "600", fontSize: 12 }}>Darstellung</Text></FKnopf>
        <FKnopf bereich="dialog" zeile={100} spalte={1} onPress={() => { aufMerken(); setGemerkt(true); }} style={[st.knopf, { flex: 1, minWidth: 140, paddingHorizontal: 10 }]} fokusStil={st.fokus}><Icon name="check" size={20} /><Text style={{ color: "white", fontWeight: "600", fontSize: 12 }}>{gemerkt ? "Standard gespeichert" : "Als Standard merken"}</Text></FKnopf>
      </View>
      <Text style={{ color: "#9ca3b6", marginTop: 10, fontSize: 11 }}>{gemerkt ? "Für weitere Titel auf diesem Gerät gespeichert." : gross ? "← → Audio / Untertitel   ·   OK wählen   ·   Zurück schließen" : "Audio und Untertitel lassen sich getrennt auswählen."}</Text>
    </View>
  </View></FokusOverlay>;
}

function Ueberschrift({ icon, text, aktuell }) {
  return <View style={{ marginBottom: 10 }}><View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Icon name={icon} size={18} /><Text style={{ color: "white", fontSize: 15, fontWeight: "700" }}>{text}</Text></View><Text numberOfLines={2} style={{ color: "#adb2c2", fontSize: 11, marginTop: 5 }}>{aktuell}</Text></View>;
}
function Hinweis({ children }) { return <Text style={{ color: "#abb1c2", fontSize: 12, marginTop: 10, lineHeight: gross ? 21 : 19 }}>{children}</Text>; }

function SpurListe({ liste, art, aktiv, aufWahl, hoehe, spalte, nachbar, start, aufSeite }) {
  const ref = useRef(null), positionen = useRef(new Map());
  const sys = useFokusSystem();
  const waehlbar = liste.filter((s) => art === "audio" || (s.text && !s.bild));
  // Erst im gemounteten Portal fokussieren; vorher existieren die Zeilen noch nicht.
  useEffect(() => {
    if (!start || !waehlbar.length) return;
    const t = setTimeout(() => sys?.kern.setzen(`spur:${art}:${aktiv || waehlbar[0].id}`), 0);
    return () => clearTimeout(t);
  }, [art]);
  return <ScrollView ref={ref} style={{ maxHeight: hoehe }} contentContainerStyle={{ gap: 4, padding: 3 }}>
    {liste.map((spur, i) => {
      const an = spur.id === aktiv;
      const unbrauchbar = art === "sub" && (!spur.text || spur.bild);
      const [name, ...zusatz] = spur.name.split(" · ");
      return <FKnopf key={spur.id} id={`spur:${art}:${spur.id}`} accessibilityLabel={`${art === "audio" ? "Audio" : "Untertitel"}: ${spur.name}${an ? ", ausgewählt" : ""}`} bereich="dialog" zeile={i + 1} spalte={spalte} disabled={unbrauchbar}
        aufRichtung={(r) => {
          if (aufSeite && ((art === "audio" && r === "right") || (art === "sub" && r === "left"))) { aufSeite(); return true; }
          if (nachbar && ((art === "audio" && r === "right") || (art === "sub" && r === "left"))) { sys?.kern.setzen(nachbar); return true; }
          if (r === "down" && spur.id === waehlbar.at(-1)?.id) { sys?.kern.setzen("spuren:darstellung"); return true; }
          return false;
        }}
        onPress={() => aufWahl(spur.id)} onLayout={(e) => positionen.current.set(spur.id, e.nativeEvent.layout.y)}
        onFokus={() => ref.current?.scrollTo({ y: Math.max(0, (positionen.current.get(spur.id) || 0) - 55), animated: true })}
        style={{ minHeight: 44, padding: 8, borderWidth: 2, borderColor: an ? "#b83446" : "transparent", borderRadius: 8, flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: an ? "#4d202a" : "#22252e", opacity: unbrauchbar ? .55 : 1 }} fokusStil={{ borderColor: "white", backgroundColor: "#3c4355" }}>
        <View style={{ width: 22 }}>{an && <Icon name="check" size={22} />}</View>
        <View style={{ flex: 1 }}><Text style={{ color: "white", fontWeight: an ? "700" : "500", fontSize: 14 }}>{name}</Text>
          {(zusatz.length > 0 || unbrauchbar) && <Text style={{ color: "#b7bed0", marginTop: 3, fontSize: 11 }}>{unbrauchbar ? "Bild-Untertitel · auf diesem Player nicht unterstützt" : zusatz.join(" · ")}</Text>}
        </View>
      </FKnopf>;
    })}
  </ScrollView>;
}

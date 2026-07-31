// ============================================================================
// GHGFlix - DIAGNOSE-Fassung
//
// Zweck: herausfinden, WARUM die normale App auf dem Fernseher sofort abstuerzt.
//
// Diese Fassung importiert am Anfang NICHTS ausser React Native selbst. Alle
// Zusatzmodule werden erst NACH dem ersten Bild einzeln geladen - und jedes
// Ergebnis wird auf dem Bildschirm angezeigt.
//
// Damit laesst sich ohne PC und ohne adb ablesen:
//   * Startet das Grundgeruest ueberhaupt?  (siehst du diesen Text -> ja)
//   * Welches Zusatzmodul laesst sich nicht laden?
//   * Welche Android-Version und welcher Prozessortyp steckt im Fernseher?
//
// Gebaut wird sie mit dem EAS-Profil "diagnose":
//   npx eas-cli build --platform android --profile diagnose
// ============================================================================
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, Text, View } from "react-native";

const C = { bg: "#0b0b0f", text: "#f2f2f5", muted: "#9a9aa5", red: "#e50914", ok: "#34d399" };

/** Ein Modul laden und das Ergebnis als Text zurueckgeben. */
function pruefe(name, laden) {
  try {
    const m = laden();
    if (!m) return { name, ok: false, info: "geladen, aber leer" };
    const schluessel = Object.keys(m).slice(0, 4).join(", ");
    return { name, ok: true, info: schluessel || "geladen" };
  } catch (e) {
    return { name, ok: false, info: String(e?.message || e).slice(0, 200) };
  }
}

export default function App() {
  const [zeilen, setZeilen] = useState([]);
  const [fertig, setFertig] = useState(false);

  useEffect(() => {
    // Absichtlich NACH dem ersten Bild: so sieht man diesen Bildschirm auch,
    // wenn eines der Module beim Laden Probleme macht.
    const ergebnisse = [];
    ergebnisse.push(pruefe("react-native", () => require("react-native")));
    ergebnisse.push(pruefe("expo", () => require("expo")));
    ergebnisse.push(pruefe("expo-constants", () => require("expo-constants")));
    ergebnisse.push(pruefe("expo-status-bar", () => require("expo-status-bar")));
    ergebnisse.push(pruefe("expo-keep-awake", () => require("expo-keep-awake")));
    ergebnisse.push(pruefe("async-storage", () => require("@react-native-async-storage/async-storage")));
    // Der heisseste Verdaechtige kommt zuletzt:
    ergebnisse.push(pruefe("expo-video", () => require("expo-video")));
    setZeilen(ergebnisse);
    setFertig(true);
  }, []);

  let geraet = {};
  try {
    const C2 = require("expo-constants").default;
    geraet = {
      modell: C2?.deviceName || "?",
      systemVersion: C2?.systemVersion || "?",
      expoVersion: C2?.expoVersion || "?",
    };
  } catch {
    geraet = { modell: "?", systemVersion: "?", expoVersion: "?" };
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: C.bg }} contentContainerStyle={{ padding: 24, paddingTop: 60 }}>
      <Text style={{ color: C.red, fontSize: 28, fontWeight: "900" }}>GHGFlix Diagnose</Text>
      <Text style={{ color: C.ok, fontSize: 15, marginTop: 8 }}>
        Wenn du das hier liest, startet die App grundsaetzlich.
      </Text>

      <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginTop: 26 }}>Geraet</Text>
      <Text style={{ color: C.muted, fontSize: 13, marginTop: 6 }}>
        Android-Version: {String(Platform.Version)}
        {"\n"}Plattform: {Platform.OS}
        {"\n"}Modell: {geraet.modell}
        {"\n"}System: {geraet.systemVersion}
        {"\n"}Expo: {geraet.expoVersion}
        {"\n"}Hermes: {typeof HermesInternal === "undefined" ? "nein" : "ja"}
      </Text>

      <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginTop: 26 }}>Module</Text>
      {!fertig && <Text style={{ color: C.muted, marginTop: 8 }}>wird geprueft ...</Text>}
      {zeilen.map((z) => (
        <View key={z.name} style={{ marginTop: 12 }}>
          <Text style={{ color: z.ok ? C.ok : C.red, fontSize: 15, fontWeight: "700" }}>
            {z.ok ? "OK  " : "FEHLER  "}
            {z.name}
          </Text>
          <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{z.info}</Text>
        </View>
      ))}

      <Text style={{ color: C.text, fontSize: 17, fontWeight: "700", marginTop: 30 }}>Was nun?</Text>
      <Text style={{ color: C.muted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
        Diesen Bildschirm abfotografieren und an Claude schicken. Daraus laesst
        sich ablesen, welcher Baustein auf diesem Fernseher Probleme macht -
        ganz ohne PC und ohne adb.
        {"\n\n"}
        Steht bei allen Modulen OK, liegt es NICHT an den Modulen, sondern an
        etwas in der Hauptanwendung.
      </Text>
    </ScrollView>
  );
}

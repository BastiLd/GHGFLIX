import React from "react";
import { Image, Text, View, useWindowDimensions } from "react-native";
import { FKnopf } from "../../mobile/src/fokus.js";
import { C } from "../../mobile/src/stile.js";
import { NAV } from "../../mobile/src/seitenleiste.js";
import { Icon } from "../../mobile/src/Icons.js";

/** Feste Schiene: Beim Fokuswechsel verschiebt sich die Mediathek nicht. */
export function TVShell({ seite, aufSeite, zahlen, profilName, profilAvatar, child = false, children }) {
  // Viele 1080p-TVs melden nur 960×540 Layoutpunkte. Auch dort müssen alle
  // Navigationspunkte samt Profil ohne Scrollen erreichbar bleiben.
  const { height } = useWindowDimensions();
  const s = Math.min(1, Math.max(.6, height / 720));
  return (
    <View style={{ flex: 1, flexDirection: "row", backgroundColor: C.bg, padding: 18 * s, gap: 16 * s }}>
      <View style={{ width: 88 * s, paddingVertical: 8 * s }}>
        <Text style={{ color: C.red, fontSize: 19 * s, fontWeight: "900", textAlign: "center", marginBottom: 3 }}>GHGFlix</Text>
        <Text style={{ color: C.muted, fontSize: 10, letterSpacing: 4, textAlign: "center", marginBottom: 18 * s }}>TV</Text>
        {NAV.filter(n=>!child||!["channels","settings"].includes(n.id)).map((n, i) => (
          <FKnopf key={n.id} id={`nav:${n.id}`} bereich="nav" zeile={i} spalte={0}
            accessibilityLabel={n.text} onPress={() => aufSeite(n.id)}
            style={{ height: 54 * s, borderWidth: 2, borderColor: "transparent", borderRadius: 8, marginBottom: 5 * s, justifyContent: "center", alignItems: "center", backgroundColor: seite === n.id ? "#e5091422" : "transparent" }}
            fokusStil={{ borderColor: C.weiss, backgroundColor: C.surface2 }}>
            <Icon name={n.symbol} size={22 * s} color={seite === n.id ? "#ff5263" : C.text} style={{ marginBottom: 3 * s }} />
            <Text numberOfLines={1} style={{ color: seite === n.id ? "#ff8090" : "#c0c2d0", fontSize: Math.max(10, 11 * s), fontWeight: "600" }}>{n.text}{n.id === "channels" && zahlen?.channels ? ` (${Math.min(99, zahlen.channels)})` : ""}</Text>
          </FKnopf>
        ))}
        <View style={{ flex: 1 }} />
        <FKnopf id="nav:profil" bereich="nav" zeile={NAV.length} spalte={0} accessibilityLabel="Account & Profile"
          onPress={() => aufSeite("profiles")} style={{ borderWidth: 2, borderColor: "transparent", borderRadius: 12, padding: 10, alignItems: "center", gap: 5 }} fokusStil={{ borderColor: C.weiss }}>
          <View style={{ width: 30, height: 30, backgroundColor: profilAvatar ? "transparent" : "#3c465d", borderRadius: 15, overflow: "hidden", alignItems: "center", justifyContent: "center" }}>{profilAvatar?<Image source={{uri:profilAvatar}} style={{width:30,height:30,borderRadius:15}}/>:<Text style={{ color: "white", fontWeight: "800" }}>{(profilName || "P")[0]}</Text>}</View>
          <Text numberOfLines={1} style={{ color: C.muted, fontSize: 11 }}>{profilName || "Profil"}</Text>
          <Text style={{ color: C.muted, fontSize: 10 }}>Account & Profile</Text>
        </FKnopf>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ height: 28, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Text style={{ color: "#d3d5e1", fontSize: 14, fontWeight: "600" }}>{NAV.find((n) => n.id === seite)?.text || "Deine Mediathek"}</Text>
          <Text style={{ color: "#777e94", fontSize: 12 }}>{zahlen?.movies || 0} Filme  ·  {zahlen?.shows || 0} Serien</Text>
        </View>
        <View style={{ flex: 1, borderRadius: 18, overflow: "hidden" }}>{children}</View>
        <View style={{ height: 22, justifyContent: "flex-end" }}><Text style={{ color: "#777e94", fontSize: 11 }}>↑ ↓ ← → Bewegen     OK Auswählen     ↶ Zurück</Text></View>
      </View>
    </View>
  );
}

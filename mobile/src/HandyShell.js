import React from "react";
import { Image, Text, View } from "react-native";
import { FKnopf } from "./fokus.js";
import { C } from "./stile.js";
import { Unterleiste } from "./seitenleiste.js";
import { Icon } from "./Icons.js";

export function HandyShell({ seite, aufSeite, zahlen, profilName, profilAvatar, child = false, children }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ height: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#20212c" }}>
        <Text style={{ color: C.red, fontWeight: "900", fontSize: 21, letterSpacing: -.8 }}>GHGFlix</Text>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <FKnopf accessibilityLabel="Meine Liste" hitSlop={5} onPress={() => aufSeite("list")} style={{ width: 34, height: 34, borderRadius: 8, justifyContent: "center", alignItems: "center", backgroundColor: seite === "list" ? "#e5091428" : "transparent" }}><Icon name="heart" size={20} /></FKnopf>
          <FKnopf accessibilityLabel="Account & Profile" hitSlop={5} onPress={() => aufSeite("profiles")} style={{ width: 32, height: 32, borderRadius: 16, overflow: "hidden", backgroundColor: profilAvatar ? "transparent" : "#39445c", justifyContent: "center", alignItems: "center" }}>{profilAvatar?<Image source={{uri:profilAvatar}} style={{width:32,height:32,borderRadius:16}}/>:<Text style={{ color: C.text, fontSize: 13, fontWeight: "700" }}>{(profilName || "P")[0]}</Text>}</FKnopf>
        </View>
      </View>
      <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
      <Unterleiste seite={seite} aufSeite={aufSeite} zahlen={zahlen} child={child} handy />
    </View>
  );
}

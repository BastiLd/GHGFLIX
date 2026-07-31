/**
 * Verbindungsbildschirm — der erste Eindruck der App.
 *
 * Ziel: Am Fernseher soll man NICHTS eintippen müssen. Deshalb sucht die App
 * den Server beim Öffnen von selbst (netzsuche.js) und meldet nur noch, was
 * sie gefunden hat. Die Eingabe von Hand bleibt als Rückfalltür bestehen —
 * am Handy ist sie oft schneller, und für einen Server außerhalb des
 * Heimnetzes (Fernzugriff) gibt es keinen anderen Weg.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { FKnopf, FokusReihe } from "./fokus.js";
import { FFeld, Knopf } from "./bausteine.js";
import { C, M, gross, st } from "./stile.js";
import { normUrl, ping, sucheServer } from "./netzsuche.js";

export function VerbindungsScreen({ conn, aufSpeichern, aufAbbruch }) {
  const [zustand, setZustand] = useState("suche");   // suche | gefunden | hand
  const [melde, setMelde] = useState("Server wird gesucht …");
  const [gefunden, setGefunden] = useState(null);
  const [adresse, setAdresse] = useState(conn?.manualUrl || conn?.list?.[0]?.url || "");
  const [passwort, setPasswort] = useState("");
  const [hinweis, setHinweis] = useState("");
  const [beschaeftigt, setBeschaeftigt] = useState(false);
  const abbruchRef = useRef(false);

  const bekannte = [
    ...(conn?.list || []).map((e) => e.url),
    conn?.manualUrl,
  ].filter(Boolean);

  /* ── Automatische Suche beim Öffnen ───────────────────────────────── */
  const suchen = useCallback(async () => {
    abbruchRef.current = false;
    setZustand("suche");
    setMelde("Server wird gesucht …");
    const t = await sucheServer(bekannte, setMelde, () => abbruchRef.current);
    if (abbruchRef.current) return;
    if (t) {
      setGefunden(t);
      setZustand("gefunden");
    } else {
      setMelde("Kein Server gefunden");
      setZustand("hand");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(bekannte)]);

  useEffect(() => {
    suchen();
    return () => { abbruchRef.current = true; };
  }, [suchen]);

  /* ── Übernehmen ───────────────────────────────────────────────────── */
  const uebernehmen = async (url, pw) => {
    setBeschaeftigt(true);
    setHinweis("");
    const basis = normUrl(url);
    const antwort = await ping(basis, 4000);
    if (!antwort) {
      setHinweis("Unter dieser Adresse antwortet kein GHGFlix-Server.");
      setBeschaeftigt(false);
      return;
    }
    let token = conn?.token || "";
    if (antwort.auth && pw) {
      try {
        const r = await fetch(`${basis}/api/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: pw }),
        }).then((x) => x.json());
        if (r?.token) token = r.token;
        else {
          setHinweis("Passwort nicht angenommen.");
          setBeschaeftigt(false);
          return;
        }
      } catch {
        setHinweis("Anmeldung fehlgeschlagen.");
        setBeschaeftigt(false);
        return;
      }
    } else if (antwort.auth && !token) {
      setHinweis("Dieser Server verlangt ein Passwort.");
      setBeschaeftigt(false);
      setZustand("hand");
      return;
    }
    // Gefundene Adresse nach vorn, alte als Ausweichadressen behalten
    const liste = [
      { name: "Gefunden", url: basis },
      ...(conn?.list || []).filter((e) => normUrl(e.url) !== basis),
    ].slice(0, 4);
    setBeschaeftigt(false);
    aufSpeichern({ mode: "auto", list: liste, manualUrl: basis, token });
  };

  /* ── Anzeige ──────────────────────────────────────────────────────── */
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentContainerStyle={{ padding: M.rand, paddingTop: gross ? 70 : 46, alignItems: "center" }}
    >
      <View style={{ width: "100%", maxWidth: gross ? 760 : 520 }}>
        <Text style={[st.marke, { marginBottom: 6 }]}>GHGFlix</Text>
        <Text style={[st.gedaempft, { marginBottom: gross ? 30 : 20 }]}>
          Verbindung zum Medienserver
        </Text>

        {/* ── Suche läuft ──────────────────────────────────────────── */}
        {zustand === "suche" && (
          <View style={[st.karte, { alignItems: "center", paddingVertical: gross ? 42 : 30 }]}>
            <ActivityIndicator size="large" color={C.red} />
            <Text style={[st.h2, { marginTop: 18, textAlign: "center" }]}>Suche läuft</Text>
            <Text style={[st.gedaempft, { marginTop: 8, textAlign: "center" }]}>{melde}</Text>
            <Text style={[st.gedaempft, { marginTop: 14, textAlign: "center", fontSize: M.klein }]}>
              Der Server wird im eigenen Netz gesucht.{"\n"}Das dauert meist nur ein paar Sekunden.
            </Text>
            <View style={{ height: 20 }} />
            <FokusReihe zeile={0}>
              <View style={{ flexDirection: "row", gap: 10 }}>
                <Knopf
                  text="Adresse von Hand eingeben"
                  spalte={0}
                  onPress={() => { abbruchRef.current = true; setZustand("hand"); }}
                />
              </View>
            </FokusReihe>
          </View>
        )}

        {/* ── Server gefunden ──────────────────────────────────────── */}
        {zustand === "gefunden" && gefunden && (
          <View style={st.karte}>
            <Text style={[st.h2, { marginBottom: 4 }]}>Server gefunden</Text>
            <Text style={[st.fliess, { marginBottom: 4 }]}>{gefunden.url}</Text>
            <Text style={[st.gedaempft, { marginBottom: 18 }]}>
              GHGFlix-Server
              {gefunden.info?.version ? ` · Version ${gefunden.info.version}` : ""}
              {gefunden.info?.auth ? " · Passwort nötig" : ""}
            </Text>

            {gefunden.info?.auth && !conn?.token && (
              <View style={{ marginBottom: 16 }}>
                <Text style={[st.gedaempft, { marginBottom: 6 }]}>Server-Passwort</Text>
                <FokusReihe zeile={0}>
                  <FFeld
                    spalte={0}
                    wert={passwort}
                    aufWert={setPasswort}
                    platzhalter="Passwort"
                    secureTextEntry
                  />
                </FokusReihe>
              </View>
            )}

            {!!hinweis && (
              <View style={[st.hinweis, { marginBottom: 14 }]}>
                <Text style={{ color: C.text, fontSize: M.klein }}>{hinweis}</Text>
              </View>
            )}

            <FokusReihe zeile={1}>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Knopf
                  text={beschaeftigt ? "Verbinde …" : "Verbinden"}
                  symbol="✓"
                  haupt
                  spalte={0}
                  onPress={() => !beschaeftigt && uebernehmen(gefunden.url, passwort)}
                />
                <Knopf text="Erneut suchen" spalte={1} onPress={suchen} />
                <Knopf text="Von Hand" spalte={2} onPress={() => { setAdresse(gefunden.url); setZustand("hand"); }} />
              </View>
            </FokusReihe>
          </View>
        )}

        {/* ── Von Hand ─────────────────────────────────────────────── */}
        {zustand === "hand" && (
          <View style={st.karte}>
            <Text style={[st.h2, { marginBottom: 4 }]}>Adresse eingeben</Text>
            <Text style={[st.gedaempft, { marginBottom: 16 }]}>
              Zum Beispiel 192.168.1.50:8484 — „http://" wird von selbst ergänzt.
            </Text>

            <Text style={[st.gedaempft, { marginBottom: 6 }]}>Server-Adresse</Text>
            <FokusReihe zeile={0}>
              <FFeld
                spalte={0}
                wert={adresse}
                aufWert={setAdresse}
                platzhalter="192.168.1.50:8484"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            </FokusReihe>

            <View style={{ height: 14 }} />
            <Text style={[st.gedaempft, { marginBottom: 6 }]}>Passwort (nur falls eingerichtet)</Text>
            <FokusReihe zeile={1}>
              <FFeld
                spalte={0}
                wert={passwort}
                aufWert={setPasswort}
                platzhalter="leer lassen, wenn keins vergeben"
                secureTextEntry
              />
            </FokusReihe>

            {!!hinweis && (
              <View style={[st.hinweis, { marginTop: 14 }]}>
                <Text style={{ color: C.text, fontSize: M.klein }}>{hinweis}</Text>
              </View>
            )}

            <View style={{ height: 18 }} />
            <FokusReihe zeile={2}>
              <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                <Knopf
                  text={beschaeftigt ? "Prüfe …" : "Verbinden"}
                  symbol="✓"
                  haupt
                  spalte={0}
                  onPress={() => !beschaeftigt && adresse.trim() && uebernehmen(adresse, passwort)}
                />
                <Knopf text="Automatisch suchen" symbol="⟳" spalte={1} onPress={suchen} />
                {!!aufAbbruch && <Knopf text="Zurück" spalte={2} onPress={aufAbbruch} />}
              </View>
            </FokusReihe>
          </View>
        )}

        <Text style={[st.gedaempft, { marginTop: 20, fontSize: M.klein, textAlign: "center" }]}>
          Tipp: Der Server muss im selben WLAN laufen wie dieses Gerät.
        </Text>
      </View>
    </ScrollView>
  );
}

import React, { useEffect, useMemo, useRef, useState } from "react";
import { AppState, Linking, Platform, Text, View } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { FKnopf, FokusReihe } from "./fokus.js";
import { st } from "./stile.js";
import { kanalAufruf } from "./kanaele-api.js";
import { nativePushClient, notificationBelongsHere } from "./native-push-core.js";

let notifications = null;
try { notifications = require("expo-notifications"); } catch {}
const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;

export function NativePushSettings({ api, serverId, row = 0 }) {
  const client = useMemo(() => nativePushClient({ notifications, storage: AsyncStorage, platform: Platform, projectId, serverId,
    call: (command, args) => kanalAufruf(api, command, args) }), [api, serverId]);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const active = useRef(client), mounted = useRef(true), locked = useRef(false);
  const sequence = useRef(0);
  active.current = client;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let cancelled = false;
    const request = ++sequence.current;
    const current = () => !cancelled && sequence.current === request;
    setBusy(true); setStatus(null); setError("");
    client.status().then(s => { if (current()) setStatus(s); }).catch(() => {
      if (current()) setError("Push-Status nicht erreichbar. Bitte erneut prüfen; eine bestehende Anmeldung bleibt erhalten.");
    }).finally(() => { if (current()) setBusy(locked.current); });
    return () => { cancelled = true; };
  }, [client, revision]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", s => { if (s === "active") setRevision(r => r+1); });
    return () => subscription.remove();
  }, []);
  const change = async (enable) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError("");
    ++sequence.current;
    let problem = "";
    try { if (enable) await client.enable(); else await client.disable(); }
    catch(e) { problem = e.message || "Push-Anmeldung fehlgeschlagen."; }
    const request = ++sequence.current;
    try {
      const s = await client.status();
      if (mounted.current && active.current === client && sequence.current === request) setStatus(s);
    } catch { if (mounted.current && active.current === client && sequence.current === request) setStatus(null); }
    if (mounted.current && active.current === client) { setError(problem); setBusy(false); }
    locked.current = false;
  };
  const button = (label, action) => <FokusReihe key={label} zeile={row++}><FKnopf spalte={0} accessibilityLabel={label}
    disabled={busy} onPress={busy ? undefined : action} style={st.knopf} fokusStil={st.fokus}><Text style={st.knopfText}>{label}</Text></FKnopf></FokusReihe>;
  return <View>
    <Text style={st.fliess}>Benachrichtigungen auf diesem Gerät</Text>
    <Text style={st.gedaempft}>Standard: nur in der App. Optional meldet Geräte-Push neue Beiträge auch bei geschlossener App über Expo, Google oder Apple. Die Glocke pro Kanal bestimmt die Auswahl.</Text>
    {!client.supported ? <Text style={st.gedaempft}>Geräte-Push ist in diesem Build oder auf diesem Gerät nicht verfügbar. In-App-Meldungen bleiben aktiv.</Text> : <>
      {busy && <Text style={st.gedaempft}>Bitte warten …</Text>}
      {!status ? button("Push-Status erneut prüfen", () => setRevision(r => r+1)) : <>
        {!status.configured && <Text style={st.gedaempft}>Native Geräte-Push ist für diese App am Server noch nicht eingerichtet.</Text>}
        {status.enabled && !status.permitted && <Text style={st.gedaempft}>Die Anmeldung besteht, aber Benachrichtigungen sind in den Geräteeinstellungen gesperrt.</Text>}
        {status.enabled ? button("Geräte-Push ausschalten", () => change(false)) : status.configured && button("Geräte-Push einschalten", () => change(true))}
        {status.enabled && status.configured && button("Geräteanmeldung erneuern", () => change(true))}
        {button("Push-Status erneut prüfen", () => setRevision(r => r+1))}
        {status.enabled && !status.permitted && button("Geräteeinstellungen öffnen", () => Linking.openSettings().catch(() => setError("Geräteeinstellungen konnten nicht geöffnet werden.")))}
      </>}
    </>}
    {!!error && <Text accessibilityLiveRegion="polite" style={st.fliess}>{error}</Text>}
  </View>;
}

export function useNativePushNavigation(serverId, onOpen, onReceived) {
  const handlers = useRef({ onOpen, onReceived }); handlers.current = { onOpen, onReceived };
  const consumed = useRef(null);
  useEffect(() => {
    if (!notifications || !serverId || Platform.isTV) return;
    let cancelled = false;
    const open = response => {
      if (cancelled || !notificationBelongsHere(response, serverId)) return;
      const id = response.notification.request.identifier;
      if (consumed.current === id) return;
      consumed.current = id;
      handlers.current.onOpen();
      notifications.clearLastNotificationResponseAsync().catch(() => {});
    };
    const clicks = notifications.addNotificationResponseReceivedListener(open);
    const received = notifications.addNotificationReceivedListener(() => handlers.current.onReceived());
    notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    return () => { cancelled = true; clicks.remove(); received.remove(); };
  }, [serverId]);
}

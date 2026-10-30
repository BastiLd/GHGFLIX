/** Registration is explicit. Merely opening the app never requests a token. */
export function nativePushClient({ notifications: n, storage, platform, projectId, serverId, call }) {
  const supported = !!n && !platform.isTV && ["android", "ios"].includes(platform.OS) && !!projectId && !!serverId;
  const key = `ghgflix.push.${serverId}`;
  const read = async () => {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some(t => typeof t !== "string")) throw new Error("Die gespeicherte Push-Anmeldung konnte nicht gelesen werden.");
    return value;
  };
  async function status() {
    if (!supported) return { supported: false, enabled: false };
    const known = await read();
    const [server, permission] = await Promise.all([call("native_push_status", { tokens: known }), n.getPermissionsAsync()]);
    let channelBlocked = false;
    if (platform.OS === "android") {
      const channel = await n.getNotificationChannelAsync("kanaele");
      channelBlocked = channel?.importance === 0;
    }
    return { supported: true, enabled: !!server.registered,
      configured: server.configured && server.projectId === projectId,
      permitted: permission.granted && !channelBlocked };
  }
  async function enable() {
    if (!supported) throw new Error("Geräte-Push ist auf diesem Gerät nicht verfügbar.");
    const server = await call("native_push_status", { tokens: [] });
    if (!server.configured || server.projectId !== projectId) throw new Error("Native Geräte-Push ist für diese App am Server noch nicht eingerichtet.");
    if (platform.OS === "android") await n.setNotificationChannelAsync("kanaele", { name: "Neue Kanalbeiträge", importance: n.AndroidImportance.DEFAULT });
    let permission = await n.getPermissionsAsync();
    if (!permission.granted) permission = await n.requestPermissionsAsync();
    if (!permission.granted) throw new Error("Benachrichtigungen sind gesperrt. Bitte in den Geräteeinstellungen freigeben.");
    if (platform.OS === "android" && (await n.getNotificationChannelAsync("kanaele"))?.importance === 0) {
      throw new Error("Der Kanal „Neue Kanalbeiträge“ ist in den Geräteeinstellungen ausgeschaltet.");
    }
    let token;
    try { token = (await n.getExpoPushTokenAsync({ projectId })).data; }
    catch { throw new Error("Geräteanmeldung nicht möglich. Netzwerk sowie FCM-/APNs-Einrichtung des App-Builds prüfen."); }
    if (typeof token !== "string" || !token) throw new Error("Das Gerät hat keinen Push-Schlüssel geliefert.");
    const previous = await read();
    // Persist before sending. A lost response must leave enough information to
    // discover/unsubscribe either the old or the new registration on retry.
    const pending = [...new Set([token, ...previous])];
    await storage.setItem(key, JSON.stringify(pending));
    await call("native_push_subscribe", { token, projectId, previousTokens: previous });
    await storage.setItem(key, JSON.stringify([token]));
  }
  async function disable() {
    const known = await read();
    await call("native_push_unsubscribe", { tokens: known });
    await storage.removeItem(key);
  }
  return { supported, status, enable, disable };
}

export function notificationBelongsHere(response, serverId) {
  const data = response?.notification?.request?.content?.data;
  return !!serverId && data?.screen === "channels" && data.serverId === serverId;
}

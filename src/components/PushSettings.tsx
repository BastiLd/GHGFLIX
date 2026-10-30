import { useEffect, useState } from "react";
import { invoke } from "../lib/backend";
import { IS_WEB } from "../lib/platform";
export function PushSettings() {
  const supported = IS_WEB && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!supported) return;
    void navigator.serviceWorker.getRegistration("/").then(r => r?.pushManager.getSubscription()).then(s => setEnabled(!!s)).catch(() => {});
  }, [supported]);
  async function change() {
    setBusy(true); setMessage("");
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        if (sub) { await invoke("push_unsubscribe", { endpoint: sub.endpoint }); await sub.unsubscribe(); }
        setEnabled(false); return;
      }
      // Request permission directly from the button gesture, before network work.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Benachrichtigungen sind nicht erlaubt. Du kannst die Berechtigung in den Browser-Einstellungen ändern.");
      const status = await invoke<{configured: boolean; publicKey: string}>("push_status");
      if (!status.configured) throw new Error("Push ist am Server noch nicht eingerichtet: PUSH_CONTACT fehlt. App-Meldungen bleiben aktiv.");
      await navigator.serviceWorker.register("/push-sw.js");
      const registration = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(status.publicKey.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
      const sub = await registration.pushManager.getSubscription() ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      try { await invoke("push_subscribe", { subscription: sub.toJSON() }); }
      catch (e) { await sub.unsubscribe(); throw e; }
      setEnabled(true);
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-ghg-line p-4 space-y-2">
    <h3 className="font-bold">Benachrichtigungen auf diesem Gerät</h3>
    <p className="text-sm text-ghg-muted">Standard: nur in der App. Optional meldet Geräte-Push neue Beiträge auch bei geschlossener Seite. Die Glocke pro Kanal bestimmt, welche Kanäle melden.</p>
    {supported ? <button disabled={busy} onClick={() => void change()} className="rounded-lg bg-ghg-surface2 px-4 py-2">{busy ? "Bitte warten …" : enabled ? "Geräte-Push ausschalten" : "Geräte-Push einschalten"}</button> :
      <p className="text-sm text-ghg-muted">Geräte-Push ist hier nicht verfügbar. Verwende die HTTPS-Web-App in einem Browser mit Push-Unterstützung; auf iPhone/iPad gegebenenfalls als installierte Web-App. Die native App und viele TV-Browser unterstützen diesen Weg nicht.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

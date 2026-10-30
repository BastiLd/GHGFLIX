import { useEffect, useState } from "react";
import { invoke } from "../lib/backend";
import { IS_WEB } from "../lib/platform";

interface PushStatus { configured: boolean; publicKey: string | null; registered: boolean }
const decodeKey = (key: string) => Uint8Array.from(atob(key.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
function sameKey(sub: PushSubscription, key: string | null) {
  if (!key || !sub.options.applicationServerKey) return false;
  const current = new Uint8Array(sub.options.applicationServerKey);
  const wanted = decodeKey(key);
  return current.length === wanted.length && current.every((v, i) => v === wanted[i]);
}

export function PushSettings() {
  const supported = IS_WEB && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(supported);
  const [message, setMessage] = useState("");
  const [check, setCheck] = useState(0);
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    setBusy(true);
    void (async () => {
      try {
        const r = await navigator.serviceWorker.getRegistration("/");
        const sub = await r?.pushManager.getSubscription();
        const status = await invoke<PushStatus>("push_status", { endpoint: sub?.endpoint ?? null });
        if (disposed) return;
        const active = !!sub && status.configured && status.registered && sameKey(sub, status.publicKey);
        setEnabled(active);
        setMessage(!status.configured ? "Geräte-Push ist am Server noch nicht eingerichtet. App-Meldungen bleiben aktiv." :
          active && Notification.permission !== "granted" ? "Die Anmeldung besteht, aber der Browser blockiert Benachrichtigungen. Bitte die Website-Berechtigung prüfen." :
          sub && !active ? "Die Geräteanmeldung muss erneuert werden. Klicke dafür auf Einschalten." : "");
      } catch (e) {
        if (!disposed) { setEnabled(null); setMessage(`Push-Status konnte nicht geprüft werden: ${String(e)}`); }
      } finally { if (!disposed) setBusy(false); }
    })();
    return () => { disposed = true; };
  }, [supported, check]);

  async function change() {
    if (busy) return;
    if (enabled === null) { setCheck(c => c + 1); return; }
    setBusy(true); setMessage("");
    try {
      if (enabled) {
        const registration = await navigator.serviceWorker.getRegistration("/");
        const sub = await registration?.pushManager.getSubscription();
        if (sub) {
          // Stop server delivery first; a failed browser cleanup must not re-enable it.
          await invoke("push_unsubscribe", { endpoint: sub.endpoint });
          setEnabled(false);
          try {
            if (!await sub.unsubscribe()) setMessage("Push ist am Server ausgeschaltet. Die Browseranmeldung konnte noch nicht entfernt werden.");
          } catch { setMessage("Push ist am Server ausgeschaltet. Die Browseranmeldung konnte noch nicht entfernt werden."); }
        }
        setEnabled(false);
        return;
      }
      // Permission must be requested in the explicit button gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Benachrichtigungen sind nicht erlaubt. Du kannst die Berechtigung in den Browser-Einstellungen ändern.");
      const status = await invoke<PushStatus>("push_status");
      if (!status.configured || !status.publicKey) throw new Error("Geräte-Push ist am Server noch nicht eingerichtet. App-Meldungen bleiben aktiv.");
      await navigator.serviceWorker.register("/push-sw.js");
      const registration = await navigator.serviceWorker.ready;
      let sub = await registration.pushManager.getSubscription();
      if (sub && !sameKey(sub, status.publicKey)) {
        await invoke("push_unsubscribe", { endpoint: sub.endpoint });
        if (!await sub.unsubscribe()) throw new Error("Die alte Browseranmeldung konnte nicht erneuert werden. Bitte noch einmal versuchen.");
        sub = null;
      }
      const created = !sub;
      sub ??= await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:decodeKey(status.publicKey)});
      try { await invoke("push_subscribe", { subscription: sub.toJSON() }); }
      catch (e) { if (created) await sub.unsubscribe().catch(() => false); throw e; }
      setEnabled(true);
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-ghg-line p-4 space-y-2">
    <h3 className="font-bold">Benachrichtigungen auf diesem Gerät</h3>
    <p className="text-sm text-ghg-muted">Standard: nur in der App. Optional meldet Geräte-Push neue Beiträge auch bei geschlossener Seite. Die Glocke pro Kanal bestimmt, welche Kanäle melden.</p>
    {supported ? <button disabled={busy} onClick={() => void change()} className="rounded-lg bg-ghg-surface2 px-4 py-2">{busy ? "Bitte warten …" : enabled === null ? "Status erneut prüfen" : enabled ? "Geräte-Push ausschalten" : "Geräte-Push einschalten"}</button> :
      <p className="text-sm text-ghg-muted">Geräte-Push ist hier nicht verfügbar. Verwende die HTTPS-Web-App in einem Browser mit Push-Unterstützung; auf iPhone/iPad gegebenenfalls als installierte Web-App. Die native App und viele TV-Browser unterstützen diesen Weg nicht.</p>}
    {message && <p role="status" className="text-sm">{message}</p>}
  </section>;
}

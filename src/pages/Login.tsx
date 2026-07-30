import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { useStore } from "../lib/store";
import {
  countLocalProgress, ensureCloudProfile, getSession, isConfigured, signIn, signUp, startSupabaseSync, syncNow,
} from "../lib/supabase";
import { Button, Modal, Spinner, TextInput } from "../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const configured = isConfigured();
  const profileId = useStore((s) => s.profileId);
  const profileName = useStore((s) => s.profileName);

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info" | "success"; text: string } | null>(null);
  // Nachfrage vor dem Erst-Upload des bisherigen Fortschritts
  const [migrate, setMigrate] = useState<number | null>(null);

  /** Nach erfolgreicher Anmeldung: Cloud-Profil verknüpfen und fragen, ob der
   *  bisherige lokale Fortschritt hochgeladen werden soll. */
  const afterLogin = async () => {
    try {
      await ensureCloudProfile(profileId || "local", profileName || "Lokal");
      const n = await countLocalProgress(profileId || "local");
      if (n > 0) {
        setMigrate(n);
        return; // Weiterleitung erfolgt nach der Entscheidung
      }
      startSupabaseSync(profileId || "local", profileName || "Lokal");
    } catch (e) {
      toast("Cloud-Profil konnte nicht verknüpft werden: " + String(e), "error");
    }
    navigate("/profiles");
  };

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") {
        await signIn(email, password);
        toast("Angemeldet", "success");
        await afterLogin();
      } else {
        await signUp(email, password);
        // If confirmation is on, there is no session yet.
        const session = await getSession();
        if (session) {
          toast("Konto erstellt", "success");
          await afterLogin();
        } else {
          setMsg({
            kind: "info",
            text:
              "Konto erstellt. Supabase verlangt evtl. eine E-Mail-Bestätigung – bestätige den Link in deiner Mail und melde dich dann an. (Oder schalte in Supabase unter Authentication → Sign In / Providers → Email die Bestätigung aus.)",
          });
          setMode("in");
        }
      }
    } catch (e: any) {
      setMsg({ kind: "error", text: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-ghg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <Wordmark size="lg" />
        </div>

        {!configured ? (
          <div className="bg-ghg-surface border border-ghg-line rounded-2xl p-6 text-center">
            <p className="text-sm text-ghg-muted mb-4">
              Supabase ist noch nicht konfiguriert. Trage zuerst Project URL und anon-Key in den Einstellungen ein
              (das „i" dort erklärt, wo du beides findest).
            </p>
            <Button onClick={() => navigate("/settings")}>Zu den Einstellungen</Button>
          </div>
        ) : (
          <div className="bg-ghg-surface border border-ghg-line rounded-2xl p-6 space-y-4">
            <div className="flex gap-1 bg-ghg-bg2 rounded-lg p-1">
              {(["in", "up"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMode(m);
                    setMsg(null);
                  }}
                  className={`flex-1 py-1.5 rounded-md text-sm font-semibold transition ${
                    mode === m ? "bg-ghg-red text-white" : "text-ghg-muted hover:text-ghg-text"
                  }`}
                >
                  {m === "in" ? "Anmelden" : "Registrieren"}
                </button>
              ))}
            </div>

            {msg && (
              <div
                className={`text-sm rounded-lg p-3 border ${
                  msg.kind === "error"
                    ? "bg-ghg-red-dark/20 border-ghg-red/40 text-ghg-red"
                    : "bg-ghg-surface2 border-ghg-line text-ghg-text/90"
                }`}
              >
                {msg.text}
              </div>
            )}

            <TextInput value={email} onChange={setEmail} placeholder="E-Mail" type="email" />
            <TextInput value={password} onChange={setPassword} placeholder="Passwort (min. 6 Zeichen)" type="password" onEnter={submit} />
            <Button onClick={submit} disabled={busy} className="w-full">
              {busy ? <Spinner className="w-4 h-4" /> : mode === "in" ? "Anmelden" : "Konto erstellen"}
            </Button>
            <button onClick={() => navigate("/")} className="w-full text-sm text-ghg-muted hover:text-ghg-text">
              Ohne Konto fortfahren (lokal)
            </button>
          </div>
        )}
      </div>

      {/* Erst-Upload: bewusst mit Nachfrage statt heimlich im Hintergrund */}
      <Modal open={migrate != null} onClose={() => setMigrate(null)} title="Bisherigen Fortschritt übernehmen?">
        <div className="space-y-4">
          <p className="text-sm text-ghg-text/90">
            Auf diesem PC sind <span className="font-bold text-ghg-red">{migrate}</span> gespeicherte Einträge
            (gesehene Folgen und Filme, angefangene Titel). Sollen sie in dein Konto hochgeladen werden, damit sie
            auf Handy, Fernseher und anderen PCs auftauchen?
          </p>
          <p className="text-xs text-ghg-muted">
            Es wird nichts gelöscht und nichts überschrieben: Bei Unterschieden gewinnt immer der neuere Stand.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setMigrate(null);
                startSupabaseSync(profileId || "local", profileName || "Lokal");
                navigate("/profiles");
              }}
            >
              Später
            </Button>
            <Button
              onClick={async () => {
                setMigrate(null);
                setBusy(true);
                try {
                  startSupabaseSync(profileId || "local", profileName || "Lokal");
                  const h = await syncNow();
                  if (h.lastError) toast("Abgleich fehlgeschlagen: " + h.lastError, "error");
                  else toast(`${h.lastPushed} Einträge in die Cloud übertragen`, "success");
                } finally {
                  setBusy(false);
                  navigate("/profiles");
                }
              }}
            >
              Ja, hochladen
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

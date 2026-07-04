import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wordmark } from "../components/Brand";
import { useStore } from "../lib/store";
import { getSession, isConfigured, signIn, signUp } from "../lib/supabase";
import { Button, Spinner, TextInput } from "../components/ui";

export default function Login() {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const configured = isConfigured();

  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info" | "success"; text: string } | null>(null);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "in") {
        await signIn(email, password);
        toast("Angemeldet", "success");
        navigate("/profiles");
      } else {
        await signUp(email, password);
        // If confirmation is on, there is no session yet.
        const session = await getSession();
        if (session) {
          toast("Konto erstellt", "success");
          navigate("/profiles");
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
    </div>
  );
}

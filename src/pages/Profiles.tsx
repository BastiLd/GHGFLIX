import { Plus, Trash2, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ZigZag } from "../components/Brand";
import { useStore } from "../lib/store";
import {
  createProfile,
  deleteProfile,
  getSession,
  listProfiles,
  syncProgress,
  type SupaProfile,
} from "../lib/supabase";
import { Button, Modal, Spinner, TextInput } from "../components/ui";

export default function Profiles() {
  const navigate = useNavigate();
  const toast = useStore((s) => s.toast);
  const setProfile = useStore((s) => s.setProfile);

  const [loading, setLoading] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);
  const [profiles, setProfiles] = useState<SupaProfile[]>([]);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const session = await getSession();
      setLoggedIn(!!session);
      if (session) setProfiles(await listProfiles());
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const choose = async (id: string, name: string) => {
    setProfile(id, name);
    if (id !== "local") {
      try {
        await syncProgress(id);
        toast("Fortschritt synchronisiert", "success");
      } catch (e) {
        toast("Sync fehlgeschlagen: " + String(e), "error");
      }
    }
    navigate("/");
  };

  const addProfile = async () => {
    if (!newName.trim()) return;
    try {
      await createProfile(newName.trim());
      setNewName("");
      setAdding(false);
      await load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const removeProfile = async (id: string) => {
    try {
      await deleteProfile(id);
      await load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  return (
    <div className="fixed inset-0 bg-ghg-bg flex flex-col items-center justify-center p-6">
      <h1 className="text-3xl font-black mb-2">Wer schaut?</h1>
      <ZigZag className="h-2.5 w-28 mb-10" />

      {loading ? (
        <Spinner className="w-8 h-8" />
      ) : (
        <div className="flex flex-wrap gap-6 justify-center max-w-2xl">
          {/* local profile always available */}
          <ProfileTile name="Lokal" onClick={() => choose("local", "Lokal")} />

          {loggedIn &&
            profiles.map((p) => (
              <ProfileTile key={p.id} name={p.name} onClick={() => choose(p.id, p.name)} onDelete={() => removeProfile(p.id)} />
            ))}

          {loggedIn && (
            <button
              onClick={() => setAdding(true)}
              className="flex flex-col items-center gap-3 group"
            >
              <div className="w-28 h-28 rounded-2xl border-2 border-dashed border-ghg-line group-hover:border-ghg-red flex items-center justify-center transition">
                <Plus className="w-10 h-10 text-ghg-muted group-hover:text-ghg-red" />
              </div>
              <span className="text-sm text-ghg-muted">Profil hinzufügen</span>
            </button>
          )}
        </div>
      )}

      <div className="mt-12 flex gap-3">
        {!loggedIn && (
          <Button onClick={() => navigate("/login")}>Anmelden für Sync</Button>
        )}
        <Button variant="ghost" onClick={() => navigate("/")}>
          Zurück
        </Button>
      </div>

      <Modal open={adding} onClose={() => setAdding(false)} title="Neues Profil">
        <div className="space-y-4">
          <TextInput value={newName} onChange={setNewName} placeholder="Name" autoFocus onEnter={addProfile} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAdding(false)}>
              Abbrechen
            </Button>
            <Button onClick={addProfile}>Erstellen</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function ProfileTile({ name, onClick, onDelete }: { name: string; onClick: () => void; onDelete?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 group relative">
      <button
        onClick={onClick}
        className="w-28 h-28 rounded-2xl bg-gradient-to-br from-ghg-red to-ghg-red-dark flex items-center justify-center shadow-lg group-hover:scale-105 group-hover:shadow-ghg-glow transition"
      >
        <User className="w-12 h-12 text-white" />
      </button>
      <span className="text-sm font-medium">{name}</span>
      {onDelete && (
        <button
          onClick={onDelete}
          className="absolute top-1 right-1 p-1 rounded-md bg-black/50 opacity-0 group-hover:opacity-100 hover:bg-ghg-red transition"
          title="Profil löschen"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

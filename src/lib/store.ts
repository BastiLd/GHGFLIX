import { create } from "zustand";
import { useUiPrefs } from "./uiPrefs";

export type ToastKind = "info" | "error" | "success";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface AppStore {
  profileId: string;
  profileName: string;
  setProfile: (id: string, name: string) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;
}

const LS_ID = "ghgflix.profileId";
const LS_NAME = "ghgflix.profileName";

let toastSeq = 1;

export const useStore = create<AppStore>((set, get) => ({
  profileId: localStorage.getItem(LS_ID) || "local",
  profileName: localStorage.getItem(LS_NAME) || "Lokal",

  setProfile: (id, name) => {
    localStorage.setItem(LS_ID, id);
    localStorage.setItem(LS_NAME, name);
    set({ profileId: id, profileName: name });
  },

  toasts: [],
  toast: (message, kind = "info") => {
    const id = toastSeq++;
    // replace an identical toast instead of stacking duplicates
    const rest = get().toasts.filter((t) => t.message !== message);
    set({ toasts: [...rest, { id, kind, message }] });
    // display duration is user-configurable (Einstellungen → Allgemein)
    const secs = useUiPrefs.getState().toastSec || 4;
    setTimeout(() => get().dismiss(id), Math.max(1500, secs * 1000));
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

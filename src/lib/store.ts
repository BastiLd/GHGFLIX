import { create } from "zustand";
import { useUiPrefs } from "./uiPrefs";

export type ToastKind = "info" | "error" | "success";
export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Ein Eintrag im Meldungs-Protokoll. */
export interface LogEintrag {
  id: number;
  kind: ToastKind;
  message: string;
  /** Zeitpunkt in Millisekunden. */
  zeit: number;
  /** Wie oft dieselbe Meldung hintereinander kam. */
  anzahl: number;
}

interface AppStore {
  profileId: string;
  profileName: string;
  setProfile: (id: string, name: string) => void;

  toasts: Toast[];
  toast: (message: string, kind?: ToastKind) => void;
  dismiss: (id: number) => void;

  /* ── Meldungs-Protokoll ────────────────────────────────────────────────
     WARUM ES DAS GIBT: Die kurzen Meldungen unten rechts verschwinden nach
     wenigen Sekunden, lassen sich nicht markieren und schneiden mehrzeilige
     Fehlertexte ab. Wer wissen will, WARUM etwas schiefging — etwa welche
     Adresse ein Blog-Abo abgewiesen hat — hatte keine Chance, das noch
     einmal nachzulesen oder herauszukopieren.
     Deshalb landet JEDE Meldung zusätzlich hier, vollständig, mit Uhrzeit
     und über Seitenwechsel hinweg. */
  protokoll: LogEintrag[];
  protokollLeeren: () => void;
}

const LS_ID = "ghgflix.profileId";
const LS_NAME = "ghgflix.profileName";
const LS_LOG = "ghgflix.protokoll";

/** So viele Meldungen werden aufgehoben. */
const LOG_MAX = 300;

let toastSeq = 1;

function logLaden(): LogEintrag[] {
  try {
    const roh = JSON.parse(localStorage.getItem(LS_LOG) || "[]");
    return Array.isArray(roh) ? roh.slice(-LOG_MAX) : [];
  } catch {
    return [];
  }
}

function logSichern(v: LogEintrag[]) {
  try {
    localStorage.setItem(LS_LOG, JSON.stringify(v.slice(-LOG_MAX)));
  } catch {
    /* Speicher voll — das Protokoll ist es nicht wert, deswegen zu scheitern */
  }
}

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

    /* Ins Protokoll — mit vollem Text. Dieselbe Meldung direkt hintereinander
       wird nur hochgezählt, sonst füllt ein wiederholter Fehler die Liste. */
    const log = get().protokoll;
    const letzte = log[log.length - 1];
    const neu =
      letzte && letzte.message === message && letzte.kind === kind
        ? [...log.slice(0, -1), { ...letzte, anzahl: letzte.anzahl + 1, zeit: Date.now() }]
        : [...log, { id, kind, message, zeit: Date.now(), anzahl: 1 }];
    const gekappt = neu.slice(-LOG_MAX);
    set({ protokoll: gekappt });
    logSichern(gekappt);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  protokoll: logLaden(),
  protokollLeeren: () => {
    set({ protokoll: [] });
    logSichern([]);
  },
}));

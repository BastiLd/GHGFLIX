/* Auffangnetz für Renderfehler.
 *
 * WARUM (gemeldet 19.08.2026): Ohne so etwas reißt EIN einziger Fehler in einer
 * Unterseite die komplette Oberfläche ab — React hängt den ganzen Baum aus, das
 * Fenster ist schwarz, und weil auch die Navigation weg ist, gibt es kein
 * Zurück mehr. Die App wirkt dann kaputt, obwohl nur eine Seite klemmt.
 *
 * Jetzt bleibt die Anwendung bedienbar, der Fehler steht im Klartext da (damit
 * er sich melden lässt) und man kommt mit einem Klick zurück.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Beim Wechsel dieses Werts wird der Fehler vergessen (z.B. bei Seitenwechsel). */
  schluessel?: string;
}
interface State {
  fehler: Error | null;
  stelle: string | null;
}

export class Fehlerfang extends Component<Props, State> {
  state: State = { fehler: null, stelle: null };

  static getDerivedStateFromError(fehler: Error): Partial<State> {
    return { fehler };
  }

  componentDidCatch(fehler: Error, info: ErrorInfo) {
    // In die Konsole, damit es auch nach dem Schließen noch auffindbar ist.
    console.error("[GHGFlix] Renderfehler:", fehler, info.componentStack);
    this.setState({ stelle: info.componentStack ?? null });
  }

  componentDidUpdate(vorher: Props) {
    if (vorher.schluessel !== this.props.schluessel && this.state.fehler) {
      this.setState({ fehler: null, stelle: null });
    }
  }

  render() {
    const { fehler, stelle } = this.state;
    if (!fehler) return this.props.children;

    return (
      <div className="p-10 max-w-3xl">
        <h2 className="text-2xl font-bold text-ghg-red mb-2">Diese Ansicht konnte nicht geladen werden</h2>
        <p className="text-sm text-ghg-muted mb-4">
          Der Rest der App läuft weiter. Bitte schick mir den Text unten, dann lässt sich die Ursache genau
          beheben.
        </p>
        <div className="bg-ghg-bg2 border border-ghg-line rounded-lg p-4 mb-4">
          <p className="font-mono text-sm text-ghg-text break-all">{fehler.message || String(fehler)}</p>
          {stelle && (
            <pre className="mt-3 text-[11px] text-ghg-muted/70 whitespace-pre-wrap max-h-48 overflow-y-auto">
              {stelle.trim()}
            </pre>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              this.setState({ fehler: null, stelle: null });
              history.back();
            }}
            className="px-4 py-2 rounded-lg bg-ghg-red text-white font-semibold"
          >
            Zurück
          </button>
          <button
            onClick={() => this.setState({ fehler: null, stelle: null })}
            className="px-4 py-2 rounded-lg bg-ghg-surface2 text-ghg-text"
          >
            Nochmal versuchen
          </button>
        </div>
      </div>
    );
  }
}

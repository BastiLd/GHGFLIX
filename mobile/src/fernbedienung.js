/** Pfeile reagieren beim Drücken und dürfen gehalten werden; OK löst einmal aus. */
export function erzeugeTastenSteuerung({ bewegen, ausloesen, langDruecken, weiter, jetzt = Date.now }) {
  const gehalten = new Map();
  return (e) => {
    const taste = e?.eventType;
    if (!taste || taste === "focus" || taste === "blur") return;
    const runter = e.eventKeyAction === 0;
    const hoch = e.eventKeyAction === 1;
    const alt = gehalten.get(taste);
    if (runter) {
      if (!alt) gehalten.set(taste, { start: jetzt(), letzte: -Infinity });
    }
    const zustand = gehalten.get(taste);
    if (["left", "right", "up", "down"].includes(taste)) {
      if (hoch && alt) { gehalten.delete(taste); return; }
      if (runter && jetzt() - zustand.letzte < 110) return;
      if (zustand) zustand.letzte = jetzt();
      if (!bewegen(taste)) weiter(taste);
    } else if (taste === "select") {
      if (runter) return;
      if (alt && jetzt() - alt.start > 550 && langDruecken()) { gehalten.delete(taste); return; }
      if (!ausloesen()) weiter(taste);
    } else if (!runter) weiter(taste);
    if (hoch) gehalten.delete(taste);
  };
}

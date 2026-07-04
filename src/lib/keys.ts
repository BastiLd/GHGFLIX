type AnyKeyEvent = Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey" | "key">;

const MODS = ["control", "alt", "shift", "meta", ""];

/** Serialize a keyboard event into a normalized combo string, e.g. "k", "ctrl+shift+b". */
export function comboFromEvent(e: AnyKeyEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("ctrl");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey) parts.push("shift");
  if (e.metaKey) parts.push("meta");
  let k = (e.key || "").toLowerCase();
  if (k === " ") k = "space";
  if (!MODS.includes(k)) parts.push(k);
  return parts.join("+");
}

/** True if the combo has an actual (non-modifier-only) key. */
export function comboHasKey(combo: string): boolean {
  const parts = combo.split("+");
  return parts.some((p) => !["ctrl", "alt", "shift", "meta"].includes(p));
}

/** Human-readable label for a combo. */
export function comboLabel(combo: string): string {
  if (!combo) return "—";
  return combo
    .split("+")
    .map((p) =>
      p === "space" ? "Leertaste" : p === "ctrl" ? "Strg" : p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join(" + ");
}

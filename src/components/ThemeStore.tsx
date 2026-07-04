import { useState } from "react";
import { THEMES, currentAccent, currentThemeId, setCustomAccent, setTheme } from "../lib/themes";
import { Modal } from "./ui";

export function ThemeStore({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [sel, setSel] = useState(currentThemeId());
  const [accent, setAccent] = useState(currentAccent() || "#e50914");

  return (
    <Modal open={open} onClose={onClose} title="Theme-Store" wide>
      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {THEMES.map((t) => (
          <button
            key={t.id}
            onClick={() => {
              setTheme(t.id);
              setSel(t.id);
            }}
            className={`rounded-xl p-3 border text-left transition ${
              sel === t.id ? "border-ghg-red ring-2 ring-ghg-red/40" : "border-ghg-line hover:border-ghg-muted"
            }`}
            style={{ background: t.bg || "#101014" }}
          >
            <div className="flex gap-1.5 mb-2">
              <span className="w-7 h-7 rounded-full" style={{ background: t.accent }} />
              <span className="w-7 h-7 rounded-md border border-white/10" style={{ background: t.surface || "#16161c" }} />
            </div>
            <span className="text-xs font-semibold" style={{ color: t.text || "#f5f5f7" }}>
              {t.name}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-3 flex-wrap border-t border-ghg-line pt-4">
        <span className="text-sm text-ghg-muted">Eigene Akzentfarbe:</span>
        <input
          type="color"
          value={accent}
          onChange={(e) => {
            setAccent(e.target.value);
            setCustomAccent(e.target.value);
          }}
          className="w-12 h-9 rounded cursor-pointer bg-transparent border border-ghg-line"
        />
        <span className="text-xs text-ghg-muted">überschreibt die Theme-Farbe (Theme erneut wählen zum Zurücksetzen)</span>
      </div>
    </Modal>
  );
}

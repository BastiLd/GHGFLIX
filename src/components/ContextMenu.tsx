import clsx from "clsx";
import { useEffect } from "react";
import { useContextMenu } from "../lib/contextmenu";

export function ContextMenu() {
  const { open, x, y, items, close } = useContextMenu();

  useEffect(() => {
    if (!open) return;
    const onClose = () => close();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("click", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!open) return null;

  const width = 224;
  const height = items.length * 38 + 8;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, window.innerHeight - height - 8);

  return (
    <div
      className="fixed z-[300] w-56 bg-ghg-elevated border border-ghg-line rounded-lg shadow-2xl overflow-hidden py-1 pop-in"
      style={{ left, top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-1 border-t border-ghg-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              close();
              it.onClick();
            }}
            className={clsx(
              "w-full text-left px-3 py-2 text-sm transition hover:bg-ghg-surface2 disabled:opacity-40 disabled:cursor-not-allowed",
              it.danger ? "text-ghg-red" : "text-ghg-text",
            )}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

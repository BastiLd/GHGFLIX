import clsx from "clsx";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePlayback } from "../lib/playback";
import { useStore } from "../lib/store";

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={clsx(
        "spin-slow rounded-full border-2 border-ghg-line border-t-ghg-red",
        className ?? "w-6 h-6",
      )}
    />
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismiss);
  const miniActive = usePlayback((s) => s.mini != null);
  return (
    // z-[400]: toasts must stay visible ABOVE open modals (z-300) so error
    // feedback from a dialog (e.g. failed TMDb call) is never hidden behind it;
    // shift up while the mini-player occupies the bottom-right corner
    <div className={`fixed right-6 z-[400] flex flex-col gap-2 ${miniActive ? "bottom-72" : "bottom-6"}`}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={clsx(
            "px-4 py-3 rounded-lg shadow-xl cursor-pointer text-sm max-w-sm border toast-in flex items-start gap-2.5",
            t.kind === "error" && "bg-ghg-red-dark/95 border-ghg-red text-white",
            t.kind === "success" && "bg-emerald-700/95 border-emerald-500 text-white",
            t.kind === "info" && "bg-ghg-surface2 border-ghg-line text-ghg-text",
          )}
        >
          {t.kind === "error" && <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />}
          {t.kind === "success" && <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />}
          {t.kind === "info" && <Info className="w-4 h-4 shrink-0 mt-0.5 text-ghg-muted" />}
          <span className="min-w-0">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

// ===== Skeleton loading placeholders (instead of bare spinners) =====

export function SkeletonCard({ wide }: { wide?: boolean }) {
  return (
    <div className={clsx("shrink-0", wide ? "media-card-wide" : "media-card")}>
      <div className={clsx("skeleton rounded-xl", wide ? "aspect-video" : "aspect-[2/3]")} />
      {!wide && (
        <div className="mt-2 space-y-1.5">
          <div className="skeleton h-3.5 rounded w-3/4" />
          <div className="skeleton h-3 rounded w-1/2" />
        </div>
      )}
    </div>
  );
}

export function SkeletonRow({ count = 7, title = true }: { count?: number; title?: boolean }) {
  return (
    <section className="mb-8">
      {title && <div className="skeleton h-6 w-44 rounded mb-3 mx-8" />}
      <div className="flex gap-4 overflow-hidden px-8 pb-2">
        {Array.from({ length: count }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </section>
  );
}

export function SkeletonGrid({ count = 14 }: { count?: number }) {
  return (
    <div className="flex flex-wrap gap-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonDetail() {
  return (
    <div className="relative pb-12">
      <div className="skeleton h-[42vh] min-h-[300px] w-full" />
      <div className="px-10 -mt-32 relative flex gap-8">
        <div className="skeleton w-52 shrink-0 aspect-[2/3] rounded-xl" />
        <div className="flex-1 pt-36 space-y-3">
          <div className="skeleton h-9 w-2/3 rounded" />
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton h-4 w-3/4 rounded" />
          <div className="skeleton h-4 w-2/3 rounded" />
        </div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  // Render into document.body via a portal. This is essential: the page content
  // is wrapped in a `.fade-in` element whose finished animation leaves a
  // `transform` on it, which makes it a containing block for position:fixed
  // descendants. Without the portal, this modal would anchor to the SCROLLED
  // page wrapper instead of the viewport and appear off-centre / at the bottom
  // (and dialogs like "Bild ändern" would seem broken when the page is scrolled).
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className={clsx(
          "bg-ghg-surface border border-ghg-line rounded-2xl shadow-2xl w-full max-h-[85vh] overflow-hidden flex flex-col pop-in",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-ghg-line shrink-0">
          <h2 className="text-lg font-bold">{title}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function Button({
  children,
  onClick,
  variant = "primary",
  className,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "primary" | "ghost" | "subtle" | "danger";
  className?: string;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        "px-4 py-2 rounded-lg font-semibold text-sm transition disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2",
        variant === "primary" && "bg-ghg-red hover:bg-ghg-red-bright text-white shadow-lg",
        variant === "ghost" && "bg-ghg-surface2 hover:bg-ghg-elevated text-ghg-text",
        variant === "subtle" && "bg-transparent hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-text",
        variant === "danger" && "bg-transparent hover:bg-ghg-red-dark/30 text-ghg-red border border-ghg-red/40",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function InfoButton({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="p-1 rounded-full hover:bg-ghg-surface2 text-ghg-muted hover:text-ghg-red transition"
        title="Info"
      >
        <Info className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-7 z-50 w-96 max-w-[90vw] bg-ghg-elevated border border-ghg-line rounded-xl shadow-2xl p-4 text-sm text-ghg-text/90 leading-relaxed fade-in space-y-2">
          {children}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-24 text-ghg-muted">
      {icon && <div className="mb-4 opacity-60">{icon}</div>}
      <p className="text-lg font-semibold text-ghg-text">{title}</p>
      {hint && <p className="mt-1 text-sm max-w-md">{hint}</p>}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = "text",
  className,
  autoFocus,
  onEnter,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
  autoFocus?: boolean;
  onEnter?: () => void;
}) {
  return (
    <input
      type={type}
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
      className={clsx(
        "w-full bg-ghg-bg2 border border-ghg-line rounded-lg px-3 py-2 text-sm text-ghg-text",
        "placeholder:text-ghg-muted/60 focus:outline-none focus:border-ghg-red transition",
        className,
      )}
    />
  );
}

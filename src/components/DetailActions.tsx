import type { ReactNode } from "react";
import { useMobileLayout } from "../lib/useMobileLayout";

// Auf Touch-Geraeten darf die Medienverwaltung die Folgen nicht verdraengen.
export function DetailActions({ children, label = "Weitere Aktionen" }: { children: ReactNode; label?: string }) {
  const mobile = useMobileLayout();
  return mobile ? <details className="mobile-detail-actions"><summary>{label}</summary><div>{children}</div></details> : <>{children}</>;
}

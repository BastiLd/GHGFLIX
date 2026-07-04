import type { MouseEvent as ReactMouseEvent } from "react";
import { create } from "zustand";

export interface CtxItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

interface CtxState {
  open: boolean;
  x: number;
  y: number;
  items: CtxItem[];
  show: (x: number, y: number, items: CtxItem[]) => void;
  close: () => void;
}

export const useContextMenu = create<CtxState>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}));

/** Open the custom context menu from a React mouse event. */
export function openCtx(e: ReactMouseEvent, items: CtxItem[]) {
  e.preventDefault();
  e.stopPropagation();
  useContextMenu.getState().show(e.clientX, e.clientY, items);
}

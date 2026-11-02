import { useEffect } from "react";
/** Keep keyboard work inside the open player sheet and restore its trigger. */
export function useDialogFocus(open: boolean, label: string) {
  useEffect(() => {
    if(!open)return;
    const previous = document.activeElement as HTMLElement|null;
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).find(el => el.getAttribute("aria-label")===label);
    if(!dialog)return;
    const items = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex="0"]')).filter(el => el.getClientRects().length>0);
    items()[0]?.focus();
    const key = (e: KeyboardEvent) => {
      if(e.key!=="Tab")return;
      const list=items(), first=list[0], last=list[list.length-1]; if(!first)return;
      if(e.shiftKey && (document.activeElement===first || !dialog.contains(document.activeElement))) { e.preventDefault();last.focus(); }
      else if(!e.shiftKey && (document.activeElement===last || !dialog.contains(document.activeElement))) { e.preventDefault();first.focus(); }
    };
    window.addEventListener("keydown",key,true);
    return () => { window.removeEventListener("keydown",key,true); if(previous?.isConnected)previous.focus(); };
  },[open,label]);
}

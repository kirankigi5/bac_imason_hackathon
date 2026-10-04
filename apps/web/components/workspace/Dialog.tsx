"use client";

import { useEffect, useRef, type RefObject } from "react";
import { X } from "lucide-react";

export function Dialog({ title, onClose, wide = false, drawer = false, children, returnFocusRef }: {
  title: string; onClose: () => void; wide?: boolean; drawer?: boolean; children: React.ReactNode; returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const element = ref.current!, previous = document.activeElement as HTMLElement | null;
    if (element.showModal) element.showModal(); else element.setAttribute("open", "");
    return () => { if (element.close) element.close(); (returnFocusRef?.current ?? previous)?.focus({ preventScroll: true }); };
  }, []);
  return <dialog ref={ref} aria-label={title} className={`workspace-dialog ${wide ? "dialog-wide" : ""} ${drawer ? "dialog-drawer" : ""}`}
    onKeyDown={(event) => {
      if (event.key !== "Tab" || (event.target as HTMLElement).closest("dialog") !== event.currentTarget) return;
      const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
        .filter((element) => element.getClientRects().length > 0 && element.closest("dialog") === event.currentTarget);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !focusable.includes(document.activeElement as HTMLElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    onCancel={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); closeRef.current(); }} onClick={(event) => {
      if (event.target === event.currentTarget) {
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeRef.current();
      }
    }}>
    <header className="dialog-heading"><h2>{title}</h2><button type="button" className="icon-button" aria-label={`Close ${title}`} title="Close" onClick={onClose}><X size={18} /></button></header>
    <div className="dialog-content">{children}</div>
  </dialog>;
}

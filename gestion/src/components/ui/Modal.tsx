"use client";

import { useEffect, useId, useRef } from "react";

interface ModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: React.ReactNode;
}

/** Native <dialog>: focus trap, Esc to close and inert background come from the browser. */
export function Modal({ open, onClose, title, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="modal" aria-labelledby={titleId} onClose={onClose}>
      {open ? (
        <div className="modal__card">
          <header className="modal__head">
            <h2 id={titleId}>{title}</h2>
            <button type="button" className="btn btn--small btn--quiet" onClick={onClose}>
              Cerrar
            </button>
          </header>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}

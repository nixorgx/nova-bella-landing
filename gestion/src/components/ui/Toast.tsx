"use client";

import { useEffect, useState } from "react";

const VISIBLE_MS = 8000;

/**
 * Success toast: a polite live region that is always in the page (so screen readers announce what
 * appears in it), a message that fades out on its own and can be closed. `signal` changes on every
 * submit, so the same text shown twice in a row still appears again.
 */
export function Toast({ message, signal }: { message?: string; signal: unknown }) {
  const [dismissed, setDismissed] = useState<unknown>(null);
  const visible = Boolean(message) && dismissed !== signal;

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setDismissed(signal), VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message, signal]);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {visible ? (
        <div className="toast">
          <svg className="toast__icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="10" cy="10" r="8" />
            <path d="m6.5 10.2 2.4 2.4 4.6-5" />
          </svg>
          <p>{message}</p>
          <button type="button" className="toast__close" onClick={() => setDismissed(signal)} aria-label="Cerrar aviso">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

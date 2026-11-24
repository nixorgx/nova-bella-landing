"use client";

import { useCallback, useId, useRef, useState } from "react";
import {
  classifyScan,
  INITIAL_SCAN_STATE,
  normalizeScannedCode,
  recordKey,
  type ScanSource,
  type ScanState,
} from "@/lib/scan";
import { CameraScanner } from "./CameraScanner";

interface ScanInputProps {
  readonly label: string;
  readonly onScan: (code: string, source: ScanSource | "camera") => void;
  readonly name?: string;
  readonly defaultValue?: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly camera?: boolean;
  /** Clear the box after each scan (lookup mode). Keep it for form fields. */
  readonly clearOnScan?: boolean;
  readonly error?: string;
  readonly compact?: boolean;
}

/**
 * Text input that works with USB barcode readers (they "type" the code and press
 * Enter) and, optionally, with the phone camera. Enter never submits a parent form.
 */
export function ScanInput({
  label,
  onScan,
  name,
  defaultValue,
  placeholder = "Escanee o escriba el código",
  autoFocus = false,
  camera = true,
  clearOnScan = true,
  error,
  compact = false,
}: ScanInputProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const tracker = useRef<ScanState>(INITIAL_SCAN_STATE);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [source, setSource] = useState<string | null>(null);

  const emit = useCallback(
    (raw: string, kind: ScanSource | "camera") => {
      const code = normalizeScannedCode(raw);
      if (!code) return;
      setSource(kind === "scanner" ? "Lector" : kind === "camera" ? "Cámara" : "Teclado");
      if (inputRef.current) inputRef.current.value = clearOnScan ? "" : code;
      onScan(code, kind);
    },
    [clearOnScan, onScan],
  );

  const handleDetected = useCallback(
    (code: string) => {
      setCameraOpen(false);
      emit(code, "camera");
    },
    [emit],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      const kind = classifyScan(tracker.current);
      tracker.current = INITIAL_SCAN_STATE;
      emit(event.currentTarget.value, kind);
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      tracker.current = recordKey(tracker.current, performance.now());
    }
  }

  return (
    <div className={`scan ${compact ? "scan--compact" : ""}`}>
      <label className={compact ? "sr-only" : "field__label"} htmlFor={id}>
        {label}
      </label>
      <div className="scan__row">
        <input
          ref={inputRef}
          id={id}
          name={name}
          defaultValue={defaultValue}
          className="field__control scan__input"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onKeyDown={onKeyDown}
        />
        {camera ? (
          <button type="button" className="btn scan__camera" onClick={() => setCameraOpen(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="scan__camera-label">Cámara</span>
          </button>
        ) : null}
      </div>
      {error ? (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
      <p className="scan__source" role="status" aria-live="polite">
        {source ? `Leído con: ${source}` : ""}
      </p>
      {camera ? <CameraScanner open={cameraOpen} onClose={() => setCameraOpen(false)} onDetected={handleDetected} /> : null}
    </div>
  );
}

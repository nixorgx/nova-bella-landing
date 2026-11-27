"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CameraScanner } from "@/components/scan/CameraScanner";
import type { VariantHit } from "@/features/catalog/types";
import { formatBs } from "@/lib/money";
import {
  classifyScan,
  INITIAL_SCAN_STATE,
  normalizeScannedCode,
  recordKey,
  type ScanState,
} from "@/lib/scan";
import { STOCK_LABEL, stockState } from "@/lib/stock-state";

interface VariantSearchProps {
  readonly onSelect: (hit: VariantHit) => void;
  readonly label?: string;
  readonly placeholder?: string;
  readonly autoFocus?: boolean;
  readonly limit?: number;
  /** Superadmin catalog screens: also list inactive variants. */
  readonly includeInactive?: boolean;
  /** Adds the camera button and resolves scanner input (barcode/SKU) directly. */
  readonly scanner?: boolean;
  readonly clearOnSelect?: boolean;
  /** Superadmin screens that work on one branch (POS, purchases): stock is counted there. */
  readonly branchId?: string;
}

type Status = "idle" | "loading" | "ready" | "error";

const DEBOUNCE_MS = 180;
const MIN_CHARS = 1;

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(String(response.status));
  return (await response.json()) as T;
}

/**
 * Search-as-you-type combobox over every variant (SKU, barcode, model, color, size).
 * Keyboard: arrows move, Enter picks, Esc closes. Reusable by Purchases and POS.
 */
export function VariantSearch({
  onSelect,
  label = "Buscar variante",
  placeholder = "SKU, código, modelo, color o talla…",
  autoFocus = false,
  limit = 12,
  includeInactive = false,
  scanner = false,
  clearOnSelect = true,
  branchId,
}: VariantSearchProps) {
  const uid = useId();
  const listId = `${uid}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const tracker = useRef<ScanState>(INITIAL_SCAN_STATE);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<readonly VariantHit[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const text = query.trim();
    if (text.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("loading");
      try {
        const params = new URLSearchParams({ q: text, limite: String(limit) });
        if (includeInactive) params.set("inactivos", "1");
        if (branchId) params.set("sucursal", branchId);
        const data = await fetchJson<{ hits: VariantHit[] }>(`/api/variantes/buscar?${params}`, controller.signal);
        setHits(data.hits);
        setActive(data.hits.length ? 0 : -1);
        setStatus("ready");
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        setStatus("error");
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, limit, includeInactive, branchId, retry]);

  const choose = useCallback(
    (hit: VariantHit) => {
      setOpen(false);
      setNotice("");
      if (clearOnSelect) setQuery("");
      onSelect(hit);
      inputRef.current?.focus();
    },
    [clearOnSelect, onSelect],
  );

  const resolveCode = useCallback(
    async (raw: string) => {
      const code = normalizeScannedCode(raw);
      if (!code) return;
      try {
        const data = await fetchJson<{ hit: VariantHit | null }>(
          `/api/variantes/resolver?code=${encodeURIComponent(code)}${branchId ? `&sucursal=${branchId}` : ""}`,
        );
        if (data.hit) choose(data.hit);
        else setNotice(`No hay ninguna variante con el código ${code}.`);
      } catch {
        setNotice("No se pudo leer el código. Intente nuevamente.");
      }
    },
    [choose, branchId],
  );

  const hasQuery = query.trim().length >= MIN_CHARS;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!hasQuery || !hits.length) return;
      setOpen(true);
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current) => (current + step + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const kind = classifyScan(tracker.current);
      tracker.current = INITIAL_SCAN_STATE;
      if (scanner && kind === "scanner") void resolveCode(event.currentTarget.value);
      else if (hasQuery && open && hits[active]) choose(hits[active]);
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      } else if (query) {
        setQuery("");
      }
    } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      tracker.current = recordKey(tracker.current, performance.now());
    }
  }

  const listVisible = open && hasQuery;
  const activeId = active >= 0 && hits[active] ? `${uid}-opt-${active}` : undefined;

  return (
    <div className="vsearch">
      <label className="field__label" htmlFor={`${uid}-input`}>
        {label}
      </label>
      <div className="scan__row">
        <input
          ref={inputRef}
          id={`${uid}-input`}
          className="field__control vsearch__input"
          type="search"
          role="combobox"
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setNotice("");
          }}
          onFocus={() => {
            // A pending close from an earlier blur must not shut the list the user just reopened.
            if (blurTimer.current) clearTimeout(blurTimer.current);
            setOpen(true);
          }}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 120);
          }}
          onKeyDown={onKeyDown}
        />
        {scanner ? (
          <button type="button" className="btn scan__camera" onClick={() => setCameraOpen(true)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            <span className="scan__camera-label">Escanear</span>
          </button>
        ) : null}
      </div>
      {notice ? (
        <p className="field__error" role="alert">
          {notice}
        </p>
      ) : null}
      <ul id={listId} role="listbox" aria-label="Resultados" className="vsearch__list" hidden={!listVisible}>
        {hasQuery && status === "loading" && !hits.length ? <li className="vsearch__note" role="presentation">Buscando…</li> : null}
        {hasQuery && status === "error" ? (
          <li className="vsearch__note vsearch__note--error" role="presentation">
            No se pudo buscar.{" "}
            <button type="button" className="link-button" onMouseDown={(e) => e.preventDefault()} onClick={() => setRetry((n) => n + 1)}>
              Reintentar
            </button>
          </li>
        ) : null}
        {hasQuery && status === "ready" && !hits.length ? (
          <li className="vsearch__note" role="presentation">
            Sin resultados para “{query.trim()}”.
          </li>
        ) : null}
        {(hasQuery ? hits : []).map((hit, index) => (
          <HitOption
            key={hit.variantId}
            id={`${uid}-opt-${index}`}
            hit={hit}
            selected={index === active}
            onHover={() => setActive(index)}
            onPick={() => choose(hit)}
          />
        ))}
      </ul>
      <p className="sr-only" role="status" aria-live="polite">
        {status === "ready" ? `${hits.length} resultados` : ""}
      </p>
      {scanner ? (
        <CameraScanner
          open={cameraOpen}
          onClose={() => setCameraOpen(false)}
          onDetected={(code) => {
            setCameraOpen(false);
            void resolveCode(code);
          }}
        />
      ) : null}
    </div>
  );
}

function HitOption({
  id,
  hit,
  selected,
  onHover,
  onPick,
}: {
  id: string;
  hit: VariantHit;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  const state = stockState(hit.stock);
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      className={`vsearch__option ${selected ? "is-active" : ""} ${hit.active && hit.modelActive ? "" : "is-off"}`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={onHover}
      onClick={onPick}
    >
      <span className="swatch" style={{ background: hit.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />
      <span className="vsearch__main">
        <strong className="clip">{hit.model}</strong>
        <span className="clip">
          {hit.color} · Talla {hit.size}
          {hit.active && hit.modelActive ? "" : " · inactiva"}
        </span>
        <code className="clip">{hit.sku}</code>
      </span>
      <span className="vsearch__side">
        <span className="num">{formatBs(hit.price)}</span>
        <span className={`badge badge--${state}`}>
          {hit.stock} · {STOCK_LABEL[state]}
        </span>
      </span>
    </li>
  );
}

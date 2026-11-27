"use client";

import { useState } from "react";
import type { VariantHit } from "@/features/catalog/types";
import { parseBulkText } from "../bulk-paste";

interface Props {
  readonly onResolved: (rows: readonly { hit: VariantHit; qtyInput: string; costInput: string }[]) => void;
}

async function resolveCode(code: string): Promise<VariantHit | null> {
  const response = await fetch(`/api/variantes/resolver?code=${encodeURIComponent(code)}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(String(response.status));
  return ((await response.json()) as { hit: VariantHit | null }).hit;
}

/** Optional helper: paste a spreadsheet column of "SKU ; cantidad ; costo USD". */
export function BulkPaste({ onResolved }: Props) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<{ ok: number; missing: string[] } | null>(null);

  async function run() {
    const parsed = parseBulkText(text);
    setBusy(true);
    const found: { hit: VariantHit; qtyInput: string; costInput: string }[] = [];
    const missing = [...parsed.invalid];
    try {
      for (const line of parsed.lines) {
        const hit = await resolveCode(line.code);
        if (hit) found.push({ hit, qtyInput: line.qtyInput, costInput: line.costInput });
        else missing.push(line.code);
      }
    } catch {
      missing.push("(se interrumpió la lectura; intente de nuevo)");
    } finally {
      setBusy(false);
    }
    onResolved(found);
    setReport({ ok: found.length, missing });
    if (missing.length === 0) setText("");
  }

  return (
    <details className="bulk">
      <summary className="link-button">Pegar varias líneas desde una planilla</summary>
      <div className="stack">
        <div className="field">
          <label className="field__label" htmlFor="bulk-text">SKU ; cantidad ; costo USD (una por línea)</label>
          <textarea
            id="bulk-text"
            className="field__control field__control--area"
            value={text}
            spellCheck={false}
            placeholder={"ALB-NEG-38;4;14,50\nALB-BEI-39;6;14,50"}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="form-actions">
          <button type="button" className="btn btn--small" disabled={busy || text.trim() === ""} onClick={() => void run()}>
            {busy ? "Leyendo…" : "Agregar líneas"}
          </button>
          {report ? (
            <span role="status" className="rate-hint">
              {report.ok} agregadas{report.missing.length ? ` · sin reconocer: ${report.missing.join(", ")}` : ""}
            </span>
          ) : null}
        </div>
      </div>
    </details>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { PaymentMethod } from "@/features/sales/payments";
import { confirmExchangeAction, previewExchangeAction } from "../actions";
import type { ExchangePreview } from "../preview";
import type { ReturnableLine } from "../queries";
import type { ExchangeReason } from "../reasons";
import { buildPayload, EMPTY_DRAFT, isReady, type Draft } from "./exchange-state";
import { ExchangeLines } from "./ExchangeLines";
import { ExchangeSummary } from "./ExchangeSummary";

interface Props {
  readonly saleId: string;
  readonly branchId: string;
  readonly lines: readonly ReturnableLine[];
  readonly isAdmin: boolean;
  readonly cashOpen: boolean;
}

const PREVIEW_DELAY_MS = 150;

/** "Cambio de talla/modelo": pick pairs, scan the replacement, see the server's difference, settle it. */
export function ExchangePanel({ saleId, branchId, lines, isAdmin, cashOpen }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preview, setPreview] = useState<ExchangePreview | null>(null);
  const [method, setMethod] = useState<PaymentMethod | "">("");
  const [reason, setReason] = useState<ExchangeReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);

  const ready = isReady(draft);
  const payload = useMemo(() => buildPayload(saleId, draft), [saleId, draft]);
  const previews = useMemo(() => new Map((preview?.lines ?? []).map((line) => [line.returnedVariantId, line])), [preview]);

  useEffect(() => {
    if (!ready) return;
    const ticket = ++request.current;
    const timer = setTimeout(() => {
      startTransition(async () => {
        const result = await previewExchangeAction(payload);
        if (ticket !== request.current) return;
        if (result.ok) {
          setPreview(result.preview);
          setError("");
        } else {
          setPreview(null);
          setError(result.message);
        }
      });
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [ready, payload]);

  const reset = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setPreview(null);
    setMethod("");
    setReason("");
    setNote("");
    setError("");
  }, []);

  const shownPreview = ready ? preview : null;
  const blocked = !shownPreview?.canConfirm || !reason || (shownPreview.needsMethod && (!method || !cashOpen));

  function confirm() {
    setError("");
    startTransition(async () => {
      const result = await confirmExchangeAction({ ...payload, reason, note: note.trim() || undefined, paymentMethod: method || null });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setDone(result.groupId);
      reset();
      router.refresh();
    });
  }

  if (lines.every((line) => line.remaining === 0) && !done) {
    return <p className="notice">Todos los productos de esta venta ya se cambiaron. Vea el detalle de los cambios más abajo.</p>;
  }

  return (
    <section className="panel exchange" aria-labelledby="exchange-title">
      <div className="panel__head">
        <h2 id="exchange-title">Cambio de talla o modelo</h2>
        <button type="button" className="btn btn--small" aria-expanded={open} aria-controls="exchange-body" onClick={() => setOpen((value) => !value)}>
          {open ? "Cerrar" : "Registrar un cambio"}
        </button>
      </div>
      {done ? (
        <div className="panel__body stack">
          <p className="notice notice--ok" role="status">Cambio registrado: el stock ya se movió y la diferencia quedó en la caja.</p>
          <div className="head-actions">
            <a className="btn btn--primary" href={`/ventas/${saleId}/ticket?cambio=${done}&nueva=1`}>Ver / imprimir el ticket del cambio</a>
            <button type="button" className="btn btn--quiet" onClick={() => setDone(null)}>Hacer otro cambio</button>
          </div>
        </div>
      ) : null}
      <div id="exchange-body" className="panel__body stack" hidden={!open || Boolean(done)}>
        <p className="field__hint">Marque lo que devuelve el cliente, escanee o busque lo que se lleva y confirme. El stock se mueve solo al confirmar.</p>
        <ExchangeLines lines={lines} draft={draft} onChange={setDraft} branchId={branchId} isAdmin={isAdmin} preview={previews} />
        {ready || preview ? (
          <ExchangeSummary
            preview={shownPreview}
            pending={pending}
            draft={draft}
            onDraft={setDraft}
            lines={lines}
            isAdmin={isAdmin}
            cashOpen={cashOpen}
            method={method}
            onMethod={setMethod}
            reason={reason}
            onReason={setReason}
            note={note}
            onNote={setNote}
          />
        ) : null}
        {error ? <p className="notice notice--error" role="alert">{error}</p> : null}
        <div className="head-actions">
          <button type="button" className="btn btn--primary btn--big" disabled={pending || blocked || !ready} onClick={confirm}>
            {pending ? "Procesando…" : "Confirmar el cambio"}
          </button>
          <button type="button" className="btn btn--quiet" onClick={reset}>Limpiar</button>
        </div>
      </div>
    </section>
  );
}

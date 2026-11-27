"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { VariantSearch } from "@/components/search/VariantSearch";
import type { VariantHit } from "@/features/catalog/types";
import type { CustomerOption } from "@/features/customers/queries";
import { formatBs } from "@/lib/money";
import { confirmSaleAction } from "../actions";
import {
  addVariant,
  cartTotals,
  lineIssue,
  linePrice,
  removeLine,
  setLinePrice,
  setLineQty,
  type CartLine,
} from "../cart";
import {
  addPaymentRow,
  effectivePayments,
  fillRemaining,
  newPaymentRow,
  PAYMENT_METHODS,
  reconcile,
  removePaymentRow,
  setPaymentAmount,
  setPaymentMethod,
  toSalePayments,
  type PaymentMethod,
  type PaymentRow,
} from "../payments";
import { CustomerPicker } from "./CustomerPicker";
import { PaymentSection } from "./PaymentSection";
import { PosCartList } from "./PosCartList";

interface Props {
  readonly branchId: string;
  readonly branchName: string;
  /** Percent; null = no limit. Sellers only: the superadmin sells without a floor. */
  readonly maxDiscountPct: string | null;
  readonly isAdmin: boolean;
}

type DocType = "nota_venta" | "factura";
const NOTICE_MS = 5000;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable));
}

export function PosScreen({ branchId, branchName, maxDiscountPct, isAdmin }: Props) {
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLDivElement>(null);
  const rowCounter = useRef(1);
  const [lines, setLines] = useState<readonly CartLine[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [docType, setDocType] = useState<DocType>("nota_venta");
  const [rows, setRows] = useState<readonly PaymentRow[]>([newPaymentRow("p0", "efectivo")]);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const totals = useMemo(() => cartTotals(lines), [lines]);
  const payments = useMemo(() => effectivePayments(rows, totals.total), [rows, totals.total]);
  const reconciliation = useMemo(() => reconcile(payments, totals.total), [payments, totals.total]);
  const issues = useMemo(() => lines.map((line) => lineIssue(line, maxDiscountPct)).filter(Boolean), [lines, maxDiscountPct]);

  const blocker = useMemo(() => {
    if (lines.length === 0) return "Escanee o busque un producto para empezar.";
    if (issues.length > 0) return "Corrija las líneas marcadas en rojo.";
    if (reconciliation.status === "short") return `Falta cobrar ${formatBs(reconciliation.remaining)}.`;
    if (reconciliation.status === "over") return `Los pagos superan el total por ${formatBs(reconciliation.remaining.replace("-", ""))}.`;
    return null;
  }, [lines.length, issues.length, reconciliation]);
  const canConfirm = blocker === null && totals.valid && !pending;

  const focusSearch = useCallback(() => searchRef.current?.querySelector<HTMLInputElement>("input")?.focus(), []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  const onPick = useCallback(
    (hit: VariantHit) => {
      const result = addVariant(lines, hit);
      setError(null);
      setNotice(result.notice ?? null);
      setLines(result.lines);
    },
    [lines],
  );

  const confirm = useCallback(() => {
    if (!canConfirm) return;
    setError(null);
    startTransition(async () => {
      const result = await confirmSaleAction({
        branchId: isAdmin ? branchId : null,
        customerId: customer?.id ?? null,
        docType,
        items: lines.map((line) => ({ variantId: line.variantId, qty: line.qty, finalPrice: linePrice(line) ?? "0" })),
        payments: toSalePayments(payments),
      });
      // Full page load on purpose: the ticket carries its own @page size, which browsers only honour on a fresh document.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- hard navigation is intentional
      if (result.ok) window.location.href = `/ventas/${result.saleId}/ticket?nueva=1`;
      else setError(result.message);
    });
  }, [canConfirm, isAdmin, branchId, customer, docType, lines, payments]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "F2" || (event.key === "/" && !isTyping(event.target))) {
        event.preventDefault();
        focusSearch();
      } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        confirm();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirm, focusSearch]);

  function addRow() {
    const used = new Set(rows.map((row) => row.method));
    const next: PaymentMethod = PAYMENT_METHODS.find((m) => !used.has(m)) ?? "efectivo";
    setRows((current) => addPaymentRow(current, `p${rowCounter.current++}`, next));
  }

  function clearCart() {
    setLines([]);
    setRows([newPaymentRow(`p${rowCounter.current++}`, "efectivo")]);
    setCustomer(null);
    setError(null);
    setClearing(false);
    focusSearch();
  }

  const confirmBlock = (
    <div className="pos-confirm">
      <button type="button" className="btn btn--primary btn--big" disabled={!canConfirm} onClick={confirm}>
        {pending ? "Registrando venta…" : `Confirmar venta · ${formatBs(totals.total)}`}
      </button>
      <p className="pos-confirm__why" aria-live="polite">{pending ? "" : (blocker ?? "Todo listo. Ctrl + Enter para confirmar.")}</p>
    </div>
  );

  return (
    <div className="pos">
      <div className="pos__main">
        <section className="panel pos-scan" aria-label="Agregar productos">
          <div className="panel__body">
            <div ref={searchRef}>
              <VariantSearch
                scanner
                autoFocus
                branchId={isAdmin ? branchId : undefined}
                limit={8}
                label="Escanear o buscar producto"
                placeholder="Escanee el código o escriba modelo, color, talla…"
                onSelect={onPick}
              />
            </div>
            <p className="pos__hints">
              <span><span className="kbd">F2</span> o <span className="kbd">/</span> buscar</span>
              <span><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span> confirmar</span>
              <span>Sucursal: {branchName}</span>
            </p>
            {notice ? <p className="pos-notice" role="status">{notice}</p> : null}
          </div>
        </section>

        <section className="panel pos-cart" aria-labelledby="cart-title">
          <div className="panel__head">
            <h2 id="cart-title">Venta actual</h2>
            <span className="head-actions">
              <span className="eyebrow">{totals.units} {totals.units === 1 ? "par" : "pares"} · {lines.length} {lines.length === 1 ? "línea" : "líneas"}</span>
              {lines.length > 0 ? (
                clearing ? (
                  <>
                    <button type="button" className="btn btn--small btn--danger" onClick={clearCart}>Sí, vaciar</button>
                    <button type="button" className="btn btn--small btn--quiet" onClick={() => setClearing(false)}>No</button>
                  </>
                ) : (
                  <button type="button" className="btn btn--small btn--quiet" onClick={() => setClearing(true)}>Vaciar</button>
                )
              ) : null}
            </span>
          </div>
          {lines.length === 0 ? (
            <div className="pos-cart__empty">
              <strong>La venta está vacía</strong>
              <p>Escanee la etiqueta del producto con el lector o la cámara, o escriba para buscar.</p>
            </div>
          ) : (
            <PosCartList
              lines={lines}
              maxDiscountPct={maxDiscountPct}
              onQty={(id, qty) => setLines((c) => setLineQty(c, id, qty))}
              onPrice={(id, price) => setLines((c) => setLinePrice(c, id, price))}
              onRemove={(id) => {
                setLines((c) => removeLine(c, id));
                focusSearch();
              }}
            />
          )}
        </section>
      </div>

      <aside className="pos__side panel" id="cobro" aria-label="Cobro">
        <div className="pos-block">
          <CustomerPicker customer={customer} onChange={setCustomer} />
        </div>
        <div className="pos-block">
          <fieldset className="seg">
            <legend>Documento</legend>
            {(["nota_venta", "factura"] as const).map((type) => (
              <label key={type}>
                <input type="radio" name="docType" value={type} checked={docType === type} onChange={() => setDocType(type)} />
                {type === "factura" ? "Factura" : "Nota de venta"}
              </label>
            ))}
          </fieldset>
          <p className="field__hint">Solo se registra el tipo de documento; la facturación electrónica llega en otra etapa.</p>
        </div>
        <div className="pos-total" aria-live="polite">
          <dl className="pos-total__rows">
            <div><dt>Subtotal (precio lista)</dt><dd>{formatBs(totals.listTotal)}</dd></div>
            <div><dt>Descuento</dt><dd>{totals.discount === "0.00" ? "—" : `− ${formatBs(totals.discount)}`}</dd></div>
          </dl>
          <span className="pos-total__label">Total a cobrar</span>
          <strong className="pos-total__amount" data-testid="pos-total">{formatBs(totals.total)}</strong>
        </div>
        <div className="pos-block">
          <h3>Pagos</h3>
          <PaymentSection
            rows={rows}
            payments={payments}
            reconciliation={reconciliation}
            total={totals.total}
            onAmount={(id, value) => setRows((c) => setPaymentAmount(c, id, value))}
            onMethod={(id, method) => setRows((c) => setPaymentMethod(c, id, method))}
            onFill={(id) => setRows((c) => fillRemaining(c, id, totals.total))}
            onAdd={addRow}
            onRemove={(id) => setRows((c) => removePaymentRow(c, id))}
          />
        </div>
        <div className="pos-block">
          {error ? <p className="notice notice--error pos-error--desktop" role="alert">{error}</p> : null}
          {confirmBlock}
        </div>
      </aside>

      <div className="pos-bar">
        {error ? <p className="notice notice--error pos-error--mobile" role="alert">{error}</p> : null}
        <div className="pos-bar__total">
          <small>{blocker ?? "Listo para cobrar"}</small>
          <strong>{formatBs(totals.total)}</strong>
        </div>
        <button type="button" className="btn btn--primary btn--big" disabled={!canConfirm} onClick={confirm}>
          {pending ? "Registrando…" : "Confirmar venta"}
        </button>
      </div>
    </div>
  );
}

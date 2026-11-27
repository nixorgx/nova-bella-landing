"use client";

import { formatBs, parseMoney } from "@/lib/money";
import { stockState } from "@/lib/stock-state";
import { discountFloor, lineIssue, linePercentOff, lineTotal, type CartLine } from "../cart";

interface Props {
  readonly lines: readonly CartLine[];
  readonly maxDiscountPct: string | null;
  readonly onQty: (variantId: string, qty: number) => void;
  readonly onPrice: (variantId: string, priceInput: string) => void;
  readonly onRemove: (variantId: string) => void;
}

export function PosCartList({ lines, maxDiscountPct, onQty, onPrice, onRemove }: Props) {
  return (
    <ul className="cart" aria-label="Productos de la venta">
      {lines.map((line) => (
        <CartRow key={line.variantId} line={line} maxDiscountPct={maxDiscountPct} onQty={onQty} onPrice={onPrice} onRemove={onRemove} />
      ))}
    </ul>
  );
}

function CartRow({ line, maxDiscountPct, onQty, onPrice, onRemove }: { line: CartLine } & Omit<Props, "lines">) {
  const issue = lineIssue(line, maxDiscountPct);
  const floor = discountFloor(line.listPrice, maxDiscountPct);
  const off = linePercentOff(line);
  const label = `${line.model} ${line.color} talla ${line.size}`;
  const state = stockState(line.stock);
  const errorId = `issue-${line.variantId}`;
  return (
    <li className={`cart-line ${issue ? "has-issue" : ""}`}>
      <div className="cart-line__name">
        <strong>{line.model}</strong>
        <span className="cart-line__sub">
          <span className="swatch" style={{ background: line.colorHex ?? "var(--ink-faint)" }} aria-hidden="true" />
          {line.color} · Talla {line.size}
          <code className="sku">{line.sku}</code>
          <span className={`badge badge--${state} stock-chip`}>Stock {line.stock}</span>
        </span>
      </div>

      <div className="cart-line__total">
        <strong aria-label={`Total de ${label}`}>{formatBs(lineTotal(line))}</strong>
        {off > 0 ? (
          <span className="cart-line__list">
            {formatBs(line.listPrice)} c/u · −{String(off).replace(".", ",")}%
          </span>
        ) : null}
      </div>

      <div className="cart-line__controls">
        <div className="stepper" role="group" aria-label={`Cantidad de ${label}`}>
          <button type="button" className="btn" aria-label={`Quitar una unidad de ${label}`} disabled={line.qty <= 1} onClick={() => onQty(line.variantId, line.qty - 1)}>
            −
          </button>
          <input
            className="field__control num"
            inputMode="numeric"
            autoComplete="off"
            aria-label={`Cantidad de ${label}`}
            value={line.qty}
            onChange={(event) => onQty(line.variantId, Number.parseInt(event.target.value, 10))}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" className="btn" aria-label={`Agregar una unidad de ${label}`} disabled={line.qty >= line.stock} onClick={() => onQty(line.variantId, line.qty + 1)}>
            +
          </button>
        </div>
        <div className="price-field">
          <label className="field__label" htmlFor={`price-${line.variantId}`}>Precio final</label>
          <input
            id={`price-${line.variantId}`}
            className="field__control num"
            inputMode="decimal"
            autoComplete="off"
            aria-label={`Precio final de ${label}`}
            aria-invalid={issue?.code === "price_invalid" || issue?.code === "below_floor" ? true : undefined}
            aria-describedby={issue ? errorId : undefined}
            value={line.priceInput}
            onChange={(event) => onPrice(line.variantId, event.target.value)}
            onBlur={(event) => {
              const parsed = parseMoney(event.target.value);
              if (parsed !== null && parsed !== event.target.value) onPrice(line.variantId, parsed);
            }}
            onFocus={(event) => event.target.select()}
          />
          {floor ? <span className="price-field__hint">Mínimo {formatBs(floor)}</span> : null}
        </div>
        <button type="button" className="btn btn--small btn--quiet cart-line__remove" onClick={() => onRemove(line.variantId)} aria-label={`Quitar ${label} de la venta`}>
          Quitar
        </button>
      </div>

      {issue ? (
        <p className="field__error cart-line__issue" id={errorId} role="alert">
          {issue.message}
        </p>
      ) : null}
    </li>
  );
}

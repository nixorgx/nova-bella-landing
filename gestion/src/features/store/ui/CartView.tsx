"use client";

import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatBs } from "@/lib/money";
import { useCart } from "../cart/useCart";
import { useCartDetails, type DetailedLine } from "../cart/useCartDetails";
import { ProductPlaceholder, StoreImage } from "./StoreImage";

const PROBLEM_TEXT: Readonly<Record<NonNullable<DetailedLine["problem"]>, string>> = {
  gone: "Este producto ya no está disponible.",
  soldout: "Agotado por ahora.",
  short: "Quedan menos unidades de las que eligió; ajústelas para continuar.",
};

export function CartLineRow({ line, onQty, onRemove }: { line: DetailedLine; onQty?: (qty: number) => void; onRemove?: () => void }) {
  const detail = line.detail;
  return (
    <li className={`cline${line.problem ? " cline--problem" : ""}`}>
      <div className="cline__media">
        {detail?.image ? <StoreImage id={detail.image} alt="" width={96} height={120} sizes="96px" /> : <ProductPlaceholder name={detail?.model ?? "?"} hex={detail?.color_hex} />}
      </div>
      <div className="cline__body">
        <p className="cline__name">{detail ? <Link href={`/tienda/${detail.slug}`}>{detail.model}</Link> : "Producto no disponible"}</p>
        {detail ? (
          <p className="cline__meta">
            <i className="sswatch" style={detail.color_hex ? { background: detail.color_hex } : undefined} aria-hidden="true" /> {detail.color} · Talla {detail.size}
          </p>
        ) : null}
        {line.problem ? <p className="cline__problem" role="alert">{PROBLEM_TEXT[line.problem]}</p> : null}
        <div className="cline__foot">
          {onQty && detail ? (
            <div className="sqty" role="group" aria-label={`Cantidad de ${detail.model}`}>
              <button type="button" className="sqty__btn" aria-label="Menos" onClick={() => onQty(line.qty - 1)}>
                −
              </button>
              <output className="sqty__value num">{line.qty}</output>
              <button type="button" className="sqty__btn" aria-label="Más" disabled={line.qty >= line.maxQty} onClick={() => onQty(line.qty + 1)}>
                +
              </button>
            </div>
          ) : (
            <span className="num">{line.qty} ×</span>
          )}
          <p className="cline__price num">{detail && line.maxQty > 0 ? formatBs(line.lineTotal) : "—"}</p>
        </div>
      </div>
      {onRemove ? (
        <button type="button" className="cline__remove" onClick={onRemove} aria-label={`Quitar ${detail?.model ?? "producto"} del carrito`}>
          Quitar
        </button>
      ) : null}
    </li>
  );
}

export function CartView({ open }: { open: boolean }) {
  const cart = useCart();
  const details = useCartDetails(cart.lines);

  if (cart.lines.length === 0) {
    return (
      <EmptyState title="Su carrito está vacío" action={<Link className="btn btn--primary" href="/tienda">Ver el catálogo</Link>}>
        Elija su talla en un modelo y agréguelo para continuar.
      </EmptyState>
    );
  }
  if (details.status === "loading") return <p className="cart-status" role="status">Actualizando precios y disponibilidad…</p>;
  if (details.status === "error") {
    return <p className="notice notice--error" role="alert">{details.message ?? "No pudimos actualizar su carrito."}</p>;
  }

  const fixShort = () => {
    for (const line of details.lines) {
      if (line.problem === "short") cart.setQty(line.variantId, line.maxQty);
      if (line.problem === "gone" || line.problem === "soldout") cart.remove(line.variantId);
    }
  };

  return (
    <div className="scart">
      <ul className="scart__lines" aria-label="Productos del carrito">
        {details.lines.map((line) => (
          <CartLineRow key={line.variantId} line={line} onQty={(qty) => cart.setQty(line.variantId, qty)} onRemove={() => cart.remove(line.variantId)} />
        ))}
      </ul>
      <aside className="scart__summary" aria-label="Resumen">
        <h2>Resumen</h2>
        <dl className="sum">
          <div>
            <dt>Subtotal</dt>
            <dd className="num">{formatBs(details.subtotal)}</dd>
          </div>
          <div className="sum__note">
            <dt>Envío</dt>
            <dd>Se calcula en el siguiente paso</dd>
          </div>
        </dl>
        {details.hasProblems ? (
          <button type="button" className="btn btn--primary" onClick={fixShort}>
            Ajustar mi carrito
          </button>
        ) : open ? (
          <Link className="btn btn--primary" href="/tienda/pedido">
            Continuar con el pedido
          </Link>
        ) : (
          <p className="notice">La tienda no recibe pedidos por ahora. Su carrito se guarda en este dispositivo.</p>
        )}
        <Link className="btn btn--quiet" href="/tienda">
          Seguir mirando
        </Link>
      </aside>
    </div>
  );
}

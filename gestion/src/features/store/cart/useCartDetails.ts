"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { validateCartAction } from "../actions";
import { MAX_QTY_PER_LINE } from "../availability";
import type { CartLineDetail } from "../public-data";
import { addMoney, mulMoney } from "@/lib/money";
import type { CartLines } from "./cart-store";

export interface DetailedLine {
  readonly variantId: string;
  readonly qty: number;
  /** null: the product disappeared from the store (unpublished / inactive). */
  readonly detail: CartLineDetail | null;
  /** Units the store can currently serve for this line (0 when unavailable). */
  readonly maxQty: number;
  readonly problem: "gone" | "soldout" | "short" | null;
  readonly lineTotal: string;
}

export interface CartDetails {
  readonly status: "loading" | "ready" | "error";
  readonly message?: string;
  readonly lines: readonly DetailedLine[];
  readonly subtotal: string;
  readonly hasProblems: boolean;
}

/** Joins the browser cart (ids + qty) with live price/stock from the server. Prices are never read from the browser. */
export function mergeCart(lines: CartLines, details: readonly CartLineDetail[]): DetailedLine[] {
  const byId = new Map(details.map((d) => [d.variant_id, d]));
  return lines.map((line) => {
    const detail = byId.get(line.variantId) ?? null;
    const maxQty = detail ? Math.min(MAX_QTY_PER_LINE, detail.cap) : 0;
    const problem: DetailedLine["problem"] = !detail ? "gone" : maxQty === 0 ? "soldout" : line.qty > maxQty ? "short" : null;
    const billable = detail && maxQty > 0 ? Math.min(line.qty, maxQty) : 0;
    return {
      variantId: line.variantId,
      qty: line.qty,
      detail,
      maxQty,
      problem,
      lineTotal: detail ? mulMoney(detail.price, billable) : "0.00",
    };
  });
}

export function useCartDetails(lines: CartLines): CartDetails {
  const ids = useMemo(() => lines.map((l) => l.variantId).sort().join(","), [lines]);
  const [state, setState] = useState<{ ids: string; status: "ready" | "error"; details: readonly CartLineDetail[]; message?: string } | null>(null);
  const latest = useRef(lines);
  useEffect(() => {
    latest.current = lines;
  });

  useEffect(() => {
    if (!ids) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      validateCartAction(latest.current.map((l) => ({ variantId: l.variantId, qty: l.qty })))
        .then((result) => {
          if (cancelled) return;
          setState(result.ok ? { ids, status: "ready", details: result.lines } : { ids, status: "error", details: [], message: result.message });
        })
        .catch(() => {
          if (!cancelled) setState({ ids, status: "error", details: [], message: "No pudimos actualizar su carrito. Intente nuevamente." });
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ids]);

  return useMemo<CartDetails>(() => {
    if (!ids) return { status: "ready", lines: [], subtotal: "0.00", hasProblems: false };
    if (!state || state.ids !== ids) return { status: "loading", lines: [], subtotal: "0.00", hasProblems: false };
    if (state.status === "error") return { status: "error", message: state.message, lines: [], subtotal: "0.00", hasProblems: true };
    const merged = mergeCart(lines, state.details);
    return {
      status: "ready",
      lines: merged,
      subtotal: merged.reduce((sum, line) => addMoney(sum, line.lineTotal), "0.00"),
      hasProblems: merged.some((line) => line.problem !== null),
    };
  }, [ids, lines, state]);
}

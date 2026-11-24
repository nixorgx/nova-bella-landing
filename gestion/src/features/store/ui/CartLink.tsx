"use client";

import Link from "next/link";
import { useCart } from "../cart/useCart";

export function CartLink() {
  const { units } = useCart();
  return (
    <Link className="cart-link" href="/tienda/carrito">
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Z" />
        <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
      </svg>
      <span className="sr-only">Carrito: </span>
      <span className="cart-link__count num" data-empty={units === 0 ? "true" : undefined}>
        {units}
      </span>
      <span className="sr-only"> {units === 1 ? "par" : "pares"}</span>
    </Link>
  );
}

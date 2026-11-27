import { MAX_CART_LINES, MAX_QTY_PER_LINE } from "../availability";
export interface CartLineInput {
  readonly variantId: string;
  readonly qty: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Dependency-free validation of whatever came out of localStorage (corrupt or tampered data yields an empty cart).
 * Deliberately NOT zod: its JIT probes `new Function`, which the nonce CSP blocks and reports as a violation in
 * the browser. The server validates again with zod (schemas.ts) on every action.
 */
export function parseStoredLines(raw: unknown): CartLineInput[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CART_LINES) return [];
  const seen = new Set<string>();
  const lines: CartLineInput[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return [];
    const { variantId, qty } = item as { variantId?: unknown; qty?: unknown };
    if (typeof variantId !== "string" || !UUID.test(variantId) || seen.has(variantId)) return [];
    if (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) return [];
    seen.add(variantId);
    lines.push({ variantId, qty });
  }
  return lines;
}

/**
 * Client-side cart: only variant ids and quantities live in the browser (localStorage). Prices, names and
 * stock always come back from the server; checkout re-validates everything again. Pure functions below are
 * unit tested; the tiny external store at the bottom wires them to localStorage.
 */
export const CART_STORAGE_KEY = "nb-cart-v1";

export type CartLines = readonly CartLineInput[];

export function addLine(lines: CartLines, variantId: string, qty: number): CartLines {
  const existing = lines.find((line) => line.variantId === variantId);
  if (existing) {
    const next = Math.min(MAX_QTY_PER_LINE, existing.qty + qty);
    return lines.map((line) => (line.variantId === variantId ? { ...line, qty: next } : line));
  }
  if (lines.length >= MAX_CART_LINES) return lines;
  return [...lines, { variantId, qty: Math.max(1, Math.min(MAX_QTY_PER_LINE, qty)) }];
}

export function setLineQty(lines: CartLines, variantId: string, qty: number): CartLines {
  if (qty <= 0) return removeLine(lines, variantId);
  const bounded = Math.min(MAX_QTY_PER_LINE, Math.floor(qty));
  return lines.map((line) => (line.variantId === variantId ? { ...line, qty: bounded } : line));
}

export function removeLine(lines: CartLines, variantId: string): CartLines {
  return lines.filter((line) => line.variantId !== variantId);
}

export function countUnits(lines: CartLines): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

/** Reads whatever was stored; corrupt or tampered data yields an empty cart. */
export function decodeCart(raw: string | null): CartLines {
  if (!raw) return [];
  try {
    return parseStoredLines(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function encodeCart(lines: CartLines): string {
  return JSON.stringify(lines);
}

/** A short signature of the cart contents: a changed cart must never reuse an old checkout idempotency key. */
export function cartSignature(lines: CartLines): string {
  return [...lines]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((line) => `${line.variantId}:${line.qty}`)
    .join(",");
}

// ---- external store (browser only) ----
const EMPTY: CartLines = [];
let current: CartLines = EMPTY;
let loaded = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function readStorage(): CartLines {
  try {
    return decodeCart(window.localStorage.getItem(CART_STORAGE_KEY));
  } catch {
    return EMPTY;
  }
}

function writeStorage(lines: CartLines): void {
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, encodeCart(lines));
  } catch {
    // private mode / storage blocked: the cart still works for this tab
  }
}

function ensureLoaded(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  current = readStorage();
  window.addEventListener("storage", (event) => {
    if (event.key !== CART_STORAGE_KEY) return;
    current = readStorage();
    emit();
  });
}

export const cartStore = {
  subscribe(listener: () => void): () => void {
    ensureLoaded();
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): CartLines {
    ensureLoaded();
    return current;
  },
  getServerSnapshot(): CartLines {
    return EMPTY;
  },
  update(transform: (lines: CartLines) => CartLines): void {
    ensureLoaded();
    const next = transform(current);
    if (next === current) return;
    current = next;
    writeStorage(next);
    emit();
  },
  clear(): void {
    cartStore.update(() => EMPTY);
  },
};

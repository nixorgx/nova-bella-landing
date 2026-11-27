/** Pure state of the exchange form (kept apart from React so it can be unit tested). */

export interface Replacement {
  readonly variantId: string;
  readonly label: string;
  readonly price: string;
  readonly stock: number;
}

export interface DraftLine {
  readonly qty: number;
  readonly replacement: Replacement | null;
  /** Superadmin only: manual difference typed by the user ("" = use the computed one). */
  readonly override: string;
}

/** Keyed by the variant being returned. */
export type Draft = Readonly<Record<string, DraftLine>>;

export const EMPTY_DRAFT: Draft = Object.freeze({});

export function toggleLine(draft: Draft, variantId: string): Draft {
  if (draft[variantId]) {
    const { [variantId]: _removed, ...rest } = draft;
    void _removed;
    return rest;
  }
  return { ...draft, [variantId]: { qty: 1, replacement: null, override: "" } };
}

export function setQty(draft: Draft, variantId: string, qty: number, max: number): Draft {
  const line = draft[variantId];
  if (!line) return draft;
  return { ...draft, [variantId]: { ...line, qty: Math.min(Math.max(1, Math.floor(qty) || 1), Math.max(1, max)) } };
}

export function setReplacement(draft: Draft, variantId: string, replacement: Replacement | null): Draft {
  const line = draft[variantId];
  return line ? { ...draft, [variantId]: { ...line, replacement } } : draft;
}

export function setOverride(draft: Draft, variantId: string, override: string): Draft {
  const line = draft[variantId];
  return line ? { ...draft, [variantId]: { ...line, override: override.trim() } } : draft;
}

export const selectedCount = (draft: Draft): number => Object.keys(draft).length;

export const isReady = (draft: Draft): boolean =>
  selectedCount(draft) > 0 && Object.values(draft).every((line) => line.replacement !== null);

export function buildPayload(saleId: string, draft: Draft): {
  saleId: string;
  lines: { returnedVariantId: string; newVariantId: string; qty: number; priceDiffOverride?: string }[];
} {
  const lines = Object.entries(draft).flatMap(([returnedVariantId, line]) =>
    line.replacement
      ? [{
          returnedVariantId,
          newVariantId: line.replacement.variantId,
          qty: line.qty,
          ...(line.override ? { priceDiffOverride: line.override } : {}),
        }]
      : [],
  );
  return { saleId, lines };
}

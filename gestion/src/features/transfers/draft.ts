import type { VariantHit } from "@/features/catalog/types";

/** A transfer line as the screen holds it (what is typed is text; the server re-parses it). */
export interface TransferLine {
  readonly variantId: string;
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly colorHex: string | null;
  readonly size: string;
  /** Stock at the ORIGIN branch when the line was added. */
  readonly available: number;
  readonly qtyInput: string;
}

export const MAX_TRANSFER_QTY = 100_000;

export function lineFromHit(hit: VariantHit): TransferLine {
  return {
    variantId: hit.variantId,
    sku: hit.sku,
    model: hit.model,
    color: hit.color,
    colorHex: hit.colorHex,
    size: hit.size,
    available: hit.stock,
    qtyInput: "1",
  };
}

/** Parses a typed quantity: whole number >= 1, or null. */
export function parseQty(input: string): number | null {
  const text = input.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const value = Number(text);
  return value >= 1 && value <= MAX_TRANSFER_QTY ? value : null;
}

/** Picking a variant already in the list adds one more unit (never a duplicate row). */
export function addLine(lines: readonly TransferLine[], hit: VariantHit): TransferLine[] {
  const existing = lines.find((line) => line.variantId === hit.variantId);
  if (!existing) return [...lines, lineFromHit(hit)];
  return lines.map((line) =>
    line.variantId === hit.variantId ? { ...line, qtyInput: String((parseQty(line.qtyInput) ?? 0) + 1) } : line,
  );
}

export function patchQty(lines: readonly TransferLine[], variantId: string, qtyInput: string): TransferLine[] {
  return lines.map((line) => (line.variantId === variantId ? { ...line, qtyInput } : line));
}

export function dropLine(lines: readonly TransferLine[], variantId: string): TransferLine[] {
  return lines.filter((line) => line.variantId !== variantId);
}

/** Message for one line, or null when it is fine. */
export function lineError(line: TransferLine): string | null {
  const qty = parseQty(line.qtyInput);
  if (qty === null) return "Ingrese una cantidad entera mayor a cero.";
  if (qty > line.available) {
    return line.available === 0 ? "No hay stock de este producto en la sucursal de origen." : `Solo hay ${line.available} en la sucursal de origen.`;
  }
  return null;
}

export interface DraftSummary {
  readonly products: number;
  readonly units: number;
  readonly ready: boolean;
}

export function summarize(lines: readonly TransferLine[]): DraftSummary {
  const units = lines.reduce((sum, line) => sum + (parseQty(line.qtyInput) ?? 0), 0);
  return { products: lines.length, units, ready: lines.length > 0 && lines.every((line) => lineError(line) === null) };
}

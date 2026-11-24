import type Decimal from "decimal.js";
import { calculateLandedCost } from "@/lib/costing";
import { D, dec, normalizeDecimalText, parseMoney, toMoney } from "@/lib/money";
import { parseInteger, parseRate } from "@/lib/number-input";

/** Raw text of the purchase form: what people type, nothing parsed yet. */
export interface DraftItem {
  readonly variantId: string;
  readonly qtyInput: string;
  readonly costInput: string;
}

export interface PurchaseDraft {
  readonly rate70Input: string;
  readonly rate30Input: string;
  readonly splitInput: string;
  readonly freightInput: string;
  readonly items: readonly DraftItem[];
}

export interface PreviewRow {
  readonly variantId: string;
  readonly qty: number | null;
  readonly costUsd: string | null;
  /** Landed cost per unit in Bs (same rounding as the SQL landed_cost_bs). */
  readonly unitBs: string | null;
  readonly lineBs: string | null;
  readonly error?: string;
}

export interface DraftErrors {
  rate70?: string;
  rate30?: string;
  split?: string;
  freight?: string;
  items?: string;
}

export interface BatchPreview {
  readonly rows: readonly PreviewRow[];
  readonly errors: DraftErrors;
  readonly totalUnits: number;
  readonly totalUsd: string;
  readonly totalBs: string;
  readonly freightPerUnit: string;
  readonly blendedRate: string | null;
  readonly ready: boolean;
}

export const MAX_ITEM_QTY = 100_000;
export const MAX_ITEMS = 500;
const MAX_COST_USD = 99_999.99;
const MAX_FREIGHT_BS = 9_999_999.99;

interface Globals {
  readonly rate70: string | null;
  readonly rate30: string | null;
  readonly split: string | null;
  readonly freight: string | null;
  readonly errors: DraftErrors;
}

function readGlobals(draft: PurchaseDraft): Globals {
  const errors: DraftErrors = {};
  const rate70 = parseRate(draft.rate70Input);
  const rate30 = parseRate(draft.rate30Input);
  if (rate70 === null) errors.rate70 = "Ingrese un tipo de cambio mayor a cero (ej. 6,96).";
  if (rate30 === null) errors.rate30 = "Ingrese un tipo de cambio mayor a cero (ej. 10,50).";

  const splitText = normalizeDecimalText(draft.splitInput, 2);
  const split = splitText !== null && dec(splitText).gte(0) && dec(splitText).lte(100) ? splitText : null;
  if (split === null) errors.split = "El porcentaje debe estar entre 0 y 100.";

  const freightText = draft.freightInput.trim() === "" ? "0" : parseMoney(draft.freightInput);
  const freight =
    freightText !== null && dec(freightText).gte(0) && dec(freightText).lte(MAX_FREIGHT_BS) ? toMoney(freightText) : null;
  if (freight === null) errors.freight = "El flete debe ser 0 o un monto en Bs (ej. 150,00).";

  return { rate70, rate30, split, freight, errors };
}

interface ParsedItem {
  readonly item: DraftItem;
  readonly qty: number | null;
  readonly costUsd: string | null;
  readonly error?: string;
}

function parseItem(item: DraftItem): ParsedItem {
  const qty = parseInteger(item.qtyInput, 1, MAX_ITEM_QTY);
  const money = parseMoney(item.costInput);
  const costUsd = money !== null && dec(money).gte(0) && dec(money).lte(MAX_COST_USD) ? money : null;
  const error =
    qty === null
      ? "La cantidad debe ser un entero mayor a cero."
      : costUsd === null
        ? "El costo en USD debe ser 0 o más, con hasta 2 decimales."
        : undefined;
  return { item, qty, costUsd, error };
}

function blended(g: Globals): string | null {
  if (g.rate70 === null || g.rate30 === null || g.split === null) return null;
  const share = dec(g.split).div(100);
  return share.times(g.rate70).plus(new D(1).minus(share).times(g.rate30)).toFixed(4);
}

/**
 * Live preview of a batch. Uses the very same pure calculateLandedCost() the SQL function
 * mirrors, with the freight prorated over EVERY unit of the batch.
 */
export function previewDraft(draft: PurchaseDraft): BatchPreview {
  const globals = readGlobals(draft);
  const errors: DraftErrors = { ...globals.errors };
  if (draft.items.length === 0) errors.items = "Agregue al menos un producto al lote.";
  if (draft.items.length > MAX_ITEMS) errors.items = `Un lote admite hasta ${MAX_ITEMS} productos.`;

  const parsed = draft.items.map(parseItem);
  const totalUnits = parsed.reduce((sum, p) => sum + (p.qty ?? 0), 0);
  const canPrice = Object.keys(globals.errors).length === 0 && totalUnits > 0;
  const freight = globals.freight ?? "0";

  let totalBs: Decimal = new D(0);
  let totalUsd: Decimal = new D(0);
  const rows: PreviewRow[] = parsed.map((p) => {
    const base = { variantId: p.item.variantId, qty: p.qty, costUsd: p.costUsd, error: p.error };
    if (!canPrice || p.qty === null || p.costUsd === null) return { ...base, unitBs: null, lineBs: null };
    const unit = calculateLandedCost({
      unitCostUsd: p.costUsd,
      rate70: globals.rate70 as string,
      rate30: globals.rate30 as string,
      splitPct: globals.split as string,
      freightBs: freight,
      totalUnits,
    });
    const line = unit.times(p.qty);
    totalBs = totalBs.plus(line);
    totalUsd = totalUsd.plus(dec(p.costUsd).times(p.qty));
    return { ...base, unitBs: unit.toFixed(2), lineBs: toMoney(line) };
  });

  const ready = Object.keys(errors).length === 0 && parsed.every((p) => p.error === undefined);
  return {
    rows,
    errors,
    totalUnits,
    totalUsd: toMoney(totalUsd),
    totalBs: toMoney(totalBs),
    freightPerUnit: totalUnits > 0 ? toMoney(dec(freight).div(totalUnits)) : "0.00",
    blendedRate: blended(globals),
    ready,
  };
}

export interface ParsedDraft {
  readonly rate70: string;
  readonly rate30: string;
  readonly splitPct: string;
  readonly freightBs: string;
  readonly items: readonly { readonly variantId: string; readonly qty: number; readonly unitCostUsd: string }[];
}

/** Canonical values of a valid draft (the server re-parses what the browser sends), or the errors. */
export function parseDraft(draft: PurchaseDraft): { ok: true; value: ParsedDraft } | { ok: false; errors: DraftErrors } {
  const preview = previewDraft(draft);
  if (!preview.ready) {
    const rowError = preview.rows.find((row) => row.error)?.error;
    return { ok: false, errors: rowError ? { ...preview.errors, items: rowError } : preview.errors };
  }
  const globals = readGlobals(draft);
  return {
    ok: true,
    value: {
      rate70: globals.rate70 as string,
      rate30: globals.rate30 as string,
      splitPct: globals.split as string,
      freightBs: globals.freight as string,
      items: preview.rows.map((row) => ({
        variantId: row.variantId,
        qty: row.qty as number,
        unitCostUsd: row.costUsd as string,
      })),
    },
  };
}

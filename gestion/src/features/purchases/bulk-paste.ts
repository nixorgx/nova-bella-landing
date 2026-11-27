/** One pasted line: "SKU;cantidad;costo USD" (also tab, comma or spaces as separators). */
export interface BulkLine {
  readonly code: string;
  readonly qtyInput: string;
  readonly costInput: string;
}

export interface BulkParse {
  readonly lines: readonly BulkLine[];
  readonly invalid: readonly string[];
}

export const MAX_BULK_LINES = 200;

/** Parses pasted rows. Decimal commas in the cost are kept, so ";" or tab separate columns first. */
export function parseBulkText(text: string): BulkParse {
  const lines: BulkLine[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, MAX_BULK_LINES)) {
    const parts = (/[;\t]/.test(raw) ? raw.split(/[;\t]/) : raw.split(/\s+/)).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3 || !/^\d+$/.test(parts[1])) {
      invalid.push(raw);
      continue;
    }
    lines.push({ code: parts[0], qtyInput: parts[1], costInput: parts[2] });
  }
  return { lines, invalid };
}

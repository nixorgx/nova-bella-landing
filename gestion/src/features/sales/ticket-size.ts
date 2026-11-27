/**
 * Page height (mm) of the 80 mm receipt. Chrome ignores `size: 80mm auto`, so the roll length
 * is estimated from the content (generously: a thermal printer cuts after the last line, and a
 * PDF only gains some white space at the bottom).
 */
export const TICKET_WIDTH_MM = 80;

export function ticketHeightMm(input: {
  lines: number;
  payments: number;
  hasDiscount: boolean;
  hasCustomerId: boolean;
  /** Exchange lines printed under the products (sale reprint with a CAMBIO note). */
  exchangeLines?: number;
}): number {
  const header = 58;
  const perLine = 11;
  const totals = 18 + (input.hasDiscount ? 10 : 0);
  const payments = 6 + input.payments * 5;
  const footer = 22 + (input.hasCustomerId ? 5 : 0);
  const exchanges = (input.exchangeLines ?? 0) > 0 ? 14 + (input.exchangeLines ?? 0) * 13 : 0;
  return Math.ceil((header + input.lines * perLine + totals + payments + footer + exchanges) * 1.15);
}

/** Height of the stand-alone exchange receipt (one block per exchanged line). */
export function exchangeTicketHeightMm(input: { lines: number; hasReason: boolean }): number {
  const header = 62;
  const perLine = 24;
  const totals = 28;
  const footer = 22 + (input.hasReason ? 8 : 0);
  return Math.ceil((header + input.lines * perLine + totals + footer) * 1.15);
}

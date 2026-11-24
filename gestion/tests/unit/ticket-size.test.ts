import { describe, expect, it } from "vitest";
import { exchangeTicketHeightMm, ticketHeightMm } from "@/features/sales/ticket-size";

describe("ticketHeightMm", () => {
  const base = { lines: 1, payments: 1, hasDiscount: false, hasCustomerId: false };
  it("grows with lines, payments and discount", () => {
    expect(ticketHeightMm({ ...base, lines: 5 })).toBeGreaterThan(ticketHeightMm(base));
    expect(ticketHeightMm({ ...base, payments: 3 })).toBeGreaterThan(ticketHeightMm(base));
    expect(ticketHeightMm({ ...base, hasDiscount: true })).toBeGreaterThan(ticketHeightMm(base));
  });
  it("always returns a whole, printable height", () => {
    expect(Number.isInteger(ticketHeightMm(base))).toBe(true);
    expect(ticketHeightMm(base)).toBeGreaterThan(100);
  });
});

describe("exchange receipts", () => {
  it("reserves room for the exchange lines printed on a sale reprint", () => {
    const base = { lines: 1, payments: 1, hasDiscount: false, hasCustomerId: false };
    expect(ticketHeightMm({ ...base, exchangeLines: 2 })).toBeGreaterThan(ticketHeightMm(base));
    expect(ticketHeightMm({ ...base, exchangeLines: 0 })).toBe(ticketHeightMm(base));
  });
  it("grows with the exchanged lines and the reason", () => {
    expect(exchangeTicketHeightMm({ lines: 3, hasReason: false })).toBeGreaterThan(exchangeTicketHeightMm({ lines: 1, hasReason: false }));
    expect(exchangeTicketHeightMm({ lines: 1, hasReason: true })).toBeGreaterThan(exchangeTicketHeightMm({ lines: 1, hasReason: false }));
    expect(Number.isInteger(exchangeTicketHeightMm({ lines: 2, hasReason: true }))).toBe(true);
  });
});

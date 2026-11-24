import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { closeCashSession, openCashSession } from "@/features/cash/commands";
import { getCashSessionReport, listCashSessions, listSessionExchanges, listSessionSales } from "@/features/cash/session-report";
import { createExchange } from "@/features/exchanges/create-exchange";
import { voidSale } from "@/features/sales/void-sale";
import { addStock, closeCashSessions, createBranch, createUser, createVariant, rpcCreateSale } from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let other: SessionPayload;
let admin: SessionPayload;
let sessionId: string;

async function stocked(price: string) {
  const v = await createVariant(price);
  await addStock(v.variantId, branch, 10);
  return v.variantId;
}

async function sell(variantId: string, price: string, payments: { method: string; amount: string }[]) {
  return withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, [{ variantId, qty: 1, finalPrice: price }], payments));
}

beforeAll(async () => {
  branch = await createBranch(true, false);
  seller = await createUser("seller", branch);
  other = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
});

describe("cash session report", () => {
  it("opens through the command, sells, exchanges (cash refund), voids, closes and reconciles", async () => {
    await closeCashSessions(branch);
    sessionId = await openCashSession(seller, branch, "150,00");

    const a = await stocked("100.00");
    const b = await stocked("70.00");
    const c = await stocked("50.00");
    const d = await stocked("40.00");
    const first = await sell(a, "100.00", [{ method: "efectivo", amount: "60.00" }, { method: "qr", amount: "40.00" }]);
    await sell(c, "50.00", [{ method: "tarjeta", amount: "50.00" }]);
    const dropped = await sell(d, "40.00", [{ method: "efectivo", amount: "40.00" }]);
    await voidSale(admin, { saleId: dropped, reason: "Se cobró dos veces" }); // inside the open session: leaves the books
    // exchange 100 -> 70 : 30 refunded in cash
    await createExchange(seller, {
      saleId: first, reason: "modelo", note: undefined, paymentMethod: "efectivo",
      lines: [{ returnedVariantId: a, newVariantId: b, qty: 1, priceDiffOverride: undefined }],
    });

    const open = await getCashSessionReport(seller, sessionId);
    // cash: 150 opening + 60 cash sale - 30 refunded = 180 ; qr 40 ; tarjeta 50
    expect(open).toMatchObject({ status: "open", salesCount: 2, salesTotal: "150.00", expectedCash: "180.00", difference: null, exchangeCount: 1, voidCount: 1, voidTotal: "40.00" });
    const cash = open!.methods.find((m) => m.method === "efectivo");
    expect(cash).toMatchObject({ sales: "60.00", exchanges: "-30.00", net: "30.00" });

    const closed = await closeCashSession(seller, sessionId, "175,00");
    expect(closed).toMatchObject({ expected: "180.00", counted: "175.00", difference: "-5.00" });

    const report = await getCashSessionReport(seller, sessionId);
    expect(report).toMatchObject({ status: "closed", expectedCash: "180.00", difference: "-5.00", closingAmount: "175.00" });
  });

  it("keeps a closed session's books even when a sale is voided afterwards", async () => {
    const lateVoid = (await listSessionSales(admin, sessionId)).find((s) => s.status === "completed" && s.total === "50.00")!.id;
    await voidSale(admin, { saleId: lateVoid, reason: "Anulada al día siguiente" });
    const report = await getCashSessionReport(admin, sessionId);
    expect(report).toMatchObject({ expectedCash: "180.00", difference: "-5.00", salesCount: 2 });
    expect(report!.voidCount).toBe(2);
  });

  it("lists every sale of the session (voided ones included) and its exchanges", async () => {
    const sales = await listSessionSales(admin, sessionId);
    expect(sales).toHaveLength(3);
    expect(sales.filter((s) => s.status === "voided").map((s) => s.voidReason).sort()).toEqual(["Anulada al día siguiente", "Se cobró dos veces"]);
    const exchanges = await listSessionExchanges(admin, sessionId);
    expect(exchanges).toEqual([expect.objectContaining({ priceDiff: "-30.00", method: "efectivo" })]);
  });
});

describe("visibility", () => {
  it("the superadmin filters by branch, cashier and date; a seller only sees sessions they opened", async () => {
    const request = { page: 1, pageSize: 50 };
    const asAdmin = await listCashSessions(admin, { branchId: branch, openedBy: seller.userId }, request);
    expect(asAdmin.rows.map((r) => r.id)).toContain(sessionId);
    const none = await listCashSessions(admin, { branchId: branch, openedBy: other.userId }, request);
    expect(none.total).toBe(0);
    const future = await listCashSessions(admin, { branchId: branch, from: "2999-01-01" }, request);
    expect(future.total).toBe(0);

    const own = await listCashSessions(seller, { openedBy: other.userId }, request); // the filter is ignored for sellers
    expect(own.rows.every((r) => r.openedBy === seller.userId)).toBe(true);
    expect(own.rows.map((r) => r.id)).toContain(sessionId);

    const notMine = await listCashSessions(other, {}, request);
    expect(notMine.rows.map((r) => r.id)).not.toContain(sessionId);
    expect(await getCashSessionReport(other, sessionId)).toBeNull();
  });
});

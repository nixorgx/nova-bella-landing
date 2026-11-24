import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { todayKey } from "@/lib/format";
import { closeCashSession, openCashSession, CashError } from "@/features/cash/commands";
import { getCashSummary, getOpenSession, listRecentSessions } from "@/features/cash/queries";
import { createSale, resolveSaleBranch, SaleError } from "@/features/sales/create-sale";
import { getSaleDetail, listSales, listSellers } from "@/features/sales/queries";
import { saleInputSchema, type SaleInput } from "@/features/sales/schemas";
import { createBranch, createUser, createVariant, addStock, expectPgError, stockOf, type TestVariant } from "../helpers/fixtures";

let branch: string;
let otherBranch: string;
let seller: SessionPayload;
let sellerB: SessionPayload;
let outsider: SessionPayload;
let admin: SessionPayload;
let shoe: TestVariant;

const sale = (over: Record<string, unknown> = {}): SaleInput =>
  saleInputSchema.parse({
    docType: "nota_venta",
    items: [{ variantId: shoe.variantId, qty: 2, finalPrice: "90,00" }],
    payments: [
      { method: "efectivo", amount: "100,00" },
      { method: "qr", amount: "80,00" },
    ],
    ...over,
  });

beforeAll(async () => {
  branch = await createBranch(true, false); // no cash open on purpose
  otherBranch = await createBranch();
  [seller, sellerB, outsider, admin] = await Promise.all([
    createUser("seller", branch),
    createUser("seller", branch),
    createUser("seller", otherBranch),
    createUser("superadmin", null),
  ]);
  shoe = await createVariant("100.00");
  await addStock(shoe.variantId, branch, 20);
});

describe("cash session basics", () => {
  it("blocks sales until the cash is open, with a clear Spanish message", async () => {
    expect(await getOpenSession(seller, branch)).toBeNull();
    await expect(createSale(seller, sale())).rejects.toMatchObject({ code: "IN005", message: /caja abierta/i });
  });

  it("a seller opens the cash of their own branch; a second open is refused", async () => {
    await openCashSession(seller, branch, "200,00");
    const open = await getOpenSession(seller, branch);
    expect(open).toMatchObject({ openingAmount: "200.00", branchId: branch });
    await expect(openCashSession(sellerB, branch, "0")).rejects.toBeInstanceOf(CashError);
  });

  it("a seller cannot open the cash of another branch", async () => {
    const fresh = await createBranch(true, false);
    await expectPgError(openCashSession(seller, fresh, "10"), "42501");
  });

  it("rejects unreadable opening amounts", async () => {
    await expect(openCashSession(admin, branch, "abc")).rejects.toBeInstanceOf(CashError);
  });
});

describe("sales through the feature layer", () => {
  it("sells with mixed payments, decrements stock and keeps list vs final price", async () => {
    const before = await stockOf(shoe.variantId, branch);
    const id = await createSale(seller, sale());
    expect(await stockOf(shoe.variantId, branch)).toBe(before - 2);

    const detail = await getSaleDetail(seller, id);
    expect(detail).toMatchObject({ total: "180.00", docType: "nota_venta", listTotal: "200.00", discount: "20.00" });
    expect(detail?.lines[0]).toMatchObject({ qty: 2, listPrice: "100.00", finalPrice: "90.00" });
    expect(detail?.payments.map((p) => p.method).sort()).toEqual(["efectivo", "qr"]);
    expect(detail?.sellerName).toBe("Usuario de prueba");
  });

  it("refuses payments that do not add up (IN002) and stock beyond the shelf (IN001)", async () => {
    await expectPgError(
      createSale(seller, sale({ payments: [{ method: "efectivo", amount: "179,99" }] })),
      "IN002",
    );
    await expectPgError(
      createSale(seller, sale({ items: [{ variantId: shoe.variantId, qty: 500, finalPrice: "100" }], payments: [{ method: "efectivo", amount: "50000" }] })),
      "IN001",
    );
  });

  it("sellers always sell in their own branch, whatever the client sends", () => {
    expect(resolveSaleBranch(seller, otherBranch)).toBe(branch);
    expect(resolveSaleBranch(admin, otherBranch)).toBe(otherBranch);
    expect(() => resolveSaleBranch(admin, null)).toThrow(SaleError);
  });

  it("schema rejects duplicated products, zero prices and unknown methods", () => {
    const base = { docType: "factura", payments: [{ method: "qr", amount: "10" }] };
    const item = { variantId: shoe.variantId, qty: 1, finalPrice: "10" };
    expect(saleInputSchema.safeParse({ ...base, items: [item, item] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...base, items: [{ ...item, finalPrice: "0" }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...base, items: [item], payments: [{ method: "cheque", amount: "10" }] }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...base, items: [] }).success).toBe(false);
  });
});

describe("history is scoped by branch", () => {
  it("a seller sees only their own branch; filters by doc type, seller and date work", async () => {
    await createSale(sellerB, sale({ docType: "factura", items: [{ variantId: shoe.variantId, qty: 1, finalPrice: "100" }], payments: [{ method: "tarjeta", amount: "100" }] }));
    const request = { page: 1, pageSize: 50 };

    const mine = await listSales(seller, {}, request);
    expect(mine.total).toBeGreaterThanOrEqual(2);
    expect(mine.rows.every((r) => r.branchName.startsWith("Sucursal"))).toBe(true);
    expect((await listSales(outsider, {}, request)).rows.every((r) => !mine.rows.some((m) => m.id === r.id))).toBe(true);

    const facturas = await listSales(seller, { docType: "factura" }, request);
    expect(facturas.rows.length).toBeGreaterThan(0);
    expect(facturas.rows.every((r) => r.docType === "factura")).toBe(true);

    const bySeller = await listSales(seller, { sellerId: sellerB.userId }, request);
    expect(bySeller.total).toBe(1);

    // The app filters by the La Paz calendar day (UTC-4); the UTC date is wrong after 20:00 local.
    const today = todayKey();
    expect((await listSales(seller, { from: today, to: today }, request)).total).toBeGreaterThanOrEqual(2);
    expect((await listSales(seller, { to: "2020-01-01" }, request)).total).toBe(0);
    expect((await listSellers(seller)).map((s) => s.id)).toEqual(expect.arrayContaining([seller.userId, sellerB.userId]));
  });

  it("a seller cannot open a sale of another branch", async () => {
    const other = await listSales(admin, { branchId: otherBranch }, { page: 1, pageSize: 5 });
    const all = await listSales(admin, {}, { page: 1, pageSize: 1 });
    expect(all.total).toBeGreaterThan(0);
    const foreignId = (await listSales(admin, { branchId: branch }, { page: 1, pageSize: 1 })).rows[0].id;
    expect(await getSaleDetail(outsider, foreignId)).toBeNull();
    expect(other.total).toBeGreaterThanOrEqual(0);
  });

  it("sale detail has no cost vocabulary", async () => {
    const id = (await listSales(seller, {}, { page: 1, pageSize: 1 })).rows[0].id;
    const json = JSON.stringify(await getSaleDetail(seller, id)).toLowerCase();
    expect(json).not.toMatch(/cost|landed|margin|usd/);
  });
});

describe("closing the cash", () => {
  it("reports expected vs counted and freezes the session", async () => {
    const open = await getOpenSession(seller, branch);
    if (!open) throw new Error("expected an open cash session");
    const summary = await getCashSummary(seller, open);
    expect(summary.byMethod.efectivo).toBe("100.00");
    expect(summary.byMethod.qr).toBe("80.00");
    expect(summary.expectedCash).toBe("300.00"); // 200 float + 100 cash

    const closed = await closeCashSession(seller, open.id, "295,00");
    expect(closed).toMatchObject({ expected: "300.00", counted: "295.00", difference: "-5.00" });
    expect(await getOpenSession(seller, branch)).toBeNull();
    expect((await listRecentSessions(seller, branch))[0]).toMatchObject({ id: open.id, closingAmount: "295.00" });
    await expect(closeCashSession(seller, open.id, "10")).rejects.toBeInstanceOf(CashError);
  });

  it("sales are blocked again after closing", async () => {
    await expect(createSale(seller, sale())).rejects.toMatchObject({ code: "IN005" });
  });
});

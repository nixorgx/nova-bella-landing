import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import {
  addStock,
  closeCashSessions,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  ledgerSum,
  rpcCreateSale,
  stockOf,
  type TestVariant,
} from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let admin: SessionPayload;
let v1: TestVariant;
let v2: TestVariant;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
  v1 = await createVariant("200.00");
  v2 = await createVariant("80.50");
  await addStock(v1.variantId, branch, 10);
  await addStock(v2.variantId, branch, 4);
});

describe("create_sale", () => {
  it("stores list and final price, payments, movements and reduces stock", async () => {
    const saleId = await withUser(seller, (c) =>
      rpcCreateSale(
        c,
        { branchId: branch, docType: "factura" },
        [
          { variantId: v1.variantId, qty: 2, finalPrice: "180.00" },
          { variantId: v2.variantId, qty: 1, finalPrice: "80.50" },
        ],
        [
          { method: "efectivo", amount: "300.00" },
          { method: "qr", amount: "140.50" },
        ],
      ),
    );
    const sale = (await systemQuery("select * from sales where id = $1", [saleId])).rows[0];
    expect(sale).toMatchObject({ total: "440.50", status: "completed", channel: "store", doc_type: "factura" });
    expect(sale.seller_id).toBe(seller.userId);

    const items = (
      await systemQuery("select variant_id, qty, list_price, final_price from sale_items where sale_id = $1", [saleId])
    ).rows;
    const line1 = items.find((i) => i.variant_id === v1.variantId);
    expect(line1).toMatchObject({ qty: 2, list_price: "200.00", final_price: "180.00" });
    expect((await systemQuery("select 1 from sale_payments where sale_id = $1", [saleId])).rowCount).toBe(2);
    expect(await stockOf(v1.variantId, branch)).toBe(8);
    expect(await stockOf(v2.variantId, branch)).toBe(3);
    expect(await ledgerSum(v1.variantId, branch)).toBe(8);
  });

  it("rejects insufficient stock and leaves nothing behind", async () => {
    const before = await stockOf(v2.variantId, branch);
    const salesBefore = (await systemQuery("select count(*)::int as n from sales where branch_id = $1", [branch])).rows[0].n;
    const attempt = withUser(seller, (c) =>
      rpcCreateSale(
        c,
        { branchId: branch },
        [
          { variantId: v1.variantId, qty: 1, finalPrice: "10.00" },
          { variantId: v2.variantId, qty: before + 1, finalPrice: "10.00" },
        ],
        [{ method: "efectivo", amount: String(10 + (before + 1) * 10) + ".00" }],
      ),
    );
    const error = await expectPgError(attempt, "IN001");
    expect(error.message).toContain(v2.sku);
    expect(await stockOf(v2.variantId, branch)).toBe(before);
    const salesAfter = (await systemQuery("select count(*)::int as n from sales where branch_id = $1", [branch])).rows[0].n;
    expect(salesAfter).toBe(salesBefore);
  });

  it("aggregates repeated variants when checking stock", async () => {
    const v = await createVariant();
    await addStock(v.variantId, branch, 3);
    const attempt = withUser(seller, (c) =>
      rpcCreateSale(
        c,
        { branchId: branch },
        [
          { variantId: v.variantId, qty: 2, finalPrice: "10.00" },
          { variantId: v.variantId, qty: 2, finalPrice: "10.00" },
        ],
        [{ method: "efectivo", amount: "40.00" }],
      ),
    );
    await expectPgError(attempt, "IN001");
  });

  it("rejects payments that do not match the total", async () => {
    const run = (amount: string) =>
      withUser(seller, (c) =>
        rpcCreateSale(c, { branchId: branch }, [{ variantId: v1.variantId, qty: 1, finalPrice: "100.00" }], [
          { method: "efectivo", amount },
        ]),
      );
    await expectPgError(run("99.99"), "IN002");
    await expectPgError(run("100.01"), "IN002");
  });

  it("rejects mixed payments that do not add up", async () => {
    const attempt = withUser(seller, (c) =>
      rpcCreateSale(c, { branchId: branch }, [{ variantId: v1.variantId, qty: 1, finalPrice: "100.00" }], [
        { method: "efectivo", amount: "60.00" },
        { method: "qr", amount: "30.00" },
      ]),
    );
    await expectPgError(attempt, "IN002");
  });

  it.each([
    ["unknown payment method", [{ method: "bitcoin", amount: "10.00" }], "10.00", 1, "IN003"],
    ["zero amount payment", [{ method: "efectivo", amount: "0" }], "10.00", 1, "IN003"],
    ["zero quantity", [{ method: "efectivo", amount: "10.00" }], "10.00", 0, "IN003"],
    ["negative price", [{ method: "efectivo", amount: "10.00" }], "-10.00", 1, "IN003"],
    ["three decimal price", [{ method: "efectivo", amount: "10.00" }], "10.005", 1, "IN003"],
  ])("rejects %s", async (_label, payments, price, qty, code) => {
    const attempt = withUser(seller, (c) =>
      rpcCreateSale(c, { branchId: branch }, [{ variantId: v1.variantId, qty, finalPrice: price }], payments),
    );
    await expectPgError(attempt, code);
  });

  it("rejects an empty cart, a bad doc type and unknown products or customers", async () => {
    await expectPgError(withUser(seller, (c) => rpcCreateSale(c, { branchId: branch }, [], [])), "IN003");
    await expectPgError(
      withUser(seller, (c) =>
        rpcCreateSale(c, { branchId: branch, docType: "recibo" }, [{ variantId: v1.variantId, qty: 1, finalPrice: "1.00" }], [
          { method: "efectivo", amount: "1.00" },
        ]),
      ),
      "IN003",
    );
    const ghost = "00000000-0000-4000-8000-000000000000";
    await expectPgError(
      withUser(seller, (c) =>
        rpcCreateSale(c, { branchId: branch }, [{ variantId: ghost, qty: 1, finalPrice: "1.00" }], [
          { method: "efectivo", amount: "1.00" },
        ]),
      ),
      "IN005",
    );
    await expectPgError(
      withUser(seller, (c) =>
        rpcCreateSale(c, { branchId: branch, customerId: ghost }, [{ variantId: v1.variantId, qty: 1, finalPrice: "1.00" }], [
          { method: "efectivo", amount: "1.00" },
        ]),
      ),
      "IN005",
    );
  });

  it("rejects inactive branches and a closed cash session", async () => {
    const inactive = await createBranch(false);
    await expectPgError(
      withUser(admin, (c) =>
        rpcCreateSale(c, { branchId: inactive }, [{ variantId: v1.variantId, qty: 1, finalPrice: "1.00" }], [
          { method: "efectivo", amount: "1.00" },
        ]),
      ),
      "IN005",
    );
    const closedBranch = await createBranch();
    const closedSeller = await createUser("seller", closedBranch);
    const closedId = (
      await systemQuery<{ id: string }>("select id from cash_sessions where branch_id = $1", [closedBranch])
    ).rows[0].id;
    await closeCashSessions(closedBranch);
    await expectPgError(
      withUser(closedSeller, (c) =>
        rpcCreateSale(c, { branchId: closedBranch, cashSessionId: closedId }, [{ variantId: v1.variantId, qty: 1, finalPrice: "1.00" }], [
          { method: "efectivo", amount: "1.00" },
        ]),
      ),
      "IN005",
    );
  });

  it("allows a sale with the open cash session and a customer", async () => {
    const cash = (
      await systemQuery<{ id: string }>("select id from cash_sessions where branch_id = $1 and closed_at is null", [branch])
    ).rows[0].id;
    const customer = (
      await systemQuery<{ id: string }>("insert into customers (name) values ('Cliente') returning id")
    ).rows[0].id;
    const id = await withUser(seller, (c) =>
      rpcCreateSale(c, { branchId: branch, cashSessionId: cash, customerId: customer }, [
        { variantId: v1.variantId, qty: 1, finalPrice: "150.00" },
      ], [{ method: "tarjeta", amount: "150.00" }]),
    );
    const sale = (await systemQuery("select cash_session_id, customer_id from sales where id = $1", [id])).rows[0];
    expect(sale).toEqual({ cash_session_id: cash, customer_id: customer });
  });
});

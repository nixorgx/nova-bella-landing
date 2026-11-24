import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import {
  addStock,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  ledgerSum,
  sellOne,
  stockOf,
  type TestVariant,
} from "../helpers/fixtures";

let branch: string;
let otherBranch: string;
let seller: SessionPayload;
let otherSeller: SessionPayload;
let admin: SessionPayload;
let small: TestVariant;
let large: TestVariant;

beforeAll(async () => {
  [branch, otherBranch] = await Promise.all([createBranch(), createBranch()]);
  seller = await createUser("seller", branch);
  otherSeller = await createUser("seller", otherBranch);
  admin = await createUser("superadmin", null);
});

async function freshStock(price = "100.00") {
  const v = await createVariant(price);
  await addStock(v.variantId, branch, 10);
  return v;
}

describe("void_sale", () => {
  it("restores stock with inverse movements and keeps the sale", async () => {
    const v = await freshStock();
    const saleId = await sellOne(seller, branch, v.variantId, 3, "100.00", "300.00");
    expect(await stockOf(v.variantId, branch)).toBe(7);

    await withUser(admin, (c) => c.query("select void_sale($1, 'error de digitacion')", [saleId]));

    expect(await stockOf(v.variantId, branch)).toBe(10);
    expect(await ledgerSum(v.variantId, branch)).toBe(10);
    const sale = (await systemQuery("select status, voided_by, void_reason, voided_at from sales where id = $1", [saleId])).rows[0];
    expect(sale).toMatchObject({ status: "voided", voided_by: admin.userId, void_reason: "error de digitacion" });
    expect(sale.voided_at).not.toBeNull();
    const types = (await systemQuery("select type from stock_movements where ref_id = $1 order by type", [saleId])).rows;
    expect(types.map((r) => r.type)).toEqual(["sale", "void"]);
  });

  it("is superadmin-only", async () => {
    const v = await freshStock();
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    await expectPgError(withUser(seller, (c) => c.query("select void_sale($1, 'motivo de prueba')", [saleId])), "42501");
    expect(await stockOf(v.variantId, branch)).toBe(9);
  });

  it("cannot void twice or an unknown sale", async () => {
    const v = await freshStock();
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    await withUser(admin, (c) => c.query("select void_sale($1, 'motivo de prueba')", [saleId]));
    await expectPgError(withUser(admin, (c) => c.query("select void_sale($1, 'motivo de prueba')", [saleId])), "IN005");
    await expectPgError(
      withUser(admin, (c) => c.query("select void_sale('00000000-0000-4000-8000-000000000000', 'motivo de prueba')")),
      "IN005",
    );
    expect(await stockOf(v.variantId, branch)).toBe(10);
  });

  it("refuses to void a sale that already has exchanges", async () => {
    const a = await freshStock();
    const b = await freshStock();
    const saleId = await sellOne(seller, branch, a.variantId, 1, "100.00", "100.00");
    await withUser(seller, (c) =>
      c.query("select create_exchange($1, $2, $3, 1, 'talla', null)", [saleId, a.variantId, b.variantId]),
    );
    await expectPgError(withUser(admin, (c) => c.query("select void_sale($1, 'motivo de prueba')", [saleId])), "IN005");
  });
});

describe("create_exchange", () => {
  beforeAll(async () => {
    small = await freshStock("100.00");
    large = await freshStock("130.00");
  });

  it("swaps stock with exchange_in / exchange_out and records the price difference", async () => {
    const saleId = await sellOne(seller, branch, small.variantId, 2, "90.00", "180.00");
    const exchangeId = await withUser(seller, async (c) => {
      const { rows } = await c.query<{ id: string }>(
        "select create_exchange($1, $2, $3, 1, 'le quedaba chico', null, 'efectivo') as id",
        [saleId, small.variantId, large.variantId],
      );
      return rows[0].id;
    });
    // 8 left after sale + 1 returned
    expect(await stockOf(small.variantId, branch)).toBe(9);
    expect(await stockOf(large.variantId, branch)).toBe(9);
    const row = (await systemQuery("select price_diff, qty, reason from exchanges where id = $1", [exchangeId])).rows[0];
    expect(row).toEqual({ price_diff: "40.00", qty: 1, reason: "le quedaba chico" });
    const types = (await systemQuery("select type, qty from stock_movements where ref_id = $1 order by type", [exchangeId])).rows;
    expect(types).toEqual([
      { type: "exchange_in", qty: 1 },
      { type: "exchange_out", qty: -1 },
    ]);
  });

  it("ignores a price difference sent by a seller and computes it from the variants' prices", async () => {
    const v = await freshStock("100.00");
    const w = await freshStock("130.00");
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    // The seller claims a -9999 credit: the stored difference is list(new) - paid(old) = 30.
    const { rows } = await withUser(seller, (c) =>
      c.query("select create_exchange($1, $2, $3, 1, null, -9999, 'qr') as id", [saleId, v.variantId, w.variantId]),
    );
    const diff = (await systemQuery("select price_diff from exchanges where id = $1", [rows[0].id])).rows[0];
    expect(diff.price_diff).toBe("30.00");
  });

  it("lets the superadmin override the difference within bounds (credit up to what was paid, charge up to the new list price)", async () => {
    const v = await freshStock("100.00");
    const w = await freshStock("100.00");
    const create = (saleId: string, diff: number, qty = 1) =>
      withUser(admin, (c) =>
        c.query("select create_exchange($1, $2, $3, $4, null, $5, 'efectivo') as id", [saleId, v.variantId, w.variantId, qty, diff]),
      );
    const saleId = await sellOne(seller, branch, v.variantId, 3, "90.00", "270.00");
    const { rows } = await create(saleId, -10);
    expect((await systemQuery("select price_diff from exchanges where id = $1", [rows[0].id])).rows[0].price_diff).toBe("-10.00");
    // credit larger than the 90.00 paid for the returned unit
    await expectPgError(create(saleId, -90.01), "IN003");
    // charge larger than the new item's list price (100.00)
    await expectPgError(create(saleId, 100.01), "IN003");
    // bounds scale with the quantity
    const ok = await create(saleId, -180, 2);
    expect(ok.rows[0].id).toBeTruthy();
  });

  it("rejects unavailable stock, over-exchange, foreign items and other branches", async () => {
    const v = await freshStock();
    const empty = await createVariant();
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    const run = (s: SessionPayload, ret: string, nw: string, qty = 1) =>
      withUser(s, (c) => c.query("select create_exchange($1, $2, $3, $4, null, null)", [saleId, ret, nw, qty]));

    await expectPgError(run(seller, v.variantId, empty.variantId), "IN001");
    await expectPgError(run(seller, v.variantId, large.variantId, 2), "IN003");
    await expectPgError(run(seller, large.variantId, small.variantId), "IN005");
    await expectPgError(run(seller, v.variantId, v.variantId), "IN003");
    await expectPgError(run(otherSeller, v.variantId, large.variantId), "IN004");
    await expectPgError(run(seller, v.variantId, large.variantId, 0), "IN003");
  });

  it("cannot exchange a voided sale or exceed the sold quantity across exchanges", async () => {
    const v = await freshStock();
    const w = await freshStock();
    const saleId = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    const exchange = () =>
      withUser(seller, (c) => c.query("select create_exchange($1, $2, $3, 1, null, null)", [saleId, v.variantId, w.variantId]));
    await exchange();
    await expectPgError(exchange(), "IN003");

    const second = await sellOne(seller, branch, v.variantId, 1, "100.00", "100.00");
    await withUser(admin, (c) => c.query("select void_sale($1, 'motivo de prueba')", [second]));
    await expectPgError(
      withUser(seller, (c) => c.query("select create_exchange($1, $2, $3, 1, null, null)", [second, v.variantId, w.variantId])),
      "IN005",
    );
  });
});

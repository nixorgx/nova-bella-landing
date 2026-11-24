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
  rpcCreateSale,
  stockOf,
  type TestVariant,
} from "../helpers/fixtures";

let branch: string;
let seller: SessionPayload;
let admin: SessionPayload;
let variant: TestVariant;

beforeAll(async () => {
  branch = await createBranch();
  seller = await createUser("seller", branch);
  admin = await createUser("superadmin", null);
  variant = await createVariant();
  await addStock(variant.variantId, branch, 5);
});

describe("stock_movements is append-only", () => {
  it("blocks UPDATE even for the owner", async () => {
    await expectPgError(systemQuery("update stock_movements set qty = qty + 1"), "IN004");
  });

  it("blocks DELETE even for the owner", async () => {
    await expectPgError(systemQuery("delete from stock_movements"), "IN004");
  });

  it("blocks TRUNCATE", async () => {
    await expectPgError(systemQuery("truncate stock_movements"), "IN004");
  });

  it("blocks app roles at the privilege level too", async () => {
    await expectPgError(withUser(admin, (c) => c.query("update stock_movements set qty = 1")), "42501");
    await expectPgError(withUser(seller, (c) => c.query("delete from stock_movements")), "42501");
  });
});

describe("stock levels", () => {
  it("always equal the sum of the ledger", async () => {
    await addStock(variant.variantId, branch, 3);
    await systemQuery(
      "insert into stock_movements (variant_id, branch_id, qty, type) values ($1, $2, -2, 'adjust')",
      [variant.variantId, branch],
    );
    expect(await stockOf(variant.variantId, branch)).toBe(6);
    expect(await ledgerSum(variant.variantId, branch)).toBe(6);
  });

  it("can never go negative", async () => {
    const lonely = await createVariant();
    await expectPgError(
      systemQuery("insert into stock_movements (variant_id, branch_id, qty, type) values ($1, $2, -1, 'adjust')", [
        lonely.variantId,
        branch,
      ]),
      "IN001",
    );
    await addStock(lonely.variantId, branch, 2);
    await expectPgError(
      systemQuery("insert into stock_movements (variant_id, branch_id, qty, type) values ($1, $2, -3, 'adjust')", [
        lonely.variantId,
        branch,
      ]),
      "IN001",
    );
    expect(await stockOf(lonely.variantId, branch)).toBe(2);
  });

  it("two concurrent sales of the last unit: exactly one wins", async () => {
    const last = await createVariant();
    await addStock(last.variantId, branch, 1);
    const attempt = () =>
      withUser(seller, (c) =>
        rpcCreateSale(c, { branchId: branch }, [{ variantId: last.variantId, qty: 1, finalPrice: "50.00" }], [
          { method: "efectivo", amount: "50.00" },
        ]),
      );
    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as { code: string }).code).toBe("IN001");
    expect(await stockOf(last.variantId, branch)).toBe(0);
    expect(await ledgerSum(last.variantId, branch)).toBe(0);
  });
});

describe("adjust_stock and transfer_stock", () => {
  it("adjust requires a reason and superadmin", async () => {
    const call = (s: SessionPayload, note: string | null) =>
      withUser(s, (c) => c.query("select adjust_stock($1, $2, 2, $3)", [variant.variantId, branch, note]));
    await expectPgError(call(admin, null), "IN003");
    await expectPgError(call(seller, "motivo"), "42501");
    await call(admin, "conteo fisico");
  });

  it("adjust cannot push stock below zero", async () => {
    const v = await createVariant();
    await addStock(v.variantId, branch, 1);
    await expectPgError(
      withUser(admin, (c) => c.query("select adjust_stock($1, $2, -2, 'merma')", [v.variantId, branch])),
      "IN001",
    );
  });

  it("transfer moves stock with two movements and keeps totals", async () => {
    const other = await createBranch();
    const v = await createVariant();
    await addStock(v.variantId, branch, 5);
    await withUser(admin, (c) =>
      c.query("select transfer_stock($1, $2, $3, 3, 'reposicion')", [v.variantId, branch, other]),
    );
    expect(await stockOf(v.variantId, branch)).toBe(2);
    expect(await stockOf(v.variantId, other)).toBe(3);
    const { rows } = await systemQuery("select 1 from stock_movements where variant_id = $1 and type = 'transfer'", [
      v.variantId,
    ]);
    expect(rows).toHaveLength(2);
  });

  it("transfer rejects insufficient stock, same branch, inactive branch and sellers", async () => {
    const other = await createBranch();
    const inactive = await createBranch(false);
    const v = await createVariant();
    await addStock(v.variantId, branch, 1);
    const run = (s: SessionPayload, from: string, to: string, qty: number) =>
      withUser(s, (c) => c.query("select transfer_stock($1, $2, $3, $4, null)", [v.variantId, from, to, qty]));
    await expectPgError(run(admin, branch, other, 2), "IN001");
    await expectPgError(run(admin, branch, branch, 1), "IN003");
    await expectPgError(run(admin, branch, inactive, 1), "IN005");
    await expectPgError(run(seller, branch, other, 1), "42501");
    expect(await stockOf(v.variantId, branch)).toBe(1);
  });
});

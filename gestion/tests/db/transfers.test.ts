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
  stockOf,
} from "../helpers/fixtures";

let admin: SessionPayload;
let from: string;
let to: string;

beforeAll(async () => {
  admin = await createUser("superadmin", null);
  [from, to] = await Promise.all([createBranch(), createBranch()]);
});

const items = (...rows: [string, number][]) => JSON.stringify(rows.map(([variant_id, qty]) => ({ variant_id, qty })));

function transfer(session: SessionPayload, a: string, b: string, payload: string, note: string | null = null) {
  return withUser(session, async (c) => {
    const { rows } = await c.query<{ id: string }>("select create_stock_transfer($1, $2, $3::jsonb, $4) as id", [a, b, payload, note]);
    return rows[0].id;
  });
}

describe("create_stock_transfer", () => {
  it("moves several variants atomically and records one header with paired movements", async () => {
    const [v1, v2] = await Promise.all([createVariant(), createVariant()]);
    await addStock(v1.variantId, from, 5);
    await addStock(v2.variantId, from, 3);
    const id = await transfer(admin, from, to, items([v1.variantId, 2], [v2.variantId, 3]), "  reposición  ");

    expect(await stockOf(v1.variantId, from)).toBe(3);
    expect(await stockOf(v1.variantId, to)).toBe(2);
    expect(await stockOf(v2.variantId, from)).toBe(0);
    expect(await stockOf(v2.variantId, to)).toBe(3);
    const header = await systemQuery("select from_branch_id, to_branch_id, note, created_by from stock_transfers where id = $1", [id]);
    expect(header.rows[0]).toMatchObject({ from_branch_id: from, to_branch_id: to, note: "reposición", created_by: admin.userId });
    const moves = await systemQuery("select qty from stock_movements where ref_table = 'stock_transfers' and ref_id = $1", [id]);
    expect(moves.rows).toHaveLength(4);
    expect(moves.rows.reduce((sum, row) => sum + row.qty, 0)).toBe(0);
  });

  it("is all-or-nothing: one short variant rejects everything and names the SKU", async () => {
    const [ok, short] = await Promise.all([createVariant(), createVariant()]);
    await addStock(ok.variantId, from, 4);
    await addStock(short.variantId, from, 1);
    const error = await expectPgError(transfer(admin, from, to, items([ok.variantId, 2], [short.variantId, 5])), "IN001");
    expect(error.message).toContain(short.sku);
    expect(error.message).toContain("disponible 1");
    expect(await stockOf(ok.variantId, from)).toBe(4);
    expect(await stockOf(ok.variantId, to)).toBe(0);
  });

  it("validates the payload shape before touching stock", async () => {
    const v = await createVariant();
    await addStock(v.variantId, from, 5);
    await expectPgError(transfer(admin, from, to, "[]"), "IN003");
    await expectPgError(transfer(admin, from, to, '{"a":1}'), "IN003");
    await expectPgError(transfer(admin, from, to, items([v.variantId, 0])), "IN003");
    await expectPgError(transfer(admin, from, to, items([v.variantId, -1])), "IN003");
    await expectPgError(transfer(admin, from, to, JSON.stringify([{ variant_id: v.variantId, qty: "2" }])), "IN003");
    await expectPgError(transfer(admin, from, to, JSON.stringify([{ variant_id: "no-uuid", qty: 1 }])), "IN003");
    await expectPgError(transfer(admin, from, to, items([v.variantId, 1], [v.variantId, 1])), "IN003");
    await expectPgError(transfer(admin, from, from, items([v.variantId, 1])), "IN003");
    await expectPgError(transfer(admin, from, to, items([v.variantId, 1]), "x".repeat(301)), "IN003");
    expect(await stockOf(v.variantId, from)).toBe(5);
  });

  it("rejects unknown variants, inactive branches and non-superadmins", async () => {
    const v = await createVariant();
    await addStock(v.variantId, from, 2);
    const inactive = await createBranch(false);
    const seller = await createUser("seller", from);
    await expectPgError(transfer(admin, from, to, items(["00000000-0000-4000-8000-000000000000", 1])), "IN005");
    await expectPgError(transfer(admin, from, inactive, items([v.variantId, 1])), "IN005");
    await expectPgError(transfer(seller, from, to, items([v.variantId, 1])), "42501");
  });

  it("sellers cannot read the transfer history", async () => {
    const seller = await createUser("seller", from);
    await expectPgError(withUser(seller, (c) => c.query("select * from stock_transfers")), "42501");
  });

  it("the header is append-only", async () => {
    const v = await createVariant();
    await addStock(v.variantId, from, 1);
    const id = await transfer(admin, from, to, items([v.variantId, 1]));
    await expectPgError(systemQuery("update stock_transfers set note = 'x' where id = $1", [id]), "IN004");
    await expectPgError(systemQuery("delete from stock_transfers where id = $1", [id]), "IN004");
  });

  it("crossing transfers over the same variants do not deadlock and keep the ledger balanced", async () => {
    const [v1, v2] = await Promise.all([createVariant(), createVariant()]);
    for (const v of [v1, v2]) {
      await addStock(v.variantId, from, 10);
      await addStock(v.variantId, to, 10);
    }
    const jobs = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0
        ? transfer(admin, from, to, items([v1.variantId, 1], [v2.variantId, 1]))
        : transfer(admin, to, from, items([v2.variantId, 1], [v1.variantId, 1])),
    );
    await Promise.all(jobs);
    for (const v of [v1, v2]) {
      expect(await stockOf(v.variantId, from)).toBe(10);
      expect(await stockOf(v.variantId, to)).toBe(10);
      expect(await ledgerSum(v.variantId, from)).toBe(10);
    }
  });
});

describe("transfer_stock (single variant wrapper)", () => {
  it("keeps its rules and now leaves a header in the history", async () => {
    const v = await createVariant();
    await addStock(v.variantId, from, 4);
    const ref = await withUser(admin, async (c) => (await c.query<{ id: string }>("select transfer_stock($1, $2, $3, 3, 'uno') as id", [v.variantId, from, to])).rows[0].id);
    const header = await systemQuery("select note from stock_transfers where id = $1", [ref]);
    expect(header.rows[0].note).toBe("uno");
    await expectPgError(withUser(admin, (c) => c.query("select transfer_stock($1, $2, $3, 0)", [v.variantId, from, to])), "IN003");
    await expectPgError(withUser(admin, (c) => c.query("select transfer_stock($1, $2, $3, 9)", [v.variantId, from, to])), "IN001");
  });
});

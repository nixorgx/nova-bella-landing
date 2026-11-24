import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { signContext } from "@/lib/db-context";
import { getContextSecret } from "@/lib/env";
import { systemQuery, withSystem } from "../helpers/system";
import {
  addStock,
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  rpcCreateSale,
  sellOne,
  type TestVariant,
} from "../helpers/fixtures";

let branchA: string;
let branchB: string;
let admin: SessionPayload;
let sellerA: SessionPayload;
let sellerB: SessionPayload;
let variant: TestVariant;

beforeAll(async () => {
  [branchA, branchB] = await Promise.all([createBranch(), createBranch()]);
  [admin, sellerA, sellerB] = await Promise.all([
    createUser("superadmin", null),
    createUser("seller", branchA),
    createUser("seller", branchB),
  ]);
  variant = await createVariant("100.00");
  await addStock(variant.variantId, branchA, 10);
  await addStock(variant.variantId, branchB, 7);
  // a cost record exists for this variant
  await withUser(admin, (c) =>
    c.query(
      "select create_purchase_batch($1, 'Prov', current_date, 6.96, 10.5, 70, 0, null, $2::jsonb)",
      [branchA, JSON.stringify([{ variant_id: variant.variantId, qty: 1, unit_cost_usd: "10.00" }])],
    ),
  );
});

describe("cost data is invisible to sellers", () => {
  it.each(["purchase_items", "purchase_batches", "variant_costs", "exchange_rates"])(
    "seller cannot SELECT %s",
    async (table) => {
      await expectPgError(withUser(sellerA, (c) => c.query(`select * from ${table}`)), "42501");
    },
  );

  it("seller cannot read cost columns through catalog tables either", async () => {
    const { rows } = await withUser(sellerA, (c) =>
      c.query("select * from variants where id = $1", [variant.variantId]),
    );
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows[0]).some((key) => /cost/i.test(key))).toBe(false);
  });

  it("RLS alone still returns zero rows even if a grant were added by mistake", async () => {
    const rows = await withSystem(async (client) => {
      await client.query("grant select on variant_costs, purchase_items to app_seller");
      await client.query("set local role app_seller");
      await client.query("select set_config('app.ctx', $1, true)", [signContext(sellerA, getContextSecret())]);
      const costs = await client.query("select * from variant_costs");
      const items = await client.query("select * from purchase_items");
      await client.query("reset role");
      await client.query("revoke select on variant_costs, purchase_items from app_seller");
      return [costs.rowCount, items.rowCount];
    });
    expect(rows).toEqual([0, 0]);
  });

  it("superadmin can read costs", async () => {
    const { rows } = await withUser(admin, (c) =>
      c.query("select avg_cost_bs from variant_costs where variant_id = $1", [variant.variantId]),
    );
    expect(rows).toHaveLength(1);
  });

  it("seller cannot call cost RPCs", async () => {
    const call = withUser(sellerA, (c) =>
      c.query("select create_purchase_batch($1, null, null, 7, 9, 70, 0, null, '[]'::jsonb)", [branchA]),
    );
    await expectPgError(call, "42501");
  });
});

describe("branch isolation", () => {
  it("seller sees only own-branch stock", async () => {
    const own = await withUser(sellerA, (c) =>
      c.query("select branch_id, qty from stock_levels where variant_id = $1", [variant.variantId]),
    );
    expect(own.rows).toEqual([{ branch_id: branchA, qty: 11 }]);
    const other = await withUser(sellerB, (c) =>
      c.query("select qty from stock_levels where variant_id = $1", [variant.variantId]),
    );
    expect(other.rows).toEqual([{ qty: 7 }]);
  });

  it("seller sees only own-branch movements and sales", async () => {
    await sellOne(sellerB, branchB, variant.variantId, 1, "100.00", "100.00");
    const movements = await withUser(sellerA, (c) =>
      c.query("select distinct branch_id from stock_movements where variant_id = $1", [variant.variantId]),
    );
    expect(movements.rows).toEqual([{ branch_id: branchA }]);
    const sales = await withUser(sellerA, (c) => c.query("select branch_id from sales"));
    expect(sales.rows.every((row) => row.branch_id === branchA)).toBe(true);
  });

  it("superadmin sees every branch", async () => {
    const { rows } = await withUser(admin, (c) =>
      c.query("select branch_id from stock_levels where variant_id = $1 order by qty", [variant.variantId]),
    );
    expect(rows).toHaveLength(2);
  });

  it("seller cannot sell in another branch", async () => {
    const attempt = withUser(sellerA, (c) =>
      rpcCreateSale(c, { branchId: branchB }, [{ variantId: variant.variantId, qty: 1, finalPrice: "10.00" }], [
        { method: "efectivo", amount: "10.00" },
      ]),
    );
    await expectPgError(attempt, "IN004");
  });

  it("seller only sees own branch row", async () => {
    const { rows } = await withUser(sellerA, (c) => c.query("select id from branches"));
    expect(rows).toEqual([{ id: branchA }]);
  });
});

describe("users table", () => {
  it("seller reads only own row and never the password hash", async () => {
    const { rows } = await withUser(sellerA, (c) => c.query("select id, username from users"));
    expect(rows).toEqual([{ id: sellerA.userId, username: expect.any(String) }]);
    await expectPgError(withUser(sellerA, (c) => c.query("select password_hash from users")), "42501");
  });

  it("superadmin cannot read password hashes through the app role either", async () => {
    await expectPgError(withUser(admin, (c) => c.query("select password_hash from users")), "42501");
  });

  it("seller cannot create users or change roles", async () => {
    const insert = withUser(sellerA, (c) =>
      c.query("insert into users (username, full_name, password_hash, role) values ('hacker1','x','y','superadmin')"),
    );
    await expectPgError(insert, "42501");
    await expectPgError(withUser(sellerA, (c) => c.query("update users set role = 'superadmin'")), "42501");
  });
});

describe("direct writes are closed", () => {
  it("seller cannot insert stock movements or edit stock levels", async () => {
    await expectPgError(
      withUser(sellerA, (c) =>
        c.query("insert into stock_movements (variant_id, branch_id, qty, type) values ($1, $2, 5, 'adjust')", [
          variant.variantId,
          branchA,
        ]),
      ),
      "42501",
    );
    await expectPgError(withUser(sellerA, (c) => c.query("update stock_levels set qty = 999")), "42501");
  });

  it("seller cannot write catalog or sales directly", async () => {
    await expectPgError(withUser(sellerA, (c) => c.query("update models set base_sale_price = 1")), "42501");
    await expectPgError(withUser(sellerA, (c) => c.query("insert into sales (branch_id) values (null)")), "42501");
  });

  it("nobody can delete sales", async () => {
    await sellOne(sellerA, branchA, variant.variantId, 1, "100.00", "100.00");
    await expectPgError(withUser(admin, (c) => c.query("delete from sales")), "42501");
    await expectPgError(systemQuery("delete from sales"), "IN004");
  });
});

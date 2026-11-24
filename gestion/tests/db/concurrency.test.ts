import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { addStock, createBranch, createUser, createVariant, stockOf } from "../helpers/fixtures";
import { systemQuery, withSystem } from "../helpers/system";

let branchA: string;
let branchB: string;
let admin: SessionPayload;

beforeAll(async () => {
  [branchA, branchB] = await Promise.all([createBranch(), createBranch()]);
  admin = await createUser("superadmin", null);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function purchase(variantId: string, qty: number, usd: string, rate70 = "7", rate30 = "9") {
  const items = [{ variant_id: variantId, qty, unit_cost_usd: usd }];
  return withUser(admin, (c) =>
    c.query("select create_purchase_batch($1, 'Prov', current_date, $2, $3, 70, 0, null, $4::jsonb)", [
      branchA,
      rate70,
      rate30,
      JSON.stringify(items),
    ]),
  );
}

describe("create_purchase_batch concurrency", () => {
  it("a concurrent FIRST purchase of the same variant neither fails nor corrupts the average", async () => {
    const v = await createVariant();
    // Another transaction is in the middle of the variant's first purchase: cost row and
    // stock exist but are not committed yet.
    const blocker = withSystem(async (client) => {
      await client.query(
        "insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, 50.00, 50.00)",
        [v.variantId],
      );
      await client.query(
        "insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, 5, 'adjust', 'primera compra')",
        [v.variantId, branchA],
      );
      await sleep(600);
    });
    await sleep(150);
    // 10.00 USD at 7 / 9 => 76.00 Bs landed; arrives while the first purchase is still open.
    const second = purchase(v.variantId, 5, "10.00");
    await Promise.all([blocker, second]);

    const { rows } = await systemQuery("select last_cost_bs, avg_cost_bs from variant_costs where variant_id = $1", [v.variantId]);
    // (50.00 * 5 + 76.00 * 5) / 10
    expect(rows[0]).toEqual({ last_cost_bs: "76.00", avg_cost_bs: "63.00" });
    expect(await stockOf(v.variantId, branchA)).toBe(10);
  });

  it("parallel first purchases of one variant both succeed and weight the average by quantity", async () => {
    const v = await createVariant();
    // 10 USD * (0.7*7 + 0.3*9) = 76.00 ; 20 USD => 152.00
    await Promise.all([purchase(v.variantId, 4, "10.00"), purchase(v.variantId, 6, "20.00")]);
    const { rows } = await systemQuery("select avg_cost_bs from variant_costs where variant_id = $1", [v.variantId]);
    // (76 * 4 + 152 * 6) / 10 = 121.60
    expect(rows[0].avg_cost_bs).toBe("121.60");
    expect(await stockOf(v.variantId, branchA)).toBe(10);
  });

  it("many parallel purchases of the same variants (opposite item order) do not deadlock", async () => {
    const [a, b] = await Promise.all([createVariant(), createVariant()]);
    const batch = (first: typeof a, second: typeof a) =>
      withUser(admin, (c) =>
        c.query("select create_purchase_batch($1, 'P', current_date, 7, 9, 70, 0, null, $2::jsonb)", [
          branchA,
          JSON.stringify([
            { variant_id: first.variantId, qty: 1, unit_cost_usd: "10.00" },
            { variant_id: second.variantId, qty: 1, unit_cost_usd: "10.00" },
          ]),
        ]),
      );
    await Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 === 0 ? batch(a, b) : batch(b, a))));
    expect(await stockOf(a.variantId, branchA)).toBe(8);
    expect(await stockOf(b.variantId, branchA)).toBe(8);
  });
});

describe("transfer_stock concurrency", () => {
  it("opposing transfers of the same variant never deadlock and conserve stock", async () => {
    const v = await createVariant();
    await addStock(v.variantId, branchA, 100);
    await addStock(v.variantId, branchB, 100);
    const transfer = (from: string, to: string) =>
      withUser(admin, (c) => c.query("select transfer_stock($1, $2, $3, 1, null)", [v.variantId, from, to]));

    for (let round = 0; round < 12; round++) {
      const results = await Promise.allSettled([
        transfer(branchA, branchB),
        transfer(branchB, branchA),
        transfer(branchA, branchB),
        transfer(branchB, branchA),
      ]);
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures.map((f) => (f as PromiseRejectedResult).reason?.code)).toEqual([]);
    }
    expect((await stockOf(v.variantId, branchA)) + (await stockOf(v.variantId, branchB))).toBe(200);
  });
});

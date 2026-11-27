import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { calculateLandedCost } from "@/lib/costing";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import {
  createBranch,
  createUser,
  createVariant,
  expectPgError,
  ledgerSum,
  stockOf,
  type TestVariant,
} from "../helpers/fixtures";

let branch: string;
let admin: SessionPayload;

beforeAll(async () => {
  branch = await createBranch();
  admin = await createUser("superadmin", null);
});

interface BatchArgs {
  readonly rate70?: string;
  readonly rate30?: string;
  readonly split?: string;
  readonly freight?: string;
  readonly items: readonly { variant: TestVariant; qty: number; usd: string }[];
}

function createBatch(session: SessionPayload, args: BatchArgs): Promise<string> {
  const items = args.items.map((i) => ({ variant_id: i.variant.variantId, qty: i.qty, unit_cost_usd: i.usd }));
  return withUser(session, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "select create_purchase_batch($1, 'Proveedor', '2026-03-01', $2, $3, $4, $5, 'nota', $6::jsonb) as id",
      [branch, args.rate70 ?? "6.96", args.rate30 ?? "10.5", args.split ?? "70", args.freight ?? "0", JSON.stringify(items)],
    );
    return rows[0].id;
  });
}

describe("create_purchase_batch", () => {
  it("computes landed cost with the 70/30 split plus prorated freight and writes stock", async () => {
    const a = await createVariant();
    const b = await createVariant();
    const batchId = await createBatch(admin, {
      freight: "100",
      items: [
        { variant: a, qty: 10, usd: "10.00" },
        { variant: b, qty: 30, usd: "20.00" },
      ],
    });

    const items = (
      await systemQuery("select variant_id, qty, unit_cost_usd, unit_cost_bs_landed from purchase_items where batch_id = $1", [batchId])
    ).rows;
    expect(items.find((i) => i.variant_id === a.variantId)?.unit_cost_bs_landed).toBe("82.72");
    expect(items.find((i) => i.variant_id === b.variantId)?.unit_cost_bs_landed).toBe("162.94");

    expect(await stockOf(a.variantId, branch)).toBe(10);
    expect(await stockOf(b.variantId, branch)).toBe(30);
    expect(await ledgerSum(b.variantId, branch)).toBe(30);

    const batch = (await systemQuery("select * from purchase_batches where id = $1", [batchId])).rows[0];
    expect(batch).toMatchObject({ rate_70: "6.9600", rate_30: "10.5000", split_pct: "70.00", freight_bs: "100.00", created_by: admin.userId });

    const cost = (await systemQuery("select * from variant_costs where variant_id = $1", [a.variantId])).rows[0];
    expect(cost).toMatchObject({ last_cost_bs: "82.72", avg_cost_bs: "82.72" });
    const movement = (await systemQuery("select type, ref_table, ref_id from stock_movements where variant_id = $1", [a.variantId])).rows;
    expect(movement).toEqual([{ type: "purchase", ref_table: "purchase_batches", ref_id: batchId }]);
  });

  it("keeps last cost and a weighted average across batches (rates are snapshots)", async () => {
    const v = await createVariant();
    await createBatch(admin, { items: [{ variant: v, qty: 10, usd: "10.00" }] }); // 80.22
    await createBatch(admin, { rate70: "7", rate30: "9", items: [{ variant: v, qty: 10, usd: "10.00" }] }); // 76.00
    const cost = (await systemQuery("select * from variant_costs where variant_id = $1", [v.variantId])).rows[0];
    expect(cost.last_cost_bs).toBe("76.00");
    expect(cost.avg_cost_bs).toBe("78.11"); // (80.22*10 + 76*10) / 20
    const first = (await systemQuery("select unit_cost_bs_landed from purchase_items where variant_id = $1 order by unit_cost_bs_landed desc", [v.variantId])).rows;
    expect(first.map((r) => r.unit_cost_bs_landed)).toEqual(["80.22", "76.00"]);
    expect(await stockOf(v.variantId, branch)).toBe(20);
  });

  it("resets the average to the new cost when nothing is on hand", async () => {
    const v = await createVariant();
    await createBatch(admin, { items: [{ variant: v, qty: 1, usd: "10.00" }] });
    await systemQuery("insert into stock_movements (variant_id, branch_id, qty, type) values ($1, $2, -1, 'adjust')", [v.variantId, branch]);
    await createBatch(admin, { rate70: "7", rate30: "9", items: [{ variant: v, qty: 2, usd: "10.00" }] });
    const cost = (await systemQuery("select avg_cost_bs from variant_costs where variant_id = $1", [v.variantId])).rows[0];
    expect(cost.avg_cost_bs).toBe("76.00");
  });

  it("matches the pure TypeScript calculateLandedCost for many inputs", async () => {
    const cases = [
      { usd: "12.35", r70: "6.96", r30: "9.87", split: "70", freight: "37.5", units: 7 },
      { usd: "0.01", r70: "6.9600", r30: "10.0000", split: "33.33", freight: "1", units: 3 },
      { usd: "99.99", r70: "6.97", r30: "12.1234", split: "100", freight: "0", units: 1 },
      { usd: "45.00", r70: "7", r30: "7.01", split: "0", freight: "250.55", units: 11 },
      { usd: "8.50", r70: "0.125", r30: "0.125", split: "70", freight: "0", units: 1 },
    ];
    for (const k of cases) {
      const v = await createVariant();
      const batchId = await createBatch(admin, {
        rate70: k.r70,
        rate30: k.r30,
        split: k.split,
        freight: k.freight,
        items: [{ variant: v, qty: k.units, usd: k.usd }],
      });
      const row = (await systemQuery("select unit_cost_bs_landed from purchase_items where batch_id = $1", [batchId])).rows[0];
      const expected = calculateLandedCost({
        unitCostUsd: k.usd,
        rate70: k.r70,
        rate30: k.r30,
        splitPct: k.split,
        freightBs: k.freight,
        totalUnits: k.units,
      });
      expect(row.unit_cost_bs_landed).toBe(expected.toFixed(2));
    }
  });

  it("is forbidden for sellers", async () => {
    const seller = await createUser("seller", branch);
    const v = await createVariant();
    await expectPgError(createBatch(seller, { items: [{ variant: v, qty: 1, usd: "1.00" }] }), "42501");
  });

  it("validates its inputs and is atomic", async () => {
    const v = await createVariant();
    await expectPgError(createBatch(admin, { items: [] }), "IN003");
    await expectPgError(createBatch(admin, { items: [{ variant: v, qty: 0, usd: "1.00" }] }), "IN003");
    await expectPgError(createBatch(admin, { items: [{ variant: v, qty: 1, usd: "-1" }] }), "IN003");
    await expectPgError(createBatch(admin, { items: [{ variant: v, qty: 1, usd: "1.005" }] }), "IN003");
    await expectPgError(
      createBatch(admin, { items: [{ variant: v, qty: 1, usd: "1.00" }, { variant: v, qty: 1, usd: "1.00" }] }),
      "IN003",
    );
    await expectPgError(createBatch(admin, { rate70: "0", items: [{ variant: v, qty: 1, usd: "1.00" }] }), "IN003");
    await expectPgError(createBatch(admin, { split: "101", items: [{ variant: v, qty: 1, usd: "1.00" }] }), "IN003");
    await expectPgError(createBatch(admin, { freight: "-1", items: [{ variant: v, qty: 1, usd: "1.00" }] }), "IN003");
    const ghost = { variantId: "00000000-0000-4000-8000-000000000000", sku: "x", modelId: "x" };
    await expectPgError(createBatch(admin, { items: [{ variant: ghost, qty: 1, usd: "1.00" }] }), "IN005");
    expect(await stockOf(v.variantId, branch)).toBe(0);
    expect((await systemQuery("select 1 from variant_costs where variant_id = $1", [v.variantId])).rowCount).toBe(0);
  });
});

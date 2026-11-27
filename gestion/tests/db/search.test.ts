import { beforeAll, describe, expect, it } from "vitest";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { systemQuery } from "../helpers/system";
import { resolveScan, searchVariants } from "@/features/catalog/search";
import { addStock, createBranch, createUser } from "../helpers/fixtures";
import { makeColor, makeLine, makeModel, makeSize, makeVariantRow, tag } from "../helpers/catalog";

const T = tag();
let branchA: string;
let branchB: string;
let admin: SessionPayload;
let seller: SessionPayload;
let alba38: string;
let alba39: string;
let urbano: string;
let inactive: string;
const barcode = `775${T}`;

beforeAll(async () => {
  branchA = await createBranch();
  branchB = await createBranch();
  admin = await createUser("superadmin", null);
  seller = await createUser("seller", branchA);

  const line = await makeLine(`Dama ${T}`);
  const alba = await makeModel(line, `Alba${T}`, "189.00");
  const urbanoModel = await makeModel(line, `Urbano${T}`, "349.00");
  const retired = await makeModel(line, `Retirado${T}`, "99.00", false);
  const negro = await makeColor(`Café${T}`);
  const rojo = await makeColor(`Rojo${T}`);
  const s38 = await makeSize(`38${T}`, 38);
  const s39 = await makeSize(`39${T}`, 39);

  alba38 = await makeVariantRow(alba, negro, s38, `DAM-ALBA${T}-CAFE-38`, barcode);
  alba39 = await makeVariantRow(alba, rojo, s39, `DAM-ALBA${T}-ROJO-39`);
  urbano = await makeVariantRow(urbanoModel, rojo, s38, `DAM-URB${T}-ROJO-38`);
  inactive = await makeVariantRow(alba, rojo, s38, `DAM-ALBA${T}-ROJO-38-OFF`, null, false);
  await makeVariantRow(retired, rojo, s39, `DAM-RET${T}-ROJO-39`);

  await addStock(alba38, branchA, 4);
  await addStock(alba38, branchB, 10);

  // cost data exists in the database; it must never reach search results
  await withUser(admin, (c) =>
    c.query(
      "select create_purchase_batch($1, 'Prov', current_date, 6.96, 10.5, 70, 0, 'n', $2::jsonb)",
      [branchA, JSON.stringify([{ variant_id: alba39, qty: 3, unit_cost_usd: "12.00" }])],
    ),
  );
});

const ids = (hits: { variantId: string }[]) => hits.map((hit) => hit.variantId);

describe("searchVariants", () => {
  it("finds by sku, barcode, model, color (accent-insensitive) and size", async () => {
    expect(ids(await searchVariants(admin, { query: `DAM-ALBA${T}-CAFE-38` }))).toEqual([alba38]);
    expect(ids(await searchVariants(admin, { query: barcode }))).toEqual([alba38]);
    expect(ids(await searchVariants(admin, { query: `urbano${T}` }))).toEqual([urbano]);
    expect(ids(await searchVariants(admin, { query: `cafe${T}` }))).toEqual([alba38]);
    expect(ids(await searchVariants(admin, { query: `39${T}` }))).toEqual([alba39]);
  });

  it("requires every token to match somewhere", async () => {
    const hits = await searchVariants(admin, { query: `alba${T} rojo${T}` });
    expect(ids(hits)).toEqual([alba39]);
    expect(await searchVariants(admin, { query: `alba${T} nada` })).toEqual([]);
  });

  it("ranks an exact SKU first", async () => {
    const hits = await searchVariants(admin, { query: `DAM-ALBA${T}-ROJO-39`.toLowerCase() });
    expect(hits[0].variantId).toBe(alba39);
  });

  it("treats % and _ literally", async () => {
    expect(await searchVariants(admin, { query: "%" })).toEqual([]);
    expect(await searchVariants(admin, { query: `_lba${T}` })).toEqual([]);
  });

  it("respects the limit", async () => {
    expect(await searchVariants(admin, { query: `${T}`, limit: 2 })).toHaveLength(2);
  });

  it("hides inactive variants and models unless a superadmin asks", async () => {
    const hidden = ids(await searchVariants(admin, { query: T }));
    expect(hidden).not.toContain(inactive);
    const all = await searchVariants(admin, { query: T, includeInactive: true });
    expect(ids(all)).toContain(inactive);
    expect(all.some((hit) => hit.modelActive === false)).toBe(true);
  });
});

describe("role isolation", () => {
  it("seller results carry price and own-branch stock only, with no cost keys", async () => {
    const hits = await searchVariants(seller, { query: `DAM-ALBA${T}-CAFE-38` });
    expect(hits).toHaveLength(1);
    expect(hits[0].stock).toBe(4);
    expect(hits[0].price).toBe("189.00");
    expect(Object.keys(hits[0]).sort()).toEqual(
      [
        "active", "barcode", "color", "colorHex", "line", "model", "modelActive",
        "modelId", "price", "size", "sku", "stock", "variantId",
      ].sort(),
    );
    expect(JSON.stringify(hits).toLowerCase()).not.toMatch(/cost|landed|usd/);
  });

  it("a seller cannot see inactive items even when asking for them", async () => {
    const hits = await searchVariants(seller, { query: T, includeInactive: true });
    expect(ids(hits)).not.toContain(inactive);
    expect(hits.every((hit) => hit.active && hit.modelActive)).toBe(true);
  });

  it("a seller cannot choose another branch's stock", async () => {
    const hits = await searchVariants(seller, { query: `DAM-ALBA${T}-CAFE-38`, branchId: branchB });
    expect(hits[0].stock).toBe(4);
  });

  it("superadmin sums every branch unless a branch is given", async () => {
    expect((await searchVariants(admin, { query: barcode }))[0].stock).toBe(14);
    expect((await searchVariants(admin, { query: barcode, branchId: branchB }))[0].stock).toBe(10);
  });

  it("sellers really cannot read cost tables (defence in depth)", async () => {
    await expect(withUser(seller, (c) => c.query("select * from variant_costs"))).rejects.toMatchObject({ code: "42501" });
    const { rowCount } = await systemQuery("select 1 from variant_costs where variant_id = $1", [alba39]);
    expect(rowCount).toBe(1);
  });
});

describe("resolveScan", () => {
  it("resolves a barcode or a sku, case-insensitively", async () => {
    expect((await resolveScan(seller, barcode))?.variantId).toBe(alba38);
    expect((await resolveScan(seller, `dam-urb${T}-rojo-38`.toLowerCase()))?.variantId).toBe(urbano);
    expect((await resolveScan(admin, `  ${barcode}\r\n`))?.variantId).toBe(alba38);
  });

  it("returns null for unknown or empty codes and hides inactive from sellers", async () => {
    expect(await resolveScan(seller, "0000000000")).toBeNull();
    expect(await resolveScan(seller, "  ")).toBeNull();
    expect(await resolveScan(seller, `DAM-ALBA${T}-ROJO-38-OFF`)).toBeNull();
    expect((await resolveScan(admin, `DAM-ALBA${T}-ROJO-38-OFF`))?.variantId).toBe(inactive);
  });
});

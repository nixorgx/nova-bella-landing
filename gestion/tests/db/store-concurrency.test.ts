import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { publicQuery, withUser } from "@/lib/db";
import { addStock } from "../helpers/fixtures";
import { createShop, newToken, orderPayload, type Shop } from "../helpers/store";
import { systemQuery } from "../helpers/system";

/*
 * Real connections, committed data. The two global settings (open + web branch) are pointed at this file's shop
 * for the duration; the rolled-back scenarios of other files override them inside their own transaction.
 */
let shop: Shop;
let previous: { open: string | null; branch: string | null };

beforeAll(async () => {
  shop = await createShop({ price: "80.00", stock: 1, fee: "5.00" });
  const { rows } = await systemQuery<{ key: string; value: string | null }>("select key, value from app_settings where key in ('store_open', 'store_branch_id')");
  previous = { open: rows.find((r) => r.key === "store_open")?.value ?? "false", branch: rows.find((r) => r.key === "store_branch_id")?.value ?? null };
  await systemQuery("update app_settings set value = 'true' where key = 'store_open'");
  await systemQuery("update app_settings set value = $1 where key = 'store_branch_id'", [shop.branchId]);
});

afterAll(async () => {
  await systemQuery("update app_settings set value = $1 where key = 'store_open'", [previous.open]);
  await systemQuery("update app_settings set value = $1 where key = 'store_branch_id'", [previous.branch]);
});

async function place(): Promise<string> {
  const { hash } = newToken();
  const payload = orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId });
  const { rows } = await publicQuery<{ order_code: string }>("select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), hash]);
  const order = await systemQuery<{ id: string }>("select id from web_orders where code = $1", [rows[0].order_code]);
  return order.rows[0].id;
}

const confirm = (id: string) => withUser(shop.admin, (c) => c.query<{ id: string }>("select web_order_confirm($1) as id", [id]));

describe("concurrent confirmations", () => {
  it("two simultaneous clicks on the same order create exactly one sale", async () => {
    await addStock(shop.variant.variantId, shop.branchId, 4);
    const id = await place();
    const results = await Promise.allSettled([confirm(id), confirm(id), confirm(id)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const ids = new Set(results.map((r) => (r as PromiseFulfilledResult<{ rows: { id: string }[] }>).value.rows[0].id));
    expect(ids.size).toBe(1);
    const sales = await systemQuery<{ n: number }>("select count(*)::int as n from sales s join web_orders o on o.sale_id = s.id where o.id = $1", [id]);
    expect(sales.rows[0].n).toBe(1);
  });

  it("two orders racing for the last unit: one confirms, the other fails cleanly; stock never goes negative", async () => {
    const level = await systemQuery<{ qty: number }>("select qty from stock_levels where variant_id = $1 and branch_id = $2", [shop.variant.variantId, shop.branchId]);
    // leave exactly one unit
    await systemQuery("insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, $3, 'adjust', 'test')", [shop.variant.variantId, shop.branchId, 1 - level.rows[0].qty]);
    const [a, b] = [await place(), await place()];
    const results = await Promise.allSettled([confirm(a), confirm(b)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((failed.reason as { code?: string }).code).toBe("IN001");
    const after = await systemQuery<{ qty: number }>("select qty from stock_levels where variant_id = $1 and branch_id = $2", [shop.variant.variantId, shop.branchId]);
    expect(after.rows[0].qty).toBe(0);
    const orders = await systemQuery<{ status: string }>("select status from web_orders where id = any($1) order by status", [[a, b]]);
    expect(orders.rows.map((r) => r.status).sort()).toEqual(["confirmado", "pendiente_pago"]);
  });

  it("parallel checkouts with the same idempotency key produce one order", async () => {
    await addStock(shop.variant.variantId, shop.branchId, 3);
    const payload = orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId });
    const calls = Array.from({ length: 4 }, () => publicQuery<{ order_code: string; was_created: boolean }>("select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), newToken().hash]));
    const results = await Promise.all(calls);
    expect(new Set(results.map((r) => r.rows[0].order_code)).size).toBe(1);
    expect(results.filter((r) => r.rows[0].was_created)).toHaveLength(1);
  });
});

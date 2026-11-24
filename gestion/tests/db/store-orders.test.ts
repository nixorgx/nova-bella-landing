import { beforeAll, describe, expect, it } from "vitest";
import { expectPgError } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";
import { createShop, newKey, newToken, orderPayload, scenario, tinyWebp, type Shop } from "../helpers/store";

let shop: Shop;
beforeAll(async () => {
  shop = await createShop({ price: "120.00", stock: 5, fee: "15.00" });
});

const create = (s: Awaited<Parameters<Parameters<typeof scenario>[1]>[0]>, payload: Record<string, unknown>, hash = newToken().hash) =>
  s.as<{ order_code: string; order_status: string; was_created: boolean }>("public", "select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), hash]);

describe("public_create_order: the server decides price, fee and availability", () => {
  it("creates a pending order with prices and delivery fee taken from the database", async () => {
    await scenario(shop, async (s) => {
      const payload = orderPayload({ variantId: shop.variant.variantId, qty: 2, zoneId: shop.zoneId, extra: { items: [{ variant_id: shop.variant.variantId, qty: 2, unit_price: "1.00", price: 1 }], total: "1.00" } });
      const { rows } = await create(s, payload);
      expect(rows[0]).toMatchObject({ order_status: "pendiente_pago", was_created: true });
      expect(rows[0].order_code).toMatch(/^NB-[A-Z2-9]{6}$/);
      const order = await s.as("owner", "select subtotal, delivery_fee, total, status, branch_id from web_orders where code = $1", [rows[0].order_code]);
      expect(order.rows[0]).toMatchObject({ subtotal: "240.00", delivery_fee: "15.00", total: "255.00", status: "pendiente_pago", branch_id: shop.branchId });
      const items = await s.as("owner", "select unit_price, qty from web_order_items where order_id = (select id from web_orders where code = $1)", [rows[0].order_code]);
      expect(items.rows).toEqual([{ unit_price: "120.00", qty: 2 }]);
    });
  });

  it("pickup orders are free and need an active pickup point", async () => {
    await scenario(shop, async (s) => {
      const ok = await create(s, orderPayload({ variantId: shop.variant.variantId, fulfillment: "pickup", pickupId: shop.pickupId }));
      const row = await s.as("owner", "select delivery_fee, total, delivery_address from web_orders where code = $1", [ok.rows[0].order_code]);
      expect(row.rows[0]).toEqual({ delivery_fee: "0.00", total: "120.00", delivery_address: null });
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, fulfillment: "pickup", pickupId: "" })), "IN003");
    });
  });

  it("is idempotent: the same key returns the same order, never a duplicate", async () => {
    await scenario(shop, async (s) => {
      const key = newKey();
      const payload = orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, key });
      const first = await create(s, payload);
      const second = await create(s, payload, newToken().hash);
      expect(second.rows[0]).toMatchObject({ order_code: first.rows[0].order_code, was_created: false });
      const count = await s.as<{ n: number }>("owner", "select count(*)::int as n from web_orders where idempotency_key = $1", [key]);
      expect(count.rows[0].n).toBe(1);
    });
  });

  it("refuses a closed store, missing stock, bad input and products that are not published", async () => {
    await scenario(shop, async (s) => {
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, qty: 6, zoneId: shop.zoneId })), "IN001");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, phone: "1234" })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { key: undefined, idempotency_key: "short" } })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { items: [{ variant_id: shop.variant.variantId, qty: 11 }] } })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { items: [] } })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { payment_method: "tarjeta" } })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { wants_invoice: "true" } })), "IN003");
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, extra: { items: [{ variant_id: "00000000-0000-4000-8000-000000000000", qty: 1 }] } })), "IN005");
      await s.as("owner", "update models set published_online = false where id = $1", [shop.variant.modelId]);
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId })), "IN005");
    });
    await scenario(shop, async (s) => {
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId })), "IN005");
    }, { open: false });
  });

  it("limits unpaid orders per phone (anti spam)", async () => {
    await scenario(shop, async (s) => {
      const phone = "71234500";
      for (let i = 0; i < 5; i++) await create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, phone }));
      await expectPgError(create(s, orderPayload({ variantId: shop.variant.variantId, zoneId: shop.zoneId, phone })), "IN003");
    });
  });
});

describe("order tokens and the public view", () => {
  it("stores only the SHA-256 and finds the order only with the exact token", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      const view = await s.as<{ v: { code: string; total: number; items: unknown[]; status: string } }>("public", "select public_order_view($1) as v", [order.hash]);
      expect(view.rows[0].v).toMatchObject({ code: order.code, status: "pendiente_pago" });
      const other = newToken();
      const miss = await s.as("public", "select public_order_view($1) as v", [other.hash]);
      expect(miss.rows[0].v).toBeNull();
      const bad = await s.as("public", "select public_order_view($1) as v", [Buffer.from("short")]);
      expect(bad.rows[0].v).toBeNull();
      const stored = await s.as<{ token_hash: Buffer }>("owner", "select token_hash from web_orders where code = $1", [order.code]);
      expect(stored.rows[0].token_hash.equals(order.hash)).toBe(true);
      expect(stored.rows[0].token_hash.toString("utf8")).not.toContain(order.token);
    });
  });

  it("the public view never exposes ids, cost, margin or other buyers' data", async () => {
    await scenario(shop, async (s) => {
      await s.createOrder(shop, { qty: 1 });
      const mine = await s.createOrder(shop, { qty: 1 });
      const { rows } = await s.as<{ v: unknown }>("public", "select public_order_view($1) as v", [mine.hash]);
      const text = JSON.stringify(rows[0].v);
      expect(text).not.toMatch(/cost|margin|margen|utilidad|supplier|proveedor|exchange_rate|landed|token|password|sale_id|branch_id|"id"/i);
    });
  });
});

describe("payment proofs (buyer side)", () => {
  it("moves a QR order to pago_en_revision, accepts up to 3 images and rejects non-WebP bytes", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      const png = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n"), Buffer.alloc(200, 1)]);
      await expectPgError(s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, png, "a".repeat(40)]), "23514");
      await expectPgError(s.as("public", "select public_order_attach_proof($1, null, null, null)", [order.hash]), "IN003");
      const webp = await tinyWebp();
      const first = await s.as<{ st: string }>("public", "select public_order_attach_proof($1, $2, $3, '123456') as st", [order.hash, webp, "b".repeat(40)]);
      expect(first.rows[0].st).toBe("pago_en_revision");
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, webp, "c".repeat(40)]);
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, webp, "d".repeat(40)]);
      await expectPgError(s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, webp, "e".repeat(40)]), "IN003");
      const row = await s.as("owner", "select status, proof_count, payment_reference from web_orders where code = $1", [order.code]);
      expect(row.rows[0]).toEqual({ status: "pago_en_revision", proof_count: 3, payment_reference: "123456" });
    });
  });

  it("a proof only attaches to the order whose token is presented", async () => {
    await scenario(shop, async (s) => {
      const a = await s.createOrder(shop, { qty: 1 });
      const b = await s.createOrder(shop, { qty: 1 });
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [a.hash, await tinyWebp(), "f".repeat(40)]);
      const rows = await s.as("owner", "select code, proof_count from web_orders where code = any($1) order by code", [[a.code, b.code]]);
      expect(Object.fromEntries(rows.rows.map((r) => [r.code, r.proof_count]))).toEqual({ [a.code]: 1, [b.code]: 0 });
      await expectPgError(s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [newToken().hash, await tinyWebp(), "f".repeat(40)]), "IN005");
    });
  });

  it("cash-on-delivery orders do not take proofs; the buyer can cancel only while unpaid", async () => {
    await scenario(shop, async (s) => {
      const cod = await s.createOrder(shop, { qty: 1, payment: "contra_entrega" });
      await expectPgError(s.as("public", "select public_order_attach_proof($1, $2, $3, 'x')", [cod.hash, await tinyWebp(), "a".repeat(40)]), "IN005");
      const qr = await s.createOrder(shop, { qty: 1 });
      const cancelled = await s.as<{ st: string }>("public", "select public_order_cancel($1) as st", [qr.hash]);
      expect(cancelled.rows[0].st).toBe("cancelado");
      const again = await s.as<{ st: string }>("public", "select public_order_cancel($1) as st", [qr.hash]);
      expect(again.rows[0].st).toBe("cancelado");
      const reviewed = await s.createOrder(shop, { qty: 1 });
      await s.as("public", "select public_order_attach_proof($1, null, null, 'ref-1')", [reviewed.hash]);
      await expectPgError(s.as("public", "select public_order_cancel($1)", [reviewed.hash]), "IN005");
    });
  });

  it("serves the payment QR only for a QR order token", async () => {
    await scenario(shop, async (s) => {
      await s.as("owner", "insert into store_assets (key, bytes, etag) values ('payment_qr', $1, $2) on conflict (key) do update set bytes = excluded.bytes", [await tinyWebp(), "a".repeat(40)]);
      const qr = await s.createOrder(shop, { qty: 1 });
      const cod = await s.createOrder(shop, { qty: 1, payment: "contra_entrega" });
      expect((await s.as("public", "select * from public_payment_qr($1)", [qr.hash])).rows).toHaveLength(1);
      expect((await s.as("public", "select * from public_payment_qr($1)", [cod.hash])).rows).toHaveLength(0);
      expect((await s.as("public", "select * from public_payment_qr($1)", [newToken().hash])).rows).toHaveLength(0);
    });
  });
});

describe("database throttle for public endpoints", () => {
  it("allows the configured attempts and then reports a wait time", async () => {
    const key = `test-${newKey()}`;
    for (let i = 0; i < 3; i++) {
      const { rows } = await systemQuery<{ allowed: boolean }>("select * from public_reserve_attempt($1, 3, 60)", [key]);
      expect(rows[0].allowed).toBe(true);
    }
    const blocked = await systemQuery<{ allowed: boolean; retry_after_seconds: number }>("select * from public_reserve_attempt($1, 3, 60)", [key]);
    expect(blocked.rows[0].allowed).toBe(false);
    expect(blocked.rows[0].retry_after_seconds).toBeGreaterThan(0);
    const other = await systemQuery<{ allowed: boolean }>("select * from public_reserve_attempt($1, 3, 60)", [`${key}-other`]);
    expect(other.rows[0].allowed).toBe(true);
  });
});

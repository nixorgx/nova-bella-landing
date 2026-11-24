import { beforeAll, describe, expect, it } from "vitest";
import { expectPgError } from "../helpers/fixtures";
import { createShop, scenario, tinyWebp, type Scenario, type Shop } from "../helpers/store";

let shop: Shop;
const admin = () => shop.admin;
const stock = async (s: Scenario, shopRef: Shop) =>
  (await s.as("owner", "select qty from stock_levels where variant_id = $1 and branch_id = $2", [shopRef.variant.variantId, shopRef.branchId])).rows[0].qty as number;

beforeAll(async () => {
  shop = await createShop({ price: "100.00", stock: 6, fee: "10.00" });
});

describe("web_order_confirm: payment confirmation creates the sale atomically", () => {
  it("creates a channel=web sale, takes the stock, upserts the customer and records the payment method", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 2, payment: "qr", extra: { wants_invoice: "true", invoice_nit: "1234567", invoice_name: "Mi Razon SRL" } });
      const before = await stock(s, shop);
      const confirmed = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      const saleId = confirmed.rows[0].id;
      const sale = await s.as("owner", "select channel, status, total, doc_type, cash_session_id, branch_id, seller_id, customer_id from sales where id = $1", [saleId]);
      expect(sale.rows[0]).toMatchObject({ channel: "web", status: "completed", total: "200.00", doc_type: "factura", cash_session_id: null, branch_id: shop.branchId, seller_id: shop.admin.userId });
      expect(await stock(s, shop)).toBe(before - 2);
      const pay = await s.as("owner", "select method, amount from sale_payments where sale_id = $1", [saleId]);
      expect(pay.rows).toEqual([{ method: "qr", amount: "200.00" }]);
      const items = await s.as("owner", "select qty, list_price, final_price from sale_items where sale_id = $1", [saleId]);
      expect(items.rows).toEqual([{ qty: 2, list_price: "100.00", final_price: "100.00" }]);
      const moves = await s.as("owner", "select qty, type, ref_table from stock_movements where ref_id = $1", [saleId]);
      expect(moves.rows).toEqual([{ qty: -2, type: "sale", ref_table: "sales" }]);
      const customer = await s.as("owner", "select name, phone from customers where id = $1", [sale.rows[0].customer_id]);
      expect(customer.rows[0].name).toBe("Cliente de prueba");
      const row = await s.as("owner", "select status, sale_id, confirmed_by from web_orders where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "confirmado", sale_id: saleId, confirmed_by: shop.admin.userId });
    });
  });

  it("is idempotent: confirming twice returns the same sale and takes the stock once", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      const before = await stock(s, shop);
      const a = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      const b = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      expect(b.rows[0].id).toBe(a.rows[0].id);
      expect(await stock(s, shop)).toBe(before - 1);
      const sales = await s.as<{ n: number }>("owner", "select count(*)::int as n from sales where id = $1", [a.rows[0].id]);
      expect(sales.rows[0].n).toBe(1);
    });
  });

  it("fails cleanly when the stock is gone: clear message, no sale, no negative stock, order untouched", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 3 });
      await s.as("owner", "insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, $3, 'adjust', 'agotado en tienda')", [shop.variant.variantId, shop.branchId, -(await stock(s, shop)) + 1]);
      const before = await stock(s, shop);
      expect(before).toBe(1);
      const error = await expectPgError(s.as(admin(), "select web_order_confirm($1)", [order.id]), "IN001");
      expect(error.message).toMatch(/Ya no hay stock suficiente.*no se confirm/);
      expect(await stock(s, shop)).toBe(1);
      const row = await s.as("owner", "select status, sale_id from web_orders where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "pendiente_pago", sale_id: null });
    });
  });

  it("only the superadmin confirms: sellers and the public role are refused", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      // sellers have no EXECUTE on these functions at all (and the function would refuse them anyway)
      await expectPgError(s.as(shop.seller, "select web_order_confirm($1)", [order.id]), "42501");
      await expectPgError(s.as("public", "select web_order_confirm($1)", [order.id]), "42501");
      await expectPgError(s.as(shop.seller, "select web_order_cancel($1, 'no corresponde')", [order.id]), "42501");
      await expectPgError(s.as(shop.seller, "select web_order_reject_proof($1, 'no corresponde')", [order.id]), "42501");
    });
  });

  it("rejecting a proof sends the order back to pending with the reason; the buyer can send another", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      await expectPgError(s.as(admin(), "select web_order_reject_proof($1, 'monto distinto')", [order.id]), "IN005");
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, await tinyWebp(), "a".repeat(40)]);
      await expectPgError(s.as(admin(), "select web_order_reject_proof($1, 'no')", [order.id]), "IN003");
      await s.as(admin(), "select web_order_reject_proof($1, 'El monto no coincide')", [order.id]);
      const view = await s.as<{ v: { status: string; reject_reason: string } }>("public", "select public_order_view($1) as v", [order.hash]);
      expect(view.rows[0].v).toMatchObject({ status: "pendiente_pago", reject_reason: "El monto no coincide" });
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, await tinyWebp(), "b".repeat(40)]);
      const again = await s.as<{ v: { status: string; reject_reason: string | null } }>("public", "select public_order_view($1) as v", [order.hash]);
      expect(again.rows[0].v).toMatchObject({ status: "pago_en_revision", reject_reason: null });
    });
  });

  it("reuses the existing customer found by phone (any stored format)", async () => {
    await scenario(shop, async (s) => {
      await s.as("owner", "insert into customers (name, phone) values ('Clienta Vieja', '(591) 7123-4599')");
      const order = await s.createOrder(shop, { qty: 1, phone: "71234599" });
      const sale = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      const used = await s.as("owner", "select c.name from sales s join customers c on c.id = s.customer_id where s.id = $1", [sale.rows[0].id]);
      expect(used.rows[0].name).toBe("Clienta Vieja");
    });
  });
});

describe("fulfilment steps", () => {
  it("walks delivery and pickup orders through their own steps; the seller can do them for their branch only", async () => {
    await scenario(shop, async (s) => {
      const delivery = await s.createOrder(shop, { qty: 1 });
      const pickup = await s.createOrder(shop, { qty: 1, fulfillment: "pickup" });
      await expectPgError(s.as(shop.seller, "select web_order_set_status($1, 'en_camino')", [delivery.id]), "IN005"); // not confirmed yet
      await s.as(admin(), "select web_order_confirm($1)", [delivery.id]);
      await s.as(admin(), "select web_order_confirm($1)", [pickup.id]);
      await expectPgError(s.as(shop.seller, "select web_order_set_status($1, 'listo_para_recoger')", [delivery.id]), "IN005");
      await expectPgError(s.as(shop.seller, "select web_order_set_status($1, 'en_camino')", [pickup.id]), "IN005");
      await expectPgError(s.as(shop.otherSeller, "select web_order_set_status($1, 'en_camino')", [delivery.id]), "IN004");
      await expectPgError(s.as(shop.seller, "select web_order_set_status($1, 'cancelado')", [delivery.id]), "IN003");
      await s.as(shop.seller, "select web_order_set_status($1, 'en_camino')", [delivery.id]);
      await s.as(shop.seller, "select web_order_set_status($1, 'en_camino')", [delivery.id]); // double click: no error
      await s.as(shop.seller, "select web_order_set_status($1, 'entregado')", [delivery.id]);
      await s.as(shop.seller, "select web_order_set_status($1, 'listo_para_recoger')", [pickup.id]);
      await s.as(admin(), "select web_order_set_status($1, 'entregado')", [pickup.id]);
      const rows = await s.as("owner", "select status, shipped_at is not null as shipped, delivered_at is not null as delivered from web_orders where id = any($1) order by code", [[delivery.id, pickup.id]]);
      expect(rows.rows.every((r) => r.status === "entregado" && r.shipped && r.delivered)).toBe(true);
    });
  });

  it("cash on delivery: the sale starts as cash and the real collection method is registered on delivery", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1, payment: "contra_entrega" });
      const sale = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      const pay = await s.as("owner", "select method from sale_payments where sale_id = $1", [sale.rows[0].id]);
      expect(pay.rows[0].method).toBe("efectivo");
      await s.as(shop.seller, "select web_order_set_status($1, 'en_camino')", [order.id]);
      await expectPgError(s.as(shop.seller, "select web_order_set_status($1, 'entregado')", [order.id]), "IN003");
      await s.as(shop.seller, "select web_order_set_status($1, 'entregado', 'qr')", [order.id]);
      const after = await s.as("owner", "select p.method, o.collected_method from sale_payments p join web_orders o on o.sale_id = p.sale_id where p.sale_id = $1", [sale.rows[0].id]);
      expect(after.rows[0]).toEqual({ method: "qr", collected_method: "qr" });
    });
  });
});

describe("cancellation", () => {
  it("cancelling a confirmed order voids the sale and returns the stock; a delivered one cannot be cancelled", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 2 });
      const before = await stock(s, shop);
      const sale = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      expect(await stock(s, shop)).toBe(before - 2);
      await expectPgError(s.as(admin(), "select web_order_cancel($1, 'x')", [order.id]), "IN003");
      await s.as(admin(), "select web_order_cancel($1, 'El cliente ya no lo quiere')", [order.id]);
      expect(await stock(s, shop)).toBe(before);
      const rows = await s.as("owner", "select o.status, o.cancel_reason, s.status as sale_status from web_orders o join sales s on s.id = o.sale_id where o.id = $1", [order.id]);
      expect(rows.rows[0]).toEqual({ status: "cancelado", cancel_reason: "El cliente ya no lo quiere", sale_status: "voided" });
      expect(sale.rows[0].id).toBeTruthy();
      await s.as(admin(), "select web_order_cancel($1, 'otra vez, doble clic')", [order.id]); // idempotent
      const done = await s.createOrder(shop, { qty: 1 });
      await s.as(admin(), "select web_order_confirm($1)", [done.id]);
      await s.as(admin(), "select web_order_set_status($1, 'entregado')", [done.id]);
      await expectPgError(s.as(admin(), "select web_order_cancel($1, 'ya entregado')", [done.id]), "IN005");
    });
  });

  it("cancelling an unconfirmed order needs no stock movement", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      const before = await stock(s, shop);
      await s.as(admin(), "select web_order_cancel($1, 'Sin respuesta del cliente')", [order.id]);
      expect(await stock(s, shop)).toBe(before);
      const row = await s.as("owner", "select status, sale_id from web_orders where id = $1", [order.id]);
      expect(row.rows[0]).toEqual({ status: "cancelado", sale_id: null });
    });
  });

  it("voiding the sale from the sales screen cancels its web order", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      const sale = await s.as<{ id: string }>(admin(), "select web_order_confirm($1) as id", [order.id]);
      await s.as(admin(), "select void_sale($1, 'Anulada desde ventas')", [sale.rows[0].id]);
      const row = await s.as("owner", "select status, cancel_reason from web_orders where id = $1", [order.id]);
      expect(row.rows[0].status).toBe("cancelado");
      expect(row.rows[0].cancel_reason).toContain("Venta anulada");
    });
  });
});

describe("row level security of the order tables", () => {
  it("a seller sees only the orders of their own branch and never the proofs; the superadmin sees all", async () => {
    await scenario(shop, async (s) => {
      const order = await s.createOrder(shop, { qty: 1 });
      await s.as("public", "select public_order_attach_proof($1, $2, $3, null)", [order.hash, await tinyWebp(), "a".repeat(40)]);
      const mine = await s.as("owner", "select 1", []);
      expect(mine.rows).toHaveLength(1);
      const own = await s.as(shop.seller, "select id from web_orders where id = $1", [order.id]);
      expect(own.rows).toHaveLength(1);
      expect((await s.as(shop.seller, "select id from web_order_items where order_id = $1", [order.id])).rows.length).toBeGreaterThan(0);
      expect((await s.as(shop.otherSeller, "select id from web_orders where id = $1", [order.id])).rows).toHaveLength(0);
      expect((await s.as(shop.otherSeller, "select id from web_order_items where order_id = $1", [order.id])).rows).toHaveLength(0);
      expect((await s.as(shop.otherSeller, "select id from web_order_events where order_id = $1", [order.id])).rows).toHaveLength(0);
      await expectPgError(s.as(shop.seller, "select * from web_order_proofs"), "42501");
      await expectPgError(s.as(shop.seller, "update web_orders set status = 'entregado' where id = $1", [order.id]), "42501");
      await expectPgError(s.as(shop.seller, "insert into store_delivery_zones (name, fee) values ('x', 1)"), "42501");
      await expectPgError(s.as(shop.seller, "select * from model_images"), "42501");
      await expectPgError(s.as(shop.seller, "select * from store_assets"), "42501");
      expect((await s.as(admin(), "select id from web_order_proofs where order_id = $1", [order.id])).rows).toHaveLength(1);
      await expectPgError(s.as(admin(), "update web_orders set status = 'entregado' where id = $1", [order.id]), "42501");
      await expectPgError(s.as(admin(), "delete from web_orders where id = $1", [order.id]), "42501");
    });
  });

  it("order tables hold no cost data and the seller cannot reach cost tables through them", async () => {
    const { rows } = await (await import("../helpers/system")).systemQuery<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('web_orders','web_order_items','web_order_events','model_images','store_delivery_zones','store_pickup_points')
          and column_name ~* '(cost|margin|supplier|landed|rate)'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("housekeeping of unpaid orders", () => {
  it("the superadmin cancels old unpaid orders without proof; paid or recent ones stay", async () => {
    await scenario(shop, async (s) => {
      const old = await s.createOrder(shop, { qty: 1 });
      const withProof = await s.createOrder(shop, { qty: 1 });
      const fresh = await s.createOrder(shop, { qty: 1 });
      await s.as("public", "select public_order_attach_proof($1, null, null, 'ref-9')", [withProof.hash]);
      await s.as("owner", "update web_orders set created_at = now() - interval '5 days' where id = any($1)", [[old.id, withProof.id]]);
      await expectPgError(s.as(shop.seller, "select web_orders_expire_unpaid(3)"), "42501");
      await expectPgError(s.as(admin(), "select web_orders_expire_unpaid(0)"), "IN003");
      const done = await s.as<{ n: number }>(admin(), "select web_orders_expire_unpaid(3) as n");
      expect(done.rows[0].n).toBeGreaterThanOrEqual(1);
      const rows = await s.as("owner", "select id, status from web_orders where id = any($1)", [[old.id, withProof.id, fresh.id]]);
      const status = Object.fromEntries(rows.rows.map((r) => [r.id, r.status]));
      expect(status[old.id]).toBe("cancelado");
      expect(status[withProof.id]).toBe("pago_en_revision");
      expect(status[fresh.id]).toBe("pendiente_pago");
    });
  });
});

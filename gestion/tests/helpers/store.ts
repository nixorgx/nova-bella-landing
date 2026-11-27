import { createHash, randomBytes } from "node:crypto";
import type { PoolClient, QueryResult, QueryResultRow } from "pg";
import sharp from "sharp";
import { signContext } from "@/lib/db-context";
import { getContextSecret } from "@/lib/env";
import { createBranch, createUser, createVariant, addStock, type TestVariant } from "./fixtures";
import { systemQuery, withSystem } from "./system";

/** A real WebP the database accepts (RIFF....WEBP), produced the same way the app does. */
export async function tinyWebp(color = "#a23b60", size = 64): Promise<Buffer> {
  return sharp({ create: { width: size, height: size, channels: 3, background: color, noise: { type: "gaussian", mean: 128, sigma: 40 } } }).webp({ quality: 80 }).toBuffer();
}

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();
export const newToken = (): { token: string; hash: Buffer } => {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
};
export const newKey = (): string => randomBytes(16).toString("base64url");

export interface Shop {
  readonly branchId: string;
  readonly zoneId: string;
  readonly pickupId: string;
  readonly variant: TestVariant;
  readonly admin: { userId: string; branchId: null; role: "superadmin" };
  readonly seller: { userId: string; branchId: string; role: "seller" };
  readonly otherSeller: { userId: string; branchId: string; role: "seller" };
  readonly otherBranchId: string;
}

/** Committed fixtures: a branch with stock, a published model, a zone, a pickup point, two sellers. */
export async function createShop(opts: { price?: string; stock?: number; fee?: string } = {}): Promise<Shop> {
  const branchId = await createBranch(true, false);
  const otherBranchId = await createBranch(true, false);
  const variant = await createVariant(opts.price ?? "120.00");
  await addStock(variant.variantId, branchId, opts.stock ?? 5);
  await systemQuery("update models set published_online = true where id = $1", [variant.modelId]);
  const zone = await systemQuery<{ id: string }>(
    "insert into store_delivery_zones (name, fee) values ($1, $2) returning id",
    [`Zona ${randomBytes(3).toString("hex")}`, opts.fee ?? "15.00"],
  );
  const pickup = await systemQuery<{ id: string }>(
    "insert into store_pickup_points (branch_id, label) values ($1, 'Tienda test') returning id",
    [branchId],
  );
  const admin = (await createUser("superadmin", null)) as Shop["admin"];
  const seller = (await createUser("seller", branchId)) as Shop["seller"];
  const otherSeller = (await createUser("seller", otherBranchId)) as Shop["otherSeller"];
  return { branchId, zoneId: zone.rows[0].id, pickupId: pickup.rows[0].id, variant, admin, seller, otherSeller, otherBranchId };
}

export interface OrderPayloadOptions {
  readonly variantId: string;
  readonly qty?: number;
  readonly zoneId?: string;
  readonly pickupId?: string;
  readonly fulfillment?: "delivery" | "pickup";
  readonly payment?: "qr" | "contra_entrega";
  readonly phone?: string;
  readonly key?: string;
  readonly extra?: Record<string, unknown>;
}

export function orderPayload(o: OrderPayloadOptions): Record<string, unknown> {
  const fulfillment = o.fulfillment ?? "delivery";
  return {
    idempotency_key: o.key ?? newKey(),
    name: "Cliente de prueba",
    phone: o.phone ?? `7${Math.floor(1_000_000 + Math.random() * 8_999_999)}`,
    email: "",
    payment_method: o.payment ?? "qr",
    fulfillment,
    zone_id: fulfillment === "delivery" ? (o.zoneId ?? "") : "",
    address: fulfillment === "delivery" ? "Calle Falsa 123" : "",
    reference: "",
    pickup_id: fulfillment === "pickup" ? (o.pickupId ?? "") : "",
    wants_invoice: "false",
    invoice_nit: "",
    invoice_name: "",
    notes: "",
    items: [{ variant_id: o.variantId, qty: o.qty ?? 1 }],
    ...o.extra,
  };
}

type Who = "owner" | "public" | { role: "seller" | "superadmin"; userId: string; branchId: string | null };

export interface Scenario {
  /** Runs SQL as the given database identity inside the (rolled back) scenario transaction. */
  as<R extends QueryResultRow = QueryResultRow>(who: Who, text: string, values?: unknown[]): Promise<QueryResult<R>>;
  createOrder(shop: Shop, o: Omit<OrderPayloadOptions, "variantId" | "zoneId" | "pickupId"> & { variantId?: string }): Promise<{ code: string; id: string; token: string; hash: Buffer }>;
}

/**
 * One isolated scenario: everything happens in a single owner transaction that is ALWAYS rolled back, so tests in
 * parallel files never see each other (store settings are global). Identities are switched with SET LOCAL SESSION
 * AUTHORIZATION (what app_role() reads), exactly like the real login roles. Each call is wrapped in a savepoint so a
 * rejected call (an expected error) does not poison the transaction.
 */
export async function scenario<T>(
  shop: Pick<Shop, "branchId">,
  fn: (s: Scenario) => Promise<T>,
  settings: { open?: boolean } = {},
): Promise<T> {
  const client = await (async () => {
    // reuse the shared system pool through withSystem's client by hand: we need a rollback, not a commit
    let resolve!: (c: PoolClient) => void;
    let release!: () => void;
    const got = new Promise<PoolClient>((r) => (resolve = r));
    const done = new Promise<void>((r) => (release = r));
    const running = withSystem(async (c) => {
      resolve(c);
      await done;
      throw new Error("__rollback__");
    }).catch((e: Error) => {
      if (e.message !== "__rollback__") throw e;
    });
    return { c: await got, release, running };
  })();
  const c = client.c;
  try {
    await c.query("update app_settings set value = $1 where key = 'store_branch_id'", [shop.branchId]);
    await c.query("update app_settings set value = $1 where key = 'store_open'", [String(settings.open ?? true)]);
    const as: Scenario["as"] = async (who, text, values) => {
      await c.query("savepoint sc");
      try {
        await c.query("reset session authorization");
        if (who !== "owner") {
          const login = who === "public" ? "app_runtime_public" : who.role === "seller" ? "app_runtime_seller" : "app_runtime_superadmin";
          await c.query(`set local session authorization ${login}`);
          if (who !== "public") {
            await c.query("select set_config('app.ctx', $1, true)", [signContext({ userId: who.userId, branchId: who.branchId }, getContextSecret())]);
          }
        }
        const result = await c.query(text, values);
        await c.query("reset session authorization");
        await c.query("release savepoint sc");
        return result as never;
      } catch (error) {
        await c.query("reset session authorization").catch(() => undefined);
        await c.query("rollback to savepoint sc").catch(() => undefined);
        throw error;
      }
    };
    const createOrder: Scenario["createOrder"] = async (s, o) => {
      const { token, hash } = newToken();
      const payload = orderPayload({ ...o, variantId: o.variantId ?? s.variant.variantId, zoneId: s.zoneId, pickupId: s.pickupId });
      const { rows } = await as<{ order_code: string }>("public", "select * from public_create_order($1::jsonb, $2)", [JSON.stringify(payload), hash]);
      const order = await as<{ id: string }>("owner", "select id from web_orders where code = $1", [rows[0].order_code]);
      return { code: rows[0].order_code, id: order.rows[0].id, token, hash };
    };
    return await fn({ as, createOrder });
  } finally {
    client.release();
    await client.running;
  }
}

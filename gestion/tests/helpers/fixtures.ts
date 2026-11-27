import { randomBytes, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { systemQuery } from "./system";

const tag = () => randomBytes(5).toString("hex");

/**
 * New branch. Sales require an open cash session in the branch, so by default one is
 * opened (by a throwaway superadmin); pass `openCash = false` for "no open cash" cases.
 */
export async function createBranch(active = true, openCash = true): Promise<string> {
  const { rows } = await systemQuery<{ id: string }>(
    "insert into branches (name, city, active) values ($1, 'Test', $2) returning id",
    [`Sucursal ${tag()}`, active],
  );
  const branchId = rows[0].id;
  if (openCash) await openCashSession(branchId);
  return branchId;
}

/** Opens a cash session as a system fixture; returns its id. */
export async function openCashSession(branchId: string, openedBy?: string): Promise<string> {
  const opener = openedBy ?? (await createUser("superadmin", null)).userId;
  const { rows } = await systemQuery<{ id: string }>(
    "insert into cash_sessions (branch_id, opened_by) values ($1, $2) returning id",
    [branchId, opener],
  );
  return rows[0].id;
}

/** Closes every open cash session of the branch (fixture shortcut). */
export async function closeCashSessions(branchId: string): Promise<void> {
  await systemQuery(
    "update cash_sessions set closed_at = now(), closing_amount = 0 where branch_id = $1 and closed_at is null",
    [branchId],
  );
}

export async function createUser(
  role: "superadmin" | "seller",
  branchId: string | null,
  active = true,
): Promise<SessionPayload> {
  const { rows } = await systemQuery<{ id: string }>(
    `insert into users (username, full_name, password_hash, role, branch_id, active)
     values ($1, 'Usuario de prueba', 'not-a-real-hash', $2, $3, $4) returning id`,
    [`u${tag()}`, role, branchId, active],
  );
  return { userId: rows[0].id, role, branchId };
}

export interface TestVariant {
  readonly variantId: string;
  readonly sku: string;
  readonly modelId: string;
}

export async function createVariant(basePrice = "100.00"): Promise<TestVariant> {
  const t = tag();
  const q = async (text: string, values: unknown[]) =>
    (await systemQuery<{ id: string }>(text, values)).rows[0].id;
  const lineId = await q("insert into product_lines (name) values ($1) returning id", [`Linea ${t}`]);
  const modelId = await q(
    "insert into models (line_id, name, base_sale_price) values ($1, $2, $3) returning id",
    [lineId, `Modelo ${t}`, basePrice],
  );
  const colorId = await q("insert into colors (name) values ($1) returning id", [`Color ${t}`]);
  const sizeId = await q("insert into sizes (label, sort_order) values ($1, 0) returning id", [`T${t}`]);
  const sku = `SKU-${t}`;
  const variantId = await q(
    "insert into variants (model_id, color_id, size_id, sku) values ($1, $2, $3, $4) returning id",
    [modelId, colorId, sizeId, sku],
  );
  return { variantId, sku, modelId };
}

/** Puts stock on hand through the ledger (owner-level, bypasses RPC checks on purpose). */
export async function addStock(variantId: string, branchId: string, qty: number): Promise<void> {
  await systemQuery(
    "insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, $3, 'adjust', 'test')",
    [variantId, branchId, qty],
  );
}

export async function stockOf(variantId: string, branchId: string): Promise<number> {
  const { rows } = await systemQuery<{ qty: number }>(
    "select qty from stock_levels where variant_id = $1 and branch_id = $2",
    [variantId, branchId],
  );
  return rows[0]?.qty ?? 0;
}

export async function ledgerSum(variantId: string, branchId: string): Promise<number> {
  const { rows } = await systemQuery<{ total: string }>(
    "select coalesce(sum(qty), 0) as total from stock_movements where variant_id = $1 and branch_id = $2",
    [variantId, branchId],
  );
  return Number(rows[0].total);
}

export interface SaleLine {
  readonly variantId: string;
  readonly qty: number;
  readonly finalPrice: string;
}
export interface Payment {
  readonly method: string;
  readonly amount: string;
}

export interface SaleOptions {
  readonly branchId: string;
  readonly customerId?: string | null;
  readonly docType?: string;
  readonly cashSessionId?: string | null;
}

export async function rpcCreateSale(
  client: PoolClient,
  options: SaleOptions,
  lines: readonly SaleLine[],
  payments: readonly Payment[],
): Promise<string> {
  const items = lines.map((l) => ({ variant_id: l.variantId, qty: l.qty, final_price: l.finalPrice }));
  const { rows } = await client.query<{ id: string }>(
    "select create_sale($1, $2, $3, $4::jsonb, $5::jsonb, $6) as id",
    [
      options.branchId,
      options.customerId ?? null,
      options.docType ?? "nota_venta",
      JSON.stringify(items),
      JSON.stringify(payments),
      options.cashSessionId ?? null,
    ],
  );
  return rows[0].id;
}

/** Convenience: one-line sale in its own transaction as `session`. */
export function sellOne(
  session: SessionPayload,
  branchId: string,
  variantId: string,
  qty: number,
  price: string,
  total: string,
): Promise<string> {
  return withUser(session, (client) =>
    rpcCreateSale(client, { branchId }, [{ variantId, qty, finalPrice: price }], [
      { method: "efectivo", amount: total },
    ]),
  );
}

/** Asserts a promise rejects with a Postgres error carrying `code`. */
export async function expectPgError(promise: Promise<unknown>, code: string): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    const actual = (error as { code?: string }).code;
    if (actual !== code) {
      throw new Error(`Se esperaba el codigo ${code} pero fue ${actual}: ${(error as Error).message}`);
    }
    return error as Error;
  }
  throw new Error(`Se esperaba un error ${code} pero la operacion tuvo exito`);
}

export const newId = () => randomUUID();

import { createHash } from "node:crypto";
import { Client } from "pg";
import { applyUserContext } from "../src/lib/db-context";
import { say } from "./lib/log";

/**
 * Demo 2 data: exchange-rate history, customers, price policy and ~15 realistic sales over the
 * last three weeks (through create_sale, as the seller, so every business rule applies).
 * Idempotent: it only seeds sales when the database has none yet.
 */
export interface Demo2Context {
  readonly adminId: string;
  readonly sellerId: string;
  readonly branchId: string;
}

type Row<T> = { rows: T[] };

const CUSTOMERS = [
  { name: "María Fernanda Rojas", phone: "71234567", ci: "6543210", shared: false },
  { name: "Carlos Mamani Quispe", phone: "76543210", ci: "4821907", shared: false },
  { name: "Boutique Lucía", phone: "3345566", ci: "1023456028", shared: true },
  { name: "Jorge Antonio Choque", phone: "69988776", ci: "7712034", shared: false },
  { name: "Daniela Suárez Peña", phone: "72211003", ci: "9034455", shared: false },
  { name: "Ximena Calle Vaca", phone: "78890011", ci: "5567123", shared: false },
] as const;

/** Day offsets (days ago) of each demo sale, oldest first. The last ones happen today. */
const SALE_DAYS = [20, 20, 18, 18, 15, 14, 14, 11, 8, 8, 6, 4, 3, 0, 0] as const;
export const OPENING_AMOUNT = "150.00";
const TODAY_OPENING = "200.00";

export const hash = (text: string): number => parseInt(createHash("md5").update(text).digest("hex").slice(0, 8), 16);

export interface Candidate {
  readonly id: string;
  readonly sku: string;
  readonly price: string;
  stock: number;
}

export interface PlannedSale {
  readonly daysAgo: number;
  readonly items: { variant_id: string; qty: number; final_price: string }[];
  readonly payments: { method: string; amount: string }[];
  readonly docType: "factura" | "nota_venta";
  readonly customerId: string | null;
  readonly createdAtHour: number;
}

function cents(value: string): number {
  return Math.round(Number(value) * 100);
}

function money(centsValue: number): string {
  return (centsValue / 100).toFixed(2);
}

function paymentsFor(index: number, total: number): { method: string; amount: string }[] {
  const mode = index % 4;
  if (mode === 1) return [{ method: "efectivo", amount: money(total) }];
  if (mode === 2) return [{ method: "tarjeta", amount: money(total) }];
  const firstCents = Math.max(100, Math.round(total * 0.4 / 100) * 100);
  const first = Math.min(firstCents, total - 100);
  const second = total - first;
  return mode === 0
    ? [{ method: "efectivo", amount: money(first) }, { method: "qr", amount: money(second) }]
    : [{ method: "transferencia", amount: money(second) }, { method: "efectivo", amount: money(first) }];
}

export async function loadCandidates(owner: Client, branchId: string): Promise<Candidate[]> {
  const { rows } = (await owner.query(
    `select v.id, v.sku, m.base_sale_price::text as price, sl.qty
       from stock_levels sl
       join variants v on v.id = sl.variant_id
       join models m on m.id = v.model_id
      where sl.branch_id = $1 and sl.qty >= 3 and v.active and m.active
      order by v.sku`,
    [branchId],
  )) as Row<{ id: string; sku: string; price: string; qty: number }>;
  return rows.map((row) => ({ id: row.id, sku: row.sku, price: row.price, stock: row.qty }));
}

export function planSales(
  candidates: Candidate[],
  customerIds: readonly string[],
  days: readonly number[] = SALE_DAYS,
): PlannedSale[] {
  const ordered = [...candidates].sort((a, b) => hash(a.sku) - hash(b.sku));
  let cursor = 0;
  return days.map((daysAgo, index) => {
    const lineCount = index % 5 === 4 ? 3 : index % 3 === 0 ? 2 : 1;
    const discounted = index % 5 === 2 || index === 9;
    const items: PlannedSale["items"] = [];
    let guard = 0;
    while (items.length < lineCount && guard++ < ordered.length * 3) {
      const candidate = ordered[cursor++ % ordered.length];
      const qty = candidate.stock >= 4 && index % 6 === 1 ? 2 : 1;
      if (candidate.stock < qty || items.some((item) => item.variant_id === candidate.id)) continue;
      candidate.stock -= qty;
      const price = discounted ? money(Math.round(cents(candidate.price) * 0.9 / 100) * 100) : candidate.price;
      items.push({ variant_id: candidate.id, qty, final_price: price });
    }
    const total = items.reduce((sum, item) => sum + item.qty * cents(item.final_price), 0);
    return {
      daysAgo,
      items,
      payments: paymentsFor(index, total),
      docType: index % 3 === 0 ? "factura" : "nota_venta",
      customerId: index % 5 < 3 ? customerIds[index % customerIds.length] : null,
      createdAtHour: 10 + (index * 3) % 9,
    };
  });
}

export function sellerRuntimeUrl(adminUrl: string): string {
  const raw = process.env.DATABASE_URL_SELLER;
  if (!raw) throw new Error("Falta DATABASE_URL_SELLER (necesaria para sembrar las ventas).");
  const url = new URL(raw);
  url.pathname = new URL(adminUrl).pathname;
  return url.toString();
}

async function seedRates(owner: Client, adminId: string): Promise<void> {
  const exists = (await owner.query("select 1 from exchange_rates limit 1")) as Row<unknown>;
  if (exists.rows.length > 0) return;
  const history = [
    [28, "6.96", "10.20"],
    [21, "6.96", "10.30"],
    [14, "6.96", "10.40"],
    [7, "6.96", "10.50"],
    [2, "6.96", "10.60"],
  ] as const;
  for (const [daysAgo, official, parallel] of history) {
    await owner.query(
      "insert into exchange_rates (rate_date, official_rate, parallel_rate, created_by) values (current_date - $1::int, $2, $3, $4)",
      [daysAgo, official, parallel, adminId],
    );
  }
}

export async function seedCustomers(owner: Client, branchId: string): Promise<string[]> {
  const ids: string[] = [];
  for (const customer of CUSTOMERS) {
    const found = (await owner.query("select id from customers where name = $1 limit 1", [customer.name])) as Row<{ id: string }>;
    if (found.rows[0]) {
      ids.push(found.rows[0].id);
      continue;
    }
    const created = (await owner.query(
      "insert into customers (branch_id, name, phone, ci_nit) values ($1, $2, $3, $4) returning id",
      [customer.shared ? null : branchId, customer.name, customer.phone, customer.ci],
    )) as Row<{ id: string }>;
    ids.push(created.rows[0].id);
  }
  return ids;
}

export async function openSession(owner: Client, ctx: Demo2Context, daysAgo: number, opening: string): Promise<string> {
  const { rows } = (await owner.query(
    `insert into cash_sessions (branch_id, opened_by, opened_at, opening_amount)
     values ($1, $2, least(now(), (current_date - $3::int) + interval '8 hours 30 minutes'), $4) returning id`,
    [ctx.branchId, ctx.sellerId, daysAgo, opening],
  )) as Row<{ id: string }>;
  return rows[0].id;
}

/** Closes a session in the past: the guard trigger stamps now(), so it is bypassed for the seed only. */
export async function closePastSession(owner: Client, sessionId: string, daysAgo: number, diff: number): Promise<void> {
  const { rows } = (await owner.query(
    `select cs.opening_amount::numeric + coalesce(sum(p.amount) filter (where p.method = 'efectivo'), 0) as expected
       from cash_sessions cs
       left join sales s on s.cash_session_id = cs.id
       left join sale_payments p on p.sale_id = s.id
      where cs.id = $1 group by cs.id`,
    [sessionId],
  )) as Row<{ expected: string }>;
  const counted = (Number(rows[0].expected) + diff).toFixed(2);
  await owner.query("begin");
  try {
    // Managed Postgres (Neon) forbids session_replication_role; the table owner can disable the
    // table's own triggers instead (transactional, re-enabled below).
    await owner.query("alter table cash_sessions disable trigger user");
    await owner.query(
      `update cash_sessions
          set closed_at = (current_date - $2::int) + interval '19 hours 40 minutes',
              closed_by = opened_by, closing_amount = $3
        where id = $1`,
      [sessionId, daysAgo, counted],
    );
    await owner.query("alter table cash_sessions enable trigger user");
    await owner.query("commit");
  } catch (error) {
    await owner.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function sellAll(adminUrl: string, owner: Client, ctx: Demo2Context, sales: readonly PlannedSale[]): Promise<void> {
  const seller = new Client({ connectionString: sellerRuntimeUrl(adminUrl) });
  await seller.connect();
  try {
    const days = [...new Set(sales.map((sale) => sale.daysAgo))];
    for (const day of days) {
      const isToday = day === 0;
      const sessionId = await openSession(owner, ctx, day, isToday ? TODAY_OPENING : OPENING_AMOUNT);
      for (const sale of sales.filter((candidate) => candidate.daysAgo === day)) {
        await seller.query("begin");
        try {
          await applyUserContext(seller, { userId: ctx.sellerId, role: "seller", branchId: ctx.branchId });
          const { rows } = (await seller.query(
            "select create_sale($1, $2, $3, $4::jsonb, $5::jsonb, null) as id",
            [ctx.branchId, sale.customerId, sale.docType, JSON.stringify(sale.items), JSON.stringify(sale.payments)],
          )) as Row<{ id: string }>;
          await seller.query("commit");
          await owner.query(
            `update sales set created_at = least(now(), (current_date - $2::int) + make_interval(hours => $3, mins => $4))
              where id = $1`,
            [rows[0].id, day, sale.createdAtHour, (hash(rows[0].id) % 50) + 5],
          );
        } catch (error) {
          await seller.query("rollback").catch(() => undefined);
          throw error;
        }
      }
      if (!isToday) await closePastSession(owner, sessionId, day, [0, 0, -5, 0, 10, 0, -2][hash(`${day}`) % 7]);
    }
  } finally {
    await seller.end();
  }
}

export async function seedDemo2(adminUrl: string, ctx: Demo2Context, owner: Client): Promise<void> {
  await seedRates(owner, ctx.adminId);
  const customerIds = await seedCustomers(owner, ctx.branchId);

  // Demo 3 seeds older history first; only the last 19 days decide whether Demo 2's sales exist.
  const hasSales = (await owner.query("select 1 from sales where created_at >= now() - interval '19 days' limit 1")) as Row<unknown>;
  if (hasSales.rows.length > 0) return;
  const open = (await owner.query("select 1 from cash_sessions where branch_id = $1 and closed_at is null", [ctx.branchId])) as Row<unknown>;
  if (open.rows.length > 0) return;

  await owner.query("update app_settings set value = '20' where key = 'max_discount_pct' and value is null");
  const candidates = await loadCandidates(owner, ctx.branchId);
  if (candidates.length < 6) return;
  await sellAll(adminUrl, owner, ctx, planSales(candidates, customerIds));
  say("seed demo 2 listo: tipos de cambio, clientes, 15 ventas y una caja abierta.");
}

import { Client } from "pg";
import { applyUserContext } from "../src/lib/db-context";
import type { SessionPayload } from "../src/lib/auth/session";
import { say } from "./lib/log";
import {
  closePastSession,
  hash,
  loadCandidates,
  openSession,
  OPENING_AMOUNT,
  planSales,
  seedCustomers,
  sellerRuntimeUrl,
  type Demo2Context,
  type PlannedSale,
} from "./seed-demo2";

/**
 * Demo 3 data, on top of Demo 2 (all through the real RPCs, so every business rule applies):
 *  - history: ~24 older sales (3 to 6 weeks ago) with closed cash sessions, some sold by the superadmin,
 *    so the charts, the model x size heat map and "ventas por vendedor" look alive. Runs BEFORE Demo 2 so sale
 *    numbers keep following the dates;
 *  - extras: three exchanges (same price, dearer by QR, cheaper refunded in cash) and two voided sales.
 * Idempotent (the extras run once: they need no exchange in the database) and free of superuser-only commands.
 */

/** Days ago of the older sales, oldest first. Days 0-20 belong to Demo 2. */
const HISTORY_DAYS = [41, 41, 40, 38, 38, 37, 35, 34, 34, 33, 31, 31, 30, 28, 28, 27, 26, 26, 24, 23, 23, 22, 21, 21] as const;
/** Pairs kept untouched per variant so later demos and tests always find stock. */
const RESERVE = 2;
/** Every Nth sale is rung up by the superadmin (the shop owner also sells). */
const ADMIN_EVERY = 4;

type Row<T> = { rows: T[] };

function superadminUrl(adminUrl: string): string {
  const raw = process.env.DATABASE_URL_SUPERADMIN;
  if (!raw) throw new Error("Falta DATABASE_URL_SUPERADMIN (necesaria para sembrar el historial).");
  const url = new URL(raw);
  url.pathname = new URL(adminUrl).pathname;
  return url.toString();
}

async function connectAs(url: string): Promise<Client> {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function inTransaction<T>(client: Client, session: SessionPayload, work: () => Promise<T>): Promise<T> {
  await client.query("begin");
  try {
    await applyUserContext(client, session);
    const result = await work();
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  }
}

async function ringUp(client: Client, sale: PlannedSale, branchId: string, session: SessionPayload): Promise<string> {
  return inTransaction(client, session, async () => {
    const { rows } = (await client.query("select create_sale($1, $2, $3, $4::jsonb, $5::jsonb, null) as id", [
      branchId,
      sale.customerId,
      sale.docType,
      JSON.stringify(sale.items),
      JSON.stringify(sale.payments),
    ])) as Row<{ id: string }>;
    return rows[0].id;
  });
}

/** Older sales, one closed cash session per day, alternating seller and superadmin. */
export async function seedHistory(adminUrl: string, ctx: Demo2Context, owner: Client): Promise<void> {
  const existing = (await owner.query("select 1 from sales limit 1")) as Row<unknown>;
  if (existing.rows.length > 0) return;
  const customerIds = await seedCustomers(owner, ctx.branchId);
  const candidates = (await loadCandidates(owner, ctx.branchId))
    .map((candidate) => ({ ...candidate, stock: candidate.stock - RESERVE }))
    .filter((candidate) => candidate.stock >= 1);
  if (candidates.length < 8) return;
  const plan = planSales(candidates, customerIds, HISTORY_DAYS);

  const seller = await connectAs(sellerRuntimeUrl(adminUrl));
  const admin = await connectAs(superadminUrl(adminUrl));
  try {
    let index = 0;
    for (const day of [...new Set(plan.map((sale) => sale.daysAgo))]) {
      const sessionId = await openSession(owner, ctx, day, OPENING_AMOUNT);
      for (const sale of plan.filter((candidate) => candidate.daysAgo === day)) {
        const byAdmin = index % ADMIN_EVERY === ADMIN_EVERY - 1;
        index += 1;
        const saleId = byAdmin
          ? await ringUp(admin, sale, ctx.branchId, { userId: ctx.adminId, role: "superadmin", branchId: null })
          : await ringUp(seller, sale, ctx.branchId, { userId: ctx.sellerId, role: "seller", branchId: ctx.branchId });
        await owner.query(
          "update sales set created_at = least(now(), (current_date - $2::int) + make_interval(hours => $3, mins => $4)) where id = $1",
          [saleId, day, sale.createdAtHour, (hash(saleId) % 50) + 5],
        );
      }
      await closePastSession(owner, sessionId, day, [0, 0, -5, 0, 10, 0, -2][hash(`h${day}`) % 7]);
    }
  } finally {
    await seller.end();
    await admin.end();
  }
  say("seed demo 3: historial de 3 a 6 semanas sembrado (con ventas del vendedor y del superadmin).");
}

interface ExchangePlan {
  readonly saleId: string;
  readonly returned: string;
  readonly replacement: string;
  readonly reason: string;
  readonly method: string | null;
}

/** Up to three completed single-line sales and a replacement with stock: same price, dearer, cheaper. */
async function planExchanges(owner: Client, branchId: string, skip: ReadonlySet<string>): Promise<ExchangePlan[]> {
  const { rows } = (await owner.query(
    `select s.id as sale_id, si.variant_id, v.model_id, v.size_id, m.base_sale_price::numeric as price
       from sales s
       join sale_items si on si.sale_id = s.id and si.qty = 1
       join variants v on v.id = si.variant_id
       join models m on m.id = v.model_id
      where s.status = 'completed' and s.branch_id = $1 and s.created_at >= now() - interval '10 days'
        and (select count(*) from sale_items x where x.sale_id = s.id) = 1
      order by s.created_at desc, s.sale_number desc limit 40`,
    [branchId],
  )) as Row<{ sale_id: string; variant_id: string; model_id: string; size_id: string; price: string }>;

  const wants = [
    { kind: "dearer", reason: "Cambio de modelo", method: "qr" },
    { kind: "cheaper", reason: "Era un regalo", method: "efectivo" },
    { kind: "same", reason: "Talla equivocada: le quedaba apretado", method: null },
  ] as const;
  const plans: ExchangePlan[] = [];
  const used = new Set<string>(skip);
  const byPrice = (direction: 1 | -1) => [...rows].sort((a, b) => direction * (Number(a.price) - Number(b.price)));
  for (const want of wants) {
    // look for a dearer pair starting from the cheapest sale, and a cheaper one from the dearest
    const candidates = want.kind === "dearer" ? byPrice(1) : want.kind === "cheaper" ? byPrice(-1) : rows;
    for (const row of candidates) {
      if (used.has(row.sale_id)) continue;
      const comparison = want.kind === "same" ? "= m.base_sale_price" : want.kind === "dearer" ? "> m.base_sale_price" : "< m.base_sale_price";
      const target = (await owner.query(
        `select v.id from variants v join models m on m.id = v.model_id
           join stock_levels sl on sl.variant_id = v.id and sl.branch_id = $1 and sl.qty >= 3
          where v.active and m.active and v.id <> $2
            and ${want.kind === "same" ? "v.model_id = $3 and v.size_id <> $4" : "v.model_id <> $3 and $4::uuid is not null"}
            and m.base_sale_price ${comparison.replace("m.base_sale_price", "$5::numeric")}
          order by v.sku limit 1`,
        [branchId, row.variant_id, row.model_id, row.size_id, row.price],
      )) as Row<{ id: string }>;
      if (!target.rows[0]) continue;
      used.add(row.sale_id);
      plans.push({ saleId: row.sale_id, returned: row.variant_id, replacement: target.rows[0].id, reason: want.reason, method: want.method });
      break;
    }
  }
  return plans;
}

/** Sales of the last days, not exchanged, one in today's open cash and one in a closed one, to be voided. */
async function pickVoids(owner: Client, branchId: string): Promise<{ saleId: string; reason: string }[]> {
  const pick = async (condition: string): Promise<string | null> => {
    const { rows } = (await owner.query(
      `select s.id from sales s
        where s.status = 'completed' and s.branch_id = $1 and ${condition}
          and not exists (select 1 from exchanges e where e.original_sale_id = s.id)
        order by s.created_at desc limit 1`,
      [branchId],
    )) as Row<{ id: string }>;
    return rows[0]?.id ?? null;
  };
  const today = await pick("s.cash_session_id in (select id from cash_sessions where closed_at is null) and s.created_at >= now() - interval '1 day' and s.total < 700");
  const older = await pick("s.cash_session_id in (select id from cash_sessions where closed_at is not null) and s.created_at < now() - interval '4 days' and s.created_at >= now() - interval '12 days'");
  return [
    ...(today ? [{ saleId: today, reason: "Cobro duplicado: el cliente pagó dos veces" }] : []),
    ...(older ? [{ saleId: older, reason: "El cliente devolvió el par completo al día siguiente" }] : []),
  ];
}

/** Exchanges and voids as the people who would do them (seller exchanges, superadmin voids). */
export async function seedExtras(adminUrl: string, ctx: Demo2Context, owner: Client): Promise<void> {
  const done = (await owner.query("select 1 from exchanges limit 1")) as Row<unknown>;
  const openCash = (await owner.query("select 1 from cash_sessions where branch_id = $1 and closed_at is null", [ctx.branchId])) as Row<unknown>;
  if (done.rows.length > 0 || openCash.rows.length === 0) return;

  const voids = await pickVoids(owner, ctx.branchId);
  const voidIds = new Set(voids.map((v) => v.saleId));
  const plans = await planExchanges(owner, ctx.branchId, voidIds);

  const seller = await connectAs(sellerRuntimeUrl(adminUrl));
  const admin = await connectAs(superadminUrl(adminUrl));
  try {
    for (const plan of plans) {
      await inTransaction(seller, { userId: ctx.sellerId, role: "seller", branchId: ctx.branchId }, () =>
        seller.query("select create_exchange($1, $2, $3, 1, $4, null, $5, null)", [plan.saleId, plan.returned, plan.replacement, plan.reason, plan.method]),
      );
    }
    for (const item of voids) {
      await inTransaction(admin, { userId: ctx.adminId, role: "superadmin", branchId: null }, () =>
        admin.query("select void_sale($1, $2)", [item.saleId, item.reason]),
      );
    }
  } finally {
    await seller.end();
    await admin.end();
  }
  say(`seed demo 3 listo: ${plans.length} cambios y ${voids.length} ventas anuladas.`);
}

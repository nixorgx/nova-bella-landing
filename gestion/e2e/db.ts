import { Client } from "pg";

/** Owner connection for E2E assertions only (reads the seeded dev database, never used by the app). */
export async function ownerQuery<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query(text, values)).rows as T[];
  } finally {
    await client.end();
  }
}

export async function skuOf(model: string, color: string, size: string): Promise<string> {
  const rows = await ownerQuery<{ sku: string }>(
    `select v.sku from variants v join models m on m.id = v.model_id join colors c on c.id = v.color_id
       join sizes z on z.id = v.size_id where m.name = $1 and c.name = $2 and z.label = $3`,
    [model, color, size],
  );
  return rows[0].sku;
}

/** A variant of `model` with at least `min` units in the main branch. */
export async function stockedSku(model: string, min = 3): Promise<{ sku: string; color: string; size: string }> {
  const rows = await ownerQuery<{ sku: string; color: string; size: string }>(
    `select v.sku, c.name as color, z.label as size from stock_levels sl
       join variants v on v.id = sl.variant_id join models m on m.id = v.model_id
       join colors c on c.id = v.color_id join sizes z on z.id = v.size_id
      where m.name = $1 and sl.qty >= $2 order by v.sku limit 1`,
    [model, min],
  );
  return rows[0];
}

export async function stockOfSku(sku: string): Promise<number> {
  const rows = await ownerQuery<{ qty: number }>(
    `select coalesce(sum(sl.qty), 0)::int as qty from variants v left join stock_levels sl on sl.variant_id = v.id where v.sku = $1`,
    [sku],
  );
  return rows[0].qty;
}

export async function modelPrice(model: string): Promise<string> {
  const rows = await ownerQuery<{ p: string }>("select base_sale_price::text as p from models where name = $1", [model]);
  return rows[0].p;
}

/** Completed (not voided) sales of today with their total, excluding nothing: what a "hoy" report must add up to. */
export async function todaySalesTotal(): Promise<{ count: number; total: string }> {
  const rows = await ownerQuery<{ count: number; total: string }>(
    `select count(*)::int as count, coalesce(sum(total), 0)::text as total from sales
      where status = 'completed' and (created_at at time zone 'America/La_Paz')::date = (now() at time zone 'America/La_Paz')::date`,
  );
  return rows[0];
}

export async function saleStatus(id: string): Promise<{ status: string; voidReason: string | null }> {
  const rows = await ownerQuery<{ status: string; void_reason: string | null }>("select status, void_reason from sales where id = $1", [id]);
  return { status: rows[0].status, voidReason: rows[0].void_reason };
}

/** Expected cash of the OPEN session: opening + cash sales + cash exchange differences (voided sales out). */
export async function openCashExpected(): Promise<string> {
  const rows = await ownerQuery<{ expected: string }>(
    `select (cs.opening_amount
       + coalesce((select sum(p.amount) from sale_payments p join sales s on s.id = p.sale_id
                    where s.cash_session_id = cs.id and s.status = 'completed' and p.method = 'efectivo'), 0)
       + coalesce((select sum(e.price_diff) from exchanges e where e.cash_session_id = cs.id and e.payment_method = 'efectivo'), 0))::text as expected
       from cash_sessions cs where cs.closed_at is null limit 1`,
  );
  return rows[0].expected;
}

export interface WorstCaseIds {
  readonly saleId: string;
  readonly voidedId: string;
  readonly groupId: string;
  readonly customer: string;
}

export const WORST_MODEL = "Zapatilla Deportiva Infantil Reforzada Edición Aniversario Colección Primavera-Verano 2026";
export const WORST_REASON = "El cliente indica que el calzado le queda apretado del lado externo y prefiere una horma más ancha para uso diario en el colegio";

/**
 * The longest realistic values the schema accepts: a 90-character model, a long color and size, a customer with
 * accents, "de los" particles and an emoji, a Bs 1.199.880,00 sale and 120-140 character reasons.
 * Created through the real RPCs (seller / superadmin runtime logins), like the seed does.
 */
export async function createWorstCase(): Promise<WorstCaseIds> {
  const { Client } = await import("pg");
  const { applyUserContext } = await import("../src/lib/db-context");
  const [branch] = await ownerQuery<{ id: string }>("select id from branches where name = 'Central'");
  const [seller] = await ownerQuery<{ id: string }>("select id from users where username = 'vendedor1'");
  const [admin] = await ownerQuery<{ id: string }>("select id from users where role = 'superadmin' order by created_at limit 1");
  const tag = Date.now().toString().slice(-6);
  const one = async (text: string, values: unknown[]) => (await ownerQuery<{ id: string }>(text, values))[0].id;

  const line = await one("insert into product_lines (name) values ($1) returning id", [`Línea larga ${tag}`]);
  const model = await one("insert into models (line_id, name, base_sale_price) values ($1, $2, 9999.00) returning id", [line, `${WORST_MODEL} ${tag}`]);
  const color = await one("insert into colors (name) values ($1) returning id", [`Azul marino con detalles en dorado metálico ${tag}`]);
  const sizes = [await one("insert into sizes (label, sort_order) values ($1, 900) returning id", [`43/44 ancho ${tag}`]), await one("insert into sizes (label, sort_order) values ($1, 901) returning id", [`45 extra ancho ${tag}`])];
  const variants: string[] = [];
  for (const size of sizes) {
    const variant = await one("insert into variants (model_id, color_id, size_id, sku) values ($1, $2, $3, $4) returning id", [model, color, size, `WORST-${tag}-${variants.length}`]);
    await ownerQuery("insert into stock_movements (variant_id, branch_id, qty, type, note) values ($1, $2, 300, 'adjust', 'peor caso')", [variant, branch.id]);
    await ownerQuery("insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, 4200.55, 4200.55)", [variant]);
    variants.push(variant);
  }
  const customer = `María de los Ángeles Fernández de Córdova y Sánchez-Villarroel 😀 ${tag}`;
  const customerId = await one("insert into customers (branch_id, name, phone, ci_nit) values ($1, $2, '+591 71234567', '1023456028-1B') returning id", [branch.id, customer]);

  const connect = async (envName: string) => {
    const url = new URL(process.env[envName] as string);
    url.pathname = new URL(process.env.DATABASE_URL as string).pathname;
    const client = new Client({ connectionString: url.toString() });
    await client.connect();
    return client;
  };
  const sellerClient = await connect("DATABASE_URL_SELLER");
  const adminClient = await connect("DATABASE_URL_SUPERADMIN");
  try {
    const run = async <T>(client: InstanceType<typeof Client>, session: Parameters<typeof applyUserContext>[1], work: () => Promise<T>) => {
      await client.query("begin");
      await applyUserContext(client, session);
      const result = await work();
      await client.query("commit");
      return result;
    };
    const sellerSession = { userId: seller.id, role: "seller", branchId: branch.id } as const;
    const sale = async (price: string, qty: number, buyer: string | null) =>
      run(sellerClient, sellerSession, async () => {
        const total = (Number(price) * qty).toFixed(2);
        const res = await sellerClient.query("select create_sale($1, $2, 'factura', $3::jsonb, $4::jsonb, null) as id", [
          branch.id, buyer, JSON.stringify([{ variant_id: variants[0], qty, final_price: price }]),
          JSON.stringify([{ method: "efectivo", amount: (Number(total) / 2).toFixed(2) }, { method: "qr", amount: (Number(total) / 2).toFixed(2) }]),
        ]);
        return res.rows[0].id as string;
      });
    const saleId = await sale("9999.00", 120, customerId);
    const voidedId = await sale("9500.00", 1, customerId);
    const groupId = (await run(sellerClient, sellerSession, async () => {
      await sellerClient.query("select create_exchange($1, $2, $3, 1, $4, null, null, null)", [saleId, variants[0], variants[1], WORST_REASON]);
      return (await sellerClient.query("select group_id from exchanges where original_sale_id = $1 limit 1", [saleId])).rows[0].group_id as string;
    }));
    await run(adminClient, { userId: admin.id, role: "superadmin", branchId: null }, () =>
      adminClient.query("select void_sale($1, $2)", [voidedId, `${WORST_REASON}. Se anula para corregir el documento fiscal emitido con otro NIT.`]),
    );
    return { saleId, voidedId, groupId, customer };
  } finally {
    await sellerClient.end();
    await adminClient.end();
  }
}

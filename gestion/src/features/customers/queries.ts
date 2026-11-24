import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { foldText } from "@/features/catalog/variant-query";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";
import type { CustomerInput } from "./schemas";

export interface CustomerOption {
  readonly id: string;
  readonly name: string;
  readonly phone: string | null;
  readonly ciNit: string | null;
}

export interface CustomerRow extends CustomerOption {
  readonly purchases: number;
  readonly spent: string;
  readonly lastPurchaseAt: string | null;
}

export interface CustomerSale {
  readonly id: string;
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly docType: "factura" | "nota_venta";
  readonly status: "completed" | "voided";
  readonly total: string;
  readonly units: number;
}

export interface CustomerDetail extends CustomerOption {
  readonly notes: string | null;
  readonly createdAt: string;
  readonly sales: readonly CustomerSale[];
}

const FOLD = "translate(lower(coalesce(c.name, '')), 'áéíóúüñ', 'aeiouun')";
const MAX_QUERY = 60;

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Name (accent-insensitive), phone or CI/NIT contains the text. */
function searchClause(placeholderFold: string, placeholderRaw: string): string {
  return `(${FOLD} like ${placeholderFold} or coalesce(c.phone, '') like ${placeholderRaw} or coalesce(c.ci_nit, '') ilike ${placeholderRaw})`;
}

function mapOption(row: { id: string; name: string; phone: string | null; ci_nit: string | null }): CustomerOption {
  return { id: row.id, name: row.name, phone: row.phone, ciNit: row.ci_nit };
}

/** Quick lookup for the POS picker. Runs under the caller's role (branch rules are RLS). */
export async function searchCustomers(session: SessionPayload, query: string, limit = 8): Promise<CustomerOption[]> {
  const text = query.trim().slice(0, MAX_QUERY);
  if (!text) return [];
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select c.id, c.name, c.phone, c.ci_nit from customers c
        where c.active and ${searchClause("$1", "$2")}
        order by c.name limit $3`,
      [`%${escapeLike(foldText(text))}%`, `%${escapeLike(text)}%`, Math.min(Math.max(limit, 1), 20)],
    );
    return rows.map(mapOption);
  });
}

export async function listCustomers(
  session: SessionPayload,
  query: string | undefined,
  request: PageRequest,
): Promise<Page<CustomerRow>> {
  const text = (query ?? "").trim().slice(0, MAX_QUERY);
  return withUser(session, async (client) => {
    const filter = text ? `and ${searchClause("$1", "$2")}` : "";
    const filterValues = text ? [`%${escapeLike(foldText(text))}%`, `%${escapeLike(text)}%`] : [];
    const counted = await client.query<{ total: number }>(
      `select count(*)::int as total from customers c where c.active ${filter}`,
      filterValues,
    );
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);
    const offset = filterValues.length;
    const { rows } = await client.query(
      `select c.id, c.name, c.phone, c.ci_nit,
              coalesce(h.purchases, 0)::int as purchases, coalesce(h.spent, 0)::text as spent, h.last_at
         from customers c
         left join lateral (
           select count(*) as purchases, sum(s.total) as spent, max(s.created_at) as last_at
             from sales s where s.customer_id = c.id and s.status = 'completed'
         ) h on true
        where c.active ${filter}
        order by h.last_at desc nulls last, c.name
        limit $${offset + 1} offset $${offset + 2}`,
      [...filterValues, request.pageSize, (page - 1) * request.pageSize],
    );
    const mapped: CustomerRow[] = rows.map((row) => ({
      ...mapOption(row),
      purchases: row.purchases,
      spent: row.spent,
      lastPurchaseAt: row.last_at ? new Date(row.last_at).toISOString() : null,
    }));
    return buildPage(mapped, total, { page, pageSize: request.pageSize });
  });
}

export async function getCustomer(session: SessionPayload, id: string): Promise<CustomerDetail | null> {
  return withUser(session, async (client) => {
    const found = await client.query(
      "select id, name, phone, ci_nit, notes, created_at from customers where id = $1 and active",
      [id],
    );
    const row = found.rows[0];
    if (!row) return null;
    const sales = await client.query(
      `select s.id, s.sale_number, s.created_at, s.doc_type, s.status, s.total::text as total,
              (select coalesce(sum(i.qty), 0)::int from sale_items i where i.sale_id = s.id) as units
         from sales s where s.customer_id = $1
        order by s.created_at desc limit 100`,
      [id],
    );
    return {
      ...mapOption(row),
      notes: row.notes,
      createdAt: new Date(row.created_at).toISOString(),
      sales: sales.rows.map((sale) => ({
        id: sale.id,
        saleNumber: Number(sale.sale_number),
        createdAt: new Date(sale.created_at).toISOString(),
        docType: sale.doc_type,
        status: sale.status,
        total: sale.total,
        units: sale.units,
      })),
    };
  });
}

/** Sellers stamp their own branch; the superadmin's customers are shared (no branch). */
export async function createCustomer(session: SessionPayload, input: CustomerInput): Promise<CustomerOption> {
  const branchId = session.role === "seller" ? session.branchId : null;
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `insert into customers (branch_id, name, phone, ci_nit, notes) values ($1, $2, $3, $4, $5)
       returning id, name, phone, ci_nit`,
      [branchId, input.name, input.phone, input.ciNit, input.notes],
    );
    return mapOption(rows[0]);
  });
}

export async function updateCustomer(session: SessionPayload, id: string, input: CustomerInput): Promise<boolean> {
  return withUser(session, async (client) => {
    const result = await client.query(
      "update customers set name = $2, phone = $3, ci_nit = $4, notes = $5 where id = $1 and active",
      [id, input.name, input.phone, input.ciNit, input.notes],
    );
    return (result.rowCount ?? 0) > 0;
  });
}

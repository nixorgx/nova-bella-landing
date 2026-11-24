import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { D, dec, toMoney } from "@/lib/money";
import { buildPage, clampPage, type Page, type PageRequest } from "@/lib/pagination";
import { readSaleExchanges, type ExchangeGroup } from "@/features/exchanges/queries";
import type { PaymentMethod } from "./payments";

export type DocType = "factura" | "nota_venta";

export const DOC_LABEL: Readonly<Record<DocType, string>> = {
  factura: "Factura",
  nota_venta: "Nota de venta",
};

export interface SaleFilters {
  /** YYYY-MM-DD, inclusive, in La Paz time. */
  readonly from?: string;
  readonly to?: string;
  readonly sellerId?: string;
  readonly docType?: DocType;
  /** Superadmin only: sellers are always pinned to their own branch by RLS. */
  readonly branchId?: string;
}

export interface SaleRow {
  readonly id: string;
  readonly branchId: string;
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly docType: DocType;
  readonly status: "completed" | "voided";
  readonly total: string;
  readonly branchName: string;
  readonly sellerName: string | null;
  readonly customerName: string | null;
  readonly units: number;
  readonly methods: readonly PaymentMethod[];
  readonly hasExchanges: boolean;
  readonly channel: "store" | "web";
}

export interface VoidInfo {
  readonly reason: string | null;
  readonly voidedAt: string;
  readonly voidedByName: string | null;
}

export interface SaleLineDetail {
  readonly sku: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly qty: number;
  readonly listPrice: string;
  readonly finalPrice: string;
}

export interface SaleDetail extends Omit<SaleRow, "units" | "methods" | "hasExchanges"> {
  readonly exchanges: readonly ExchangeGroup[];
  readonly voidInfo: VoidInfo | null;
  readonly branchCity: string | null;
  readonly customer: { id: string; name: string; phone: string | null; ciNit: string | null } | null;
  readonly lines: readonly SaleLineDetail[];
  readonly payments: readonly { method: PaymentMethod; amount: string }[];
  readonly listTotal: string;
  readonly discount: string;
}

export interface SellerOption {
  readonly id: string;
  readonly name: string;
}

const TZ = "America/La_Paz";

function whereFor(filters: SaleFilters): { clause: string; values: unknown[] } {
  const values: unknown[] = [];
  const conditions: string[] = [];
  const add = (sql: (placeholder: string) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(`$${values.length}`));
  };
  if (filters.from) add((p) => `s.created_at >= (${p}::date)::timestamp at time zone '${TZ}'`, filters.from);
  if (filters.to) add((p) => `s.created_at < ((${p}::date) + 1)::timestamp at time zone '${TZ}'`, filters.to);
  if (filters.sellerId) add((p) => `s.seller_id = ${p}::uuid`, filters.sellerId);
  if (filters.docType) add((p) => `s.doc_type = ${p}`, filters.docType);
  if (filters.branchId) add((p) => `s.branch_id = ${p}::uuid`, filters.branchId);
  return { clause: conditions.length ? `where ${conditions.join(" and ")}` : "", values };
}

interface Row {
  id: string;
  branch_id: string;
  sale_number: string;
  created_at: Date;
  doc_type: DocType;
  status: "completed" | "voided";
  total: string;
  branch_name: string;
  seller_name: string | null;
  customer_name: string | null;
  units: number;
  methods: string | null;
  has_exchanges: boolean;
  channel: "store" | "web";
}

function mapRow(row: Row): SaleRow {
  return {
    id: row.id,
    branchId: row.branch_id,
    saleNumber: Number(row.sale_number),
    createdAt: row.created_at.toISOString(),
    docType: row.doc_type,
    status: row.status,
    total: row.total,
    branchName: row.branch_name,
    sellerName: row.seller_name,
    customerName: row.customer_name,
    units: row.units,
    methods: row.methods ? (row.methods.split(",") as PaymentMethod[]) : [],
    hasExchanges: row.has_exchanges,
    channel: row.channel,
  };
}

const SALE_SELECT = `
  select s.id, s.branch_id, s.sale_number, s.created_at, s.doc_type, s.status, s.total::text as total, s.channel,
         b.name as branch_name, td.full_name as seller_name, c.name as customer_name,
         (select coalesce(sum(i.qty), 0)::int from sale_items i where i.sale_id = s.id) as units,
         (select string_agg(distinct p.method, ',' order by p.method) from sale_payments p where p.sale_id = s.id) as methods,
         exists (select 1 from exchanges x where x.original_sale_id = s.id) as has_exchanges
    from sales s
    join branches b on b.id = s.branch_id
    left join team_directory() td on td.id = s.seller_id
    left join customers c on c.id = s.customer_id`;

export async function listSales(
  session: SessionPayload,
  filters: SaleFilters,
  request: PageRequest,
): Promise<Page<SaleRow>> {
  const { clause, values } = whereFor(filters);
  return withUser(session, async (client) => {
    const counted = await client.query<{ total: number }>(
      `select count(*)::int as total from sales s ${clause}`,
      values,
    );
    const total = counted.rows[0].total;
    const page = clampPage(request.page, total, request.pageSize);
    const { rows } = await client.query<Row>(
      `${SALE_SELECT} ${clause}
        order by s.created_at desc, s.sale_number desc
        limit $${values.length + 1} offset $${values.length + 2}`,
      [...values, request.pageSize, (page - 1) * request.pageSize],
    );
    return buildPage(rows.map(mapRow), total, { page, pageSize: request.pageSize });
  });
}

export async function listSellers(session: SessionPayload): Promise<SellerOption[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string; full_name: string }>(
      `select t.id, t.full_name from team_directory() t
        where t.id in (select seller_id from sales) order by t.full_name`,
    );
    return rows.map((row) => ({ id: row.id, name: row.full_name }));
  });
}

/** Sale with everything a receipt needs. Prices charged only: no cost column is ever read. */
export async function getSaleDetail(session: SessionPayload, id: string): Promise<SaleDetail | null> {
  return withUser(session, async (client) => {
    const sale = await client.query<
      Row & { branch_city: string | null; customer_id: string | null; void_reason: string | null; voided_at: Date | null; voided_by_name: string | null }
    >(
      `select s.id, s.branch_id, s.sale_number, s.created_at, s.doc_type, s.status, s.total::text as total, s.channel,
              b.name as branch_name, b.city as branch_city, td.full_name as seller_name,
              c.id as customer_id, c.name as customer_name, 0 as units, null as methods, false as has_exchanges,
              s.void_reason, s.voided_at, vb.full_name as voided_by_name
         from sales s
         left join team_directory() vb on vb.id = s.voided_by
         join branches b on b.id = s.branch_id
         left join team_directory() td on td.id = s.seller_id
         left join customers c on c.id = s.customer_id
        where s.id = $1`,
      [id],
    );
    const row = sale.rows[0];
    if (!row) return null;
    const customer = row.customer_id
      ? (await client.query("select id, name, phone, ci_nit from customers where id = $1", [row.customer_id])).rows[0]
      : null;
    const lines = await client.query(
      `select v.sku, m.name as model, c.name as color, z.label as size, i.qty,
              i.list_price::text as list_price, i.final_price::text as final_price
         from sale_items i
         join variants v on v.id = i.variant_id
         join models m on m.id = v.model_id
         join colors c on c.id = v.color_id
         join sizes z on z.id = v.size_id
        where i.sale_id = $1 order by m.name, c.name, z.sort_order, v.sku`,
      [id],
    );
    const payments = await client.query<{ method: PaymentMethod; amount: string }>(
      "select method, amount::text as amount from sale_payments where sale_id = $1 order by amount desc, method",
      [id],
    );
    const lineDetails: SaleLineDetail[] = lines.rows.map((l) => ({
      sku: l.sku,
      model: l.model,
      color: l.color,
      size: l.size,
      qty: l.qty,
      listPrice: l.list_price,
      finalPrice: l.final_price,
    }));
    const { listTotal, discount } = totalsOf(lineDetails, row.total);
    const exchanges = await readSaleExchanges(client, id);
    const base = mapRow(row);
    return {
      id: base.id,
      branchId: base.branchId,
      saleNumber: base.saleNumber,
      createdAt: base.createdAt,
      docType: base.docType,
      channel: base.channel,
      status: base.status,
      total: base.total,
      branchName: base.branchName,
      sellerName: base.sellerName,
      customerName: base.customerName,
      branchCity: row.branch_city,
      customer: customer ? { id: customer.id, name: customer.name, phone: customer.phone, ciNit: customer.ci_nit } : null,
      lines: lineDetails,
      payments: payments.rows,
      listTotal,
      discount,
      exchanges,
      voidInfo: row.voided_at
        ? { reason: row.void_reason, voidedAt: row.voided_at.toISOString(), voidedByName: row.voided_by_name }
        : null,
    };
  });
}


function totalsOf(lines: readonly SaleLineDetail[], total: string): { listTotal: string; discount: string } {
  const list = lines.reduce((sum, l) => sum.plus(dec(l.listPrice).times(l.qty)), new D(0));
  return { listTotal: toMoney(list), discount: toMoney(list.minus(total)) };
}

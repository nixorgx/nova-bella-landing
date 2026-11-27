import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { subMoney, toMoney } from "@/lib/money";
import type { DocType } from "@/features/sales/queries";
import { inRangeSql, ownerSql, scopeValues, type ReportScope } from "./scope";

/** Hard ceiling of rows in any export (the file is built in memory). */
export const MAX_EXPORT_ROWS = 20_000;

export class ExportTooLargeError extends Error {
  constructor() {
    super(`El período tiene más de ${MAX_EXPORT_ROWS.toLocaleString("es-BO")} filas. Elija un rango más corto.`);
    this.name = "ExportTooLargeError";
  }
}

/** Fetches up to the ceiling + 1 and fails loudly instead of silently cutting the data. */
export function assertWithinLimit<T>(rows: readonly T[]): readonly T[] {
  if (rows.length > MAX_EXPORT_ROWS) throw new ExportTooLargeError();
  return rows;
}

export interface SaleExportRow {
  readonly saleNumber: number;
  readonly createdAt: string;
  readonly branchName: string;
  readonly sellerName: string | null;
  readonly customerName: string | null;
  readonly docType: DocType;
  readonly status: "completed" | "voided";
  readonly units: number;
  readonly listTotal: string;
  readonly discount: string;
  readonly total: string;
  readonly efectivo: string;
  readonly qr: string;
  readonly transferencia: string;
  readonly tarjeta: string;
  readonly voidReason: string | null;
  readonly channel: "store" | "web";
}

/** One row per sale (voided ones included, flagged) with the payment split in four columns. Seller-safe. */
export async function listSalesForExport(session: SessionPayload, scope: ReportScope): Promise<readonly SaleExportRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select s.sale_number, s.created_at, b.name as branch_name, td.full_name as seller_name, c.name as customer_name,
              s.doc_type, s.status, s.total::text as total, s.void_reason, s.channel,
              coalesce(u.units, 0)::int as units, coalesce(u.list, 0)::text as list_total,
              coalesce(p.efectivo, 0)::text as efectivo, coalesce(p.qr, 0)::text as qr,
              coalesce(p.transferencia, 0)::text as transferencia, coalesce(p.tarjeta, 0)::text as tarjeta
         from sales s
         join branches b on b.id = s.branch_id
         left join team_directory() td on td.id = s.seller_id
         left join customers c on c.id = s.customer_id
         left join lateral (select sum(i.qty) as units, sum(i.qty * i.list_price) as list from sale_items i where i.sale_id = s.id) u on true
         left join lateral (
           select sum(x.amount) filter (where x.method = 'efectivo') as efectivo, sum(x.amount) filter (where x.method = 'qr') as qr,
                  sum(x.amount) filter (where x.method = 'transferencia') as transferencia,
                  sum(x.amount) filter (where x.method = 'tarjeta') as tarjeta
             from sale_payments x where x.sale_id = s.id) p on true
        where ${inRangeSql("s.created_at")} and ${ownerSql("s.branch_id", "s.seller_id")}
        order by s.created_at, s.sale_number limit $6`,
      [...scopeValues(scope), MAX_EXPORT_ROWS + 1],
    );
    return assertWithinLimit(
      rows.map(
        (row): SaleExportRow => ({
          saleNumber: Number(row.sale_number),
          createdAt: row.created_at.toISOString(),
          branchName: row.branch_name,
          sellerName: row.seller_name,
          customerName: row.customer_name,
          docType: row.doc_type,
          status: row.status,
          units: row.units,
          listTotal: toMoney(row.list_total),
          discount: subMoney(row.list_total, row.total),
          total: toMoney(row.total),
          efectivo: toMoney(row.efectivo),
          qr: toMoney(row.qr),
          transferencia: toMoney(row.transferencia),
          tarjeta: toMoney(row.tarjeta),
          voidReason: row.void_reason,
          channel: row.channel,
        }),
      ),
    );
  });
}

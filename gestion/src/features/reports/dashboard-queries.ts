import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { todayKey } from "@/lib/format";
import { stockState } from "@/lib/stock-state";
import { listOpenSessionReports, type CashSessionReport } from "@/features/cash/session-report";
import type { DailyPoint } from "./aggregate";
import { getProfitSummary, type ProfitSummary } from "./cost-queries";
import { previousMonthSpan } from "./period";
import {
  getDailySales,
  getModelSizeSales,
  getSalesSummary,
  getStockVariants,
  totalsByModel,
  type ModelTotal,
  type SalesSummary,
  type StockVariantRow,
} from "./queries";
import type { ReportScope } from "./scope";

export interface MovementRow {
  readonly id: string;
  readonly createdAt: string;
  readonly type: string;
  readonly qty: number;
  readonly product: string;
  readonly branchName: string;
  readonly userName: string | null;
}

export const MOVEMENT_LABEL: Readonly<Record<string, string>> = {
  purchase: "Ingreso de lote",
  sale: "Venta",
  exchange_in: "Cambio: vuelve",
  exchange_out: "Cambio: sale",
  void: "Venta anulada",
  adjust: "Ajuste",
  transfer: "Transferencia",
};

/** Last stock movements of everything the superadmin can see (or of one branch). */
export async function listRecentMovements(session: SessionPayload, limit = 8, branchId: string | null = null): Promise<MovementRow[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select sm.id, sm.created_at, sm.type, sm.qty, b.name as branch_name, td.full_name as user_name,
              m.name || ' ' || c.name || ' T' || z.label as product
         from stock_movements sm
         join variants v on v.id = sm.variant_id join models m on m.id = v.model_id
         join colors c on c.id = v.color_id join sizes z on z.id = v.size_id
         join branches b on b.id = sm.branch_id
         left join team_directory() td on td.id = sm.created_by
        where ($2::uuid is null or sm.branch_id = $2::uuid)
        order by sm.created_at desc, sm.id limit $1`,
      [limit, branchId],
    );
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.created_at.toISOString(),
      type: row.type,
      qty: row.qty,
      product: row.product,
      branchName: row.branch_name,
      userName: row.user_name,
    }));
  });
}

export interface DashboardData {
  readonly today: string;
  readonly month: SalesSummary;
  readonly previousMonth: SalesSummary;
  readonly profit: ProfitSummary;
  readonly daily: readonly DailyPoint[];
  readonly previousDaily: readonly DailyPoint[];
  readonly lowStock: readonly StockVariantRow[];
  readonly outCount: number;
  readonly lowCount: number;
  readonly topModels: readonly ModelTotal[];
  readonly openCash: readonly CashSessionReport[];
  readonly movements: readonly MovementRow[];
}

/**
 * Everything the superadmin dashboard shows, fetched in parallel (month to date vs the same span of
 * last month). `branchId` limits every figure to one branch; null = all branches.
 */
export async function getDashboard(
  session: SessionPayload,
  today: string = todayKey(),
  branchId: string | null = null,
): Promise<DashboardData> {
  if (session.role !== "superadmin") throw new Error("El dashboard es solo para el superadmin.");
  const scope = { branchId, sellerId: null, channel: null } satisfies Pick<ReportScope, "branchId" | "sellerId" | "channel">;
  const month: ReportScope = { from: `${today.slice(0, 7)}-01`, to: today, ...scope };
  const span = previousMonthSpan(today);
  const previous: ReportScope = { from: span.from, to: span.to, ...scope };
  const [monthSummary, previousSummary, profit, daily, previousDaily, stock, models, openCash, movements] = await Promise.all([
    getSalesSummary(session, month),
    getSalesSummary(session, previous),
    getProfitSummary(session, month),
    getDailySales(session, month),
    getDailySales(session, previous),
    getStockVariants(session, branchId),
    getModelSizeSales(session, month),
    listOpenSessionReports(session, branchId),
    listRecentMovements(session, 8, branchId),
  ]);
  const attention = stock.filter((row) => stockState(row.qty) !== "ok").sort((a, b) => a.qty - b.qty || a.model.localeCompare(b.model));
  return {
    today,
    month: monthSummary,
    previousMonth: previousSummary,
    profit,
    daily,
    previousDaily,
    lowStock: attention.slice(0, 6),
    outCount: attention.filter((row) => stockState(row.qty) === "out").length,
    lowCount: attention.filter((row) => stockState(row.qty) === "low").length,
    topModels: totalsByModel(models).slice(0, 5),
    openCash,
    movements,
  };
}

import type ExcelJS from "exceljs";
import { toSession, type AuthUser } from "@/lib/auth/guards";
import { formatDateTime } from "@/lib/format";
import { uuidParam, type RawSearchParams } from "@/lib/search-params";
import { listBranchOptions } from "@/features/branches/queries";
import { getCashSessionReport, listCashSessionsForExport, listSessionSales } from "@/features/cash/session-report";
import { getProfitByModel, getProfitSummary, getStockCosts, listPurchaseRows } from "../cost-queries";
import { assertWithinLimit, listSalesForExport, MAX_EXPORT_ROWS } from "../export-queries";
import {
  getModelSizeSales,
  getSalesSummary,
  getStockVariants,
  listExchangesInPeriod,
  listVoidsInPeriod,
} from "../queries";
import { readReportFilters, scopeFor } from "../scope";
import { buildCashWorkbook, buildProfitWorkbook, buildPurchasesWorkbook, buildStockWorkbook, buildStockWorkbookWithCost } from "./other-books";
import { buildSalesWorkbook } from "./sales-book";
import { toBuffer } from "./workbook";

export const EXPORT_REPORTS = ["ventas", "stock", "compras", "rentabilidad", "caja"] as const;
export type ExportReport = (typeof EXPORT_REPORTS)[number];

/** Reports that contain cost data: the superadmin only. The seller gets a 403 before any query runs. */
const COST_REPORTS: ReadonlySet<ExportReport> = new Set(["compras", "rentabilidad"]);

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export class ExportForbiddenError extends Error {
  constructor() {
    super("Este reporte contiene costos y solo está disponible para el superadmin.");
    this.name = "ExportForbiddenError";
  }
}

export function isExportReport(value: string): value is ExportReport {
  return (EXPORT_REPORTS as readonly string[]).includes(value);
}

export interface BuiltExport {
  readonly filename: string;
  readonly buffer: Buffer;
}

async function branchLabel(user: AuthUser, branchId: string | null): Promise<string> {
  if (user.role === "seller") return user.branchName ?? "Mi sucursal";
  if (!branchId) return "Todas las sucursales";
  const branches = await listBranchOptions(toSession(user), { includeInactive: true });
  return branches.find((b) => b.id === branchId)?.name ?? "Sucursal";
}

async function build(user: AuthUser, report: ExportReport, params: RawSearchParams): Promise<{ book: ExcelJS.Workbook; stem: string }> {
  const session = toSession(user);
  const filters = readReportFilters(params);
  const scope = scopeFor(session, filters.period, filters);
  const branch = await branchLabel(user, scope.branchId);
  const stem = `${filters.period.from}_${filters.period.to}`;
  const generated: [string, string] = ["Generado", formatDateTime(new Date().toISOString())];
  const periodMeta = [["Período", filters.period.label], ["Sucursal", branch], ...(filters.channel ? [["Canal", filters.channel === "web" ? "Tienda web" : "Tienda física"]] : []), generated] as [string, string][];

  switch (report) {
    case "ventas": {
      const [summary, sales, modelSizes, exchanges, voids] = await Promise.all([
        getSalesSummary(session, scope),
        listSalesForExport(session, scope),
        getModelSizeSales(session, scope),
        listExchangesInPeriod(session, scope, MAX_EXPORT_ROWS + 1),
        listVoidsInPeriod(session, scope, MAX_EXPORT_ROWS + 1),
      ]);
      const meta: [string, string][] = [...periodMeta, ["Alcance", user.role === "seller" ? `Mis ventas (${user.fullName})` : "Todas las ventas"]];
      const book = buildSalesWorkbook({ meta, summary, sales, modelSizes, exchanges: assertWithinLimit(exchanges), voids: assertWithinLimit(voids) });
      return { book, stem: `ventas-${stem}` };
    }
    case "stock": {
      const rows = await getStockVariants(session, scope.branchId);
      const stockMeta: [string, string][] = [["Sucursal", branch], generated];
      if (user.role === "seller") return { book: buildStockWorkbook(stockMeta, rows), stem: "stock" };
      return { book: buildStockWorkbookWithCost(stockMeta, rows, await getStockCosts(session, scope.branchId)), stem: "stock" };
    }
    case "compras": {
      const rows = assertWithinLimit(await listPurchaseRows(session, { from: filters.period.from, to: filters.period.to, branchId: scope.branchId }, MAX_EXPORT_ROWS + 1));
      return { book: buildPurchasesWorkbook(periodMeta, rows), stem: `compras-${stem}` };
    }
    case "rentabilidad": {
      const [profit, models] = await Promise.all([getProfitSummary(session, scope), getProfitByModel(session, scope)]);
      return { book: buildProfitWorkbook(periodMeta, profit, models), stem: `rentabilidad-${stem}` };
    }
    case "caja": {
      const sessionId = uuidParam(params.sesion);
      if (sessionId) {
        const one = await getCashSessionReport(session, sessionId);
        if (!one) throw new RangeError("No se encontró esa caja.");
        const sales = await listSessionSales(session, sessionId);
        return { book: buildCashWorkbook([["Caja", one.branchName], generated], [one], sales), stem: `caja-${one.openedAt.slice(0, 10)}` };
      }
      const cashier = user.role === "superadmin" ? uuidParam(params.cajero) : undefined;
      const sessions = assertWithinLimit(
        await listCashSessionsForExport(session, { from: filters.period.from, to: filters.period.to, branchId: scope.branchId ?? undefined, openedBy: cashier }, MAX_EXPORT_ROWS + 1),
      );
      return { book: buildCashWorkbook(periodMeta, sessions), stem: `cajas-${stem}` };
    }
  }
}

/** Authorizes, queries (role-scoped at query level) and renders one workbook. */
export async function buildExport(user: AuthUser, report: ExportReport, params: RawSearchParams): Promise<BuiltExport> {
  if (COST_REPORTS.has(report) && user.role !== "superadmin") throw new ExportForbiddenError();
  const { book, stem } = await build(user, report, params);
  return { filename: `${stem}.xlsx`, buffer: await toBuffer(book) };
}

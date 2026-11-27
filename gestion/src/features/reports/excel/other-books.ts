import type ExcelJS from "exceljs";
import { dec, sumMoney, toMoney } from "@/lib/money";
import { LOW_STOCK_THRESHOLD, STOCK_LABEL, stockState } from "@/lib/stock-state";
import { saleNumberLabel } from "@/lib/format";
import { PAYMENT_LABEL } from "@/features/sales/payments";
import { marginPct, type ProfitResult } from "../aggregate";
import type { CashSessionReport, SessionSaleRow } from "@/features/cash/session-report";
import type { ModelProfitRow, PurchaseExportRow, StockCostRow } from "../cost-queries";
import type { StockVariantRow } from "../queries";
import { addGrid, addMetaRows, addSummaryRows } from "./sheet-kit";
import { addTableSheet, createWorkbook, type ColumnDef } from "./workbook";

type Meta = readonly [string, string][];

// ---------------------------------------------------------------- stock (both roles)

const stockState_ = (qty: number) => STOCK_LABEL[stockState(qty)];

const SELLER_STOCK_COLUMNS: readonly ColumnDef<StockVariantRow>[] = [
  { header: "SKU", width: 22, kind: "text", value: (r) => r.sku },
  { header: "Modelo", width: 24, kind: "text", value: (r) => r.model },
  { header: "Línea", width: 14, kind: "text", value: (r) => r.line },
  { header: "Color", width: 16, kind: "text", value: (r) => r.color },
  { header: "Talla", width: 8, kind: "text", value: (r) => r.size },
  { header: "Cantidad", width: 10, kind: "int", value: (r) => r.qty, total: "sum" },
  { header: "Precio de venta", width: 16, kind: "money", value: (r) => r.price },
  { header: "Estado", width: 13, kind: "text", value: (r) => stockState_(r.qty) },
];

/** Stock workbook WITHOUT any cost column (sellers, and the default for everybody). */
export function buildStockWorkbook(meta: Meta, rows: readonly StockVariantRow[]): ExcelJS.Workbook {
  const book = createWorkbook("Stock");
  const summary = book.addWorksheet("Resumen");
  const start = addMetaRows(summary, "Stock actual", meta);
  const low = rows.filter((r) => r.qty > 0 && r.qty <= LOW_STOCK_THRESHOLD).length;
  const out = rows.filter((r) => r.qty <= 0).length;
  addSummaryRows(summary, start, [
    { label: "Pares en stock", value: { formula: "SUM(Stock!F:F)", result: rows.reduce((n, r) => n + r.qty, 0) }, format: "int" },
    { label: `Variantes con stock bajo (≤ ${LOW_STOCK_THRESHOLD})`, value: low, format: "int" },
    { label: "Variantes agotadas", value: out, format: "int" },
  ]);
  addTableSheet(book, "Stock", SELLER_STOCK_COLUMNS, rows);
  return book;
}

const COST_STOCK_COLUMNS: readonly ColumnDef<StockCostRow>[] = [
  { header: "SKU", width: 22, kind: "text", value: (r) => r.sku },
  { header: "Modelo", width: 24, kind: "text", value: (r) => r.model },
  { header: "Color", width: 16, kind: "text", value: (r) => r.color },
  { header: "Talla", width: 8, kind: "text", value: (r) => r.size },
  { header: "Cantidad", width: 10, kind: "int", value: (r) => r.qty, total: "sum" },
  { header: "Costo promedio", width: 16, kind: "money", value: (r) => r.avgCost },
  { header: "Último costo", width: 14, kind: "money", value: (r) => r.lastCost },
  {
    header: "Valor a costo",
    width: 15,
    kind: "money",
    value: (r) => (r.avgCost === null ? null : dec(r.avgCost).times(r.qty).toFixed(2)),
    formula: (_r, row) => `E${row}*F${row}`,
    total: "sum",
  },
];

/** Superadmin stock workbook: the seller-safe one plus a "Costos" sheet valued at average cost. */
export function buildStockWorkbookWithCost(meta: Meta, rows: readonly StockVariantRow[], costs: readonly StockCostRow[]): ExcelJS.Workbook {
  const book = buildStockWorkbook(meta, rows);
  addTableSheet(book, "Costos", COST_STOCK_COLUMNS, costs, { tabColor: "FF55399A" });
  return book;
}

// ---------------------------------------------------------------- purchases (superadmin)

const PURCHASE_COLUMNS: readonly ColumnDef<PurchaseExportRow>[] = [
  { header: "Fecha del lote", width: 14, kind: "date", value: (r) => r.batchDate },
  { header: "Proveedor", width: 24, kind: "text", value: (r) => r.supplier },
  { header: "Sucursal", width: 14, kind: "text", value: (r) => r.branchName },
  { header: "TC 70%", width: 9, kind: "text", value: (r) => r.rate70 },
  { header: "TC 30%", width: 9, kind: "text", value: (r) => r.rate30 },
  { header: "% a TC 1", width: 9, kind: "text", value: (r) => r.splitPct },
  { header: "SKU", width: 22, kind: "text", value: (r) => r.sku },
  { header: "Modelo", width: 22, kind: "text", value: (r) => r.model },
  { header: "Color", width: 14, kind: "text", value: (r) => r.color },
  { header: "Talla", width: 8, kind: "text", value: (r) => r.size },
  { header: "Cantidad", width: 10, kind: "int", value: (r) => r.qty, total: "sum" },
  { header: "Costo USD c/u", width: 14, kind: "text", value: (r) => r.unitCostUsd },
  { header: "Costo Bs c/u (puesto en tienda)", width: 26, kind: "money", value: (r) => r.unitCostBs },
  {
    header: "Total Bs",
    width: 15,
    kind: "money",
    value: (r) => dec(r.unitCostBs).times(r.qty).toFixed(2),
    formula: (_r, row) => `K${row}*M${row}`,
    total: "sum",
  },
];

export function buildPurchasesWorkbook(meta: Meta, rows: readonly PurchaseExportRow[]): ExcelJS.Workbook {
  const book = createWorkbook("Compras y costos");
  const summary = book.addWorksheet("Resumen");
  const start = addMetaRows(summary, "Compras y costos (solo superadmin)", meta);
  addSummaryRows(summary, start, [
    { label: "Pares comprados", value: { formula: "SUM(Compras!K:K)", result: rows.reduce((n, r) => n + r.qty, 0) }, format: "int" },
    { label: "Total puesto en tienda (Bs)", value: { formula: "SUM(Compras!N:N)", result: Number(sumMoney(rows.map((r) => dec(r.unitCostBs).times(r.qty).toFixed(2)))) }, format: "money" },
  ]);
  addTableSheet(book, "Compras", PURCHASE_COLUMNS, rows, { tabColor: "FF55399A" });
  return book;
}

// ---------------------------------------------------------------- profit (superadmin)

const PROFIT_COLUMNS: readonly ColumnDef<ModelProfitRow>[] = [
  { header: "Modelo", width: 26, kind: "text", value: (r) => r.model },
  { header: "Línea", width: 14, kind: "text", value: (r) => r.line },
  { header: "Pares", width: 9, kind: "int", value: (r) => r.units, total: "sum" },
  { header: "Ingreso", width: 15, kind: "money", value: (r) => r.revenue, total: "sum" },
  { header: "Costo", width: 15, kind: "money", value: (r) => r.cost, total: "sum" },
  { header: "Utilidad", width: 15, kind: "money", value: (r) => r.profit, formula: (_r, row) => `D${row}-E${row}`, total: "sum" },
  {
    header: "Margen",
    width: 10,
    kind: "percent",
    value: (r) => (r.marginPct === null ? null : Number(r.marginPct) / 100),
    formula: (_r, row) => `IF(D${row}>0,F${row}/D${row},0)`,
  },
];

export function buildProfitWorkbook(meta: Meta, profit: ProfitResult, models: readonly ModelProfitRow[]): ExcelJS.Workbook {
  const book = createWorkbook("Rentabilidad");
  const summary = book.addWorksheet("Resumen", { properties: { tabColor: { argb: "FF55399A" } } });
  const start = addMetaRows(summary, "Costo, margen y utilidad (solo superadmin)", meta);
  addSummaryRows(summary, start, [
    { label: "Ingresos (ventas + diferencias de cambios)", value: Number(profit.revenue), format: "money" },
    { label: "Costo de lo vendido (costo al momento de la venta)", value: Number(profit.cost), format: "money" },
    { label: "Utilidad", value: { formula: `B${start}-B${start + 1}`, result: Number(profit.profit) }, format: "money" },
    {
      label: "Margen sobre ingresos",
      value: { formula: `IF(B${start}>0,B${start + 2}/B${start},0)`, result: profit.marginPct === null ? 0 : Number(profit.marginPct) / 100 },
      format: "percent",
    },
  ]);
  summary.getColumn(1).width = 52;
  addTableSheet(book, "Por modelo", PROFIT_COLUMNS, models, { tabColor: "FF55399A" });
  return book;
}

export const modelMargin = (row: Pick<ModelProfitRow, "revenue" | "cost">): string | null => marginPct(row.revenue, row.cost);

// ---------------------------------------------------------------- cash

const CASH_COLUMNS: readonly ColumnDef<CashSessionReport>[] = [
  { header: "Sucursal", width: 14, kind: "text", value: (r) => r.branchName },
  { header: "Cajero", width: 20, kind: "text", value: (r) => r.openedByName },
  { header: "Apertura", width: 17, kind: "datetime", value: (r) => r.openedAt },
  { header: "Cierre", width: 17, kind: "datetime", value: (r) => r.closedAt },
  { header: "Efectivo inicial", width: 15, kind: "money", value: (r) => r.openingAmount, total: "sum" },
  ...(["efectivo", "qr", "transferencia", "tarjeta"] as const).map(
    (method): ColumnDef<CashSessionReport> => ({
      header: `Ventas ${PAYMENT_LABEL[method]}`,
      width: 15,
      kind: "money",
      value: (r) => r.methods.find((m) => m.method === method)?.sales,
      total: "sum",
    }),
  ),
  { header: "Cambios en efectivo (neto)", width: 20, kind: "money", value: (r) => r.methods[0].exchanges, total: "sum" },
  {
    header: "Efectivo esperado",
    width: 16,
    kind: "money",
    value: (r) => r.expectedCash,
    formula: (_r, row) => `E${row}+F${row}+J${row}`,
    total: "sum",
  },
  { header: "Efectivo contado", width: 16, kind: "money", value: (r) => r.closingAmount, total: "sum" },
  {
    header: "Diferencia",
    width: 13,
    kind: "money",
    value: (r) => r.difference,
    formula: (_r, row) => `IF(L${row}="","",L${row}-K${row})`,
  },
  { header: "Ventas", width: 8, kind: "int", value: (r) => r.salesCount, total: "sum" },
  { header: "Anuladas", width: 9, kind: "int", value: (r) => r.voidCount, total: "sum" },
];

const SESSION_SALE_COLUMNS: readonly ColumnDef<SessionSaleRow>[] = [
  { header: "N°", width: 10, kind: "text", value: (r) => saleNumberLabel(r.saleNumber) },
  { header: "Hora", width: 17, kind: "datetime", value: (r) => r.createdAt },
  { header: "Vendedor", width: 20, kind: "text", value: (r) => r.sellerName },
  { header: "Cliente", width: 26, kind: "text", value: (r) => r.customerName ?? "Sin cliente" },
  { header: "Pagos", width: 26, kind: "text", value: (r) => r.methods.map((m) => PAYMENT_LABEL[m]).join(", ") },
  { header: "Estado", width: 12, kind: "text", value: (r) => (r.status === "voided" ? "Anulada" : "Completada") },
  { header: "Total", width: 14, kind: "money", value: (r) => r.total, total: "sum" },
  { header: "Motivo de anulación", width: 34, kind: "text", value: (r) => r.voidReason },
];

export function buildCashWorkbook(meta: Meta, sessions: readonly CashSessionReport[], sales?: readonly SessionSaleRow[]): ExcelJS.Workbook {
  const book = createWorkbook("Cajas");
  const summary = book.addWorksheet("Resumen");
  const start = addMetaRows(summary, "Cajas", meta);
  const totalSales = sumMoney(sessions.map((s) => s.salesTotal));
  addSummaryRows(summary, start, [
    { label: "Cajas en el reporte", value: sessions.length, format: "int" },
    { label: "Total vendido (sin anuladas)", value: Number(totalSales), format: "money" },
    { label: "Efectivo esperado total", value: Number(sumMoney(sessions.map((s) => s.expectedCash))), format: "money" },
  ]);
  addTableSheet(book, "Cajas", CASH_COLUMNS, sessions);
  if (sales) addTableSheet(book, "Ventas de la caja", SESSION_SALE_COLUMNS, sales, { totalsWhere: { columnIndex: 5, equals: "Completada" } });
  return book;
}

export { addGrid, toMoney };

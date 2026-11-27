import type ExcelJS from "exceljs";
import { sumMoney } from "@/lib/money";
import { DOC_LABEL } from "@/features/sales/queries";
import { PAYMENT_LABEL, PAYMENT_METHODS } from "@/features/sales/payments";
import { saleNumberLabel } from "@/lib/format";
import { buildHeatmap } from "../aggregate";
import type { SaleExportRow } from "../export-queries";
import type { ExchangeReportRow, ModelSizeRow, SalesSummary, VoidReportRow } from "../queries";
import { addGrid, addMetaRows, addSummaryRows } from "./sheet-kit";
import { addTableSheet, createWorkbook, type ColumnDef } from "./workbook";

export interface SalesBookData {
  readonly meta: readonly [string, string][];
  readonly summary: SalesSummary;
  readonly sales: readonly SaleExportRow[];
  readonly modelSizes: readonly ModelSizeRow[];
  readonly exchanges: readonly ExchangeReportRow[];
  readonly voids: readonly VoidReportRow[];
}

const STATUS_LABEL = { completed: "Completada", voided: "Anulada" } as const;

const SALE_COLUMNS: readonly ColumnDef<SaleExportRow>[] = [
  { header: "N°", width: 10, kind: "text", value: (r) => saleNumberLabel(r.saleNumber) },
  { header: "Fecha", width: 17, kind: "datetime", value: (r) => r.createdAt },
  { header: "Sucursal", width: 14, kind: "text", value: (r) => r.branchName },
  { header: "Vendedor", width: 20, kind: "text", value: (r) => r.sellerName },
  { header: "Cliente", width: 26, kind: "text", value: (r) => r.customerName ?? "Sin cliente" },
  { header: "Documento", width: 15, kind: "text", value: (r) => DOC_LABEL[r.docType] },
  { header: "Estado", width: 12, kind: "text", value: (r) => STATUS_LABEL[r.status] },
  { header: "Pares", width: 8, kind: "int", value: (r) => r.units, total: "sum" },
  { header: "Subtotal lista", width: 15, kind: "money", value: (r) => r.listTotal, total: "sum" },
  { header: "Descuento", width: 13, kind: "money", value: (r) => r.discount, total: "sum" },
  { header: "Total", width: 14, kind: "money", value: (r) => r.total, total: "sum" },
  ...PAYMENT_METHODS.map(
    (method): ColumnDef<SaleExportRow> => ({
      header: PAYMENT_LABEL[method],
      width: 14,
      kind: "money",
      value: (r) => r[method],
      total: "sum",
    }),
  ),
  { header: "Motivo de anulación", width: 34, kind: "text", value: (r) => r.voidReason },
  // Appended last on purpose: the formulas above refer to fixed column letters.
  { header: "Canal", width: 14, kind: "text", value: (r) => (r.channel === "web" ? "Tienda web" : "Tienda física") },
];

const COL = { status: "G", units: "H", total: "K", firstMethod: 12 } as const; // columns of SALE_COLUMNS used by formulas
const letterOfMethod = (index: number): string => String.fromCharCode(64 + COL.firstMethod + index);

const EXCHANGE_COLUMNS: readonly ColumnDef<ExchangeReportRow>[] = [
  { header: "Fecha", width: 17, kind: "datetime", value: (r) => r.createdAt },
  { header: "Venta N°", width: 10, kind: "text", value: (r) => saleNumberLabel(r.saleNumber) },
  { header: "Devuelto", width: 30, kind: "text", value: (r) => r.returned },
  { header: "Entregado", width: 30, kind: "text", value: (r) => r.replacement },
  { header: "Cant.", width: 7, kind: "int", value: (r) => r.qty, total: "sum" },
  { header: "Diferencia", width: 13, kind: "money", value: (r) => r.priceDiff, total: "sum" },
  { header: "Método", width: 14, kind: "text", value: (r) => (r.method ? PAYMENT_LABEL[r.method] : "Sin diferencia") },
  { header: "Motivo", width: 30, kind: "text", value: (r) => r.reason },
  { header: "Registrado por", width: 20, kind: "text", value: (r) => r.userName },
];

const VOID_COLUMNS: readonly ColumnDef<VoidReportRow>[] = [
  { header: "Venta N°", width: 10, kind: "text", value: (r) => saleNumberLabel(r.saleNumber) },
  { header: "Fecha de venta", width: 17, kind: "datetime", value: (r) => r.createdAt },
  { header: "Anulada", width: 17, kind: "datetime", value: (r) => r.voidedAt },
  { header: "Total", width: 14, kind: "money", value: (r) => r.total, total: "sum" },
  { header: "Motivo", width: 38, kind: "text", value: (r) => r.reason },
  { header: "Vendedor", width: 20, kind: "text", value: (r) => r.sellerName },
  { header: "Anulada por", width: 20, kind: "text", value: (r) => r.voidedByName },
];

function addSummarySheet(book: ExcelJS.Workbook, data: SalesBookData): void {
  const sheet = book.addWorksheet("Resumen", { properties: { tabColor: { argb: "FFB2411A" } } });
  let row = addMetaRows(sheet, "Reporte de ventas", data.meta);
  const done = `Ventas!$${COL.status}:$${COL.status},"Completada"`;
  const s = data.summary;
  row = addSummaryRows(sheet, row, [
    { label: "Ventas realizadas", value: { formula: `COUNTIFS(${done})`, result: s.count }, format: "int" },
    { label: "Monto vendido", value: { formula: `SUMIFS(Ventas!$${COL.total}:$${COL.total},${done})`, result: Number(s.amount) }, format: "money" },
    { label: "Ticket promedio", value: { formula: `IFERROR(B${row + 1}/B${row},0)`, result: Number(s.averageTicket) }, format: "money" },
    { label: "Pares vendidos", value: { formula: `SUMIFS(Ventas!$${COL.units}:$${COL.units},${done})`, result: s.units }, format: "int" },
    { label: "Ventas anuladas (no suman)", value: { formula: `COUNTIFS(Ventas!$${COL.status}:$${COL.status},"Anulada")`, result: s.voidCount }, format: "int" },
  ]);
  const rows = s.methods.map((m, index) => {
    const excelRow = row + 1 + index;
    const letter = letterOfMethod(index);
    return [
      PAYMENT_LABEL[m.method],
      { formula: `SUMIFS(Ventas!$${letter}:$${letter},${done})`, result: Number(m.sales) },
      { formula: `SUMIFS(Cambios!$F:$F,Cambios!$G:$G,"${PAYMENT_LABEL[m.method]}")`, result: Number(m.exchanges) },
      { formula: `B${excelRow}+C${excelRow}`, result: Number(m.net) },
    ];
  });
  const first = row + 1;
  const last = row + rows.length;
  rows.push([
    "TOTAL COBRADO",
    { formula: `SUM(B${first}:B${last})`, result: Number(sumMoney(s.methods.map((m) => m.sales))) },
    { formula: `SUM(C${first}:C${last})`, result: Number(sumMoney(s.methods.map((m) => m.exchanges))) },
    { formula: `SUM(D${first}:D${last})`, result: Number(sumMoney(s.methods.map((m) => m.net))) },
  ]);
  addGrid(sheet, row, {
    headers: ["Cobrado por método de pago", "Ventas", "Cambios (neto)", "Total cobrado"],
    rows,
    formats: ["text", "money", "money", "money"],
  });
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;
}

function addModelSheets(book: ExcelJS.Workbook, modelSizes: readonly ModelSizeRow[]): void {
  addTableSheet(
    book,
    "Modelos",
    [
      { header: "Modelo", width: 26, kind: "text", value: (r: ModelSizeRow) => r.model },
      { header: "Línea", width: 14, kind: "text", value: (r) => r.line },
      { header: "Talla", width: 8, kind: "text", value: (r) => r.size },
      { header: "Pares (neto de cambios)", width: 22, kind: "int", value: (r) => r.units, total: "sum" },
      { header: "Ingreso", width: 15, kind: "money", value: (r) => r.revenue, total: "sum" },
    ],
    [...modelSizes].sort((a, b) => b.units - a.units || a.model.localeCompare(b.model) || a.sizeOrder - b.sizeOrder),
  );
  const map = buildHeatmap(modelSizes);
  type Line = (typeof map.models)[number];
  addTableSheet(book, "Matriz", [
    { header: "Modelo", width: 26, kind: "text", value: (r: Line) => r.model },
    ...map.sizes.map((size): ColumnDef<Line> => ({ header: `Talla ${size.label}`, width: 10, kind: "int", value: (r) => r.cells[size.label] ?? 0, total: "sum" })),
    { header: "Total", width: 10, kind: "int", value: (r) => r.total, total: "sum" },
  ], map.models);
}

/** Workbook of the sales report. Contains no cost, margin or profit column: it is the seller-safe export. */
export function buildSalesWorkbook(data: SalesBookData): ExcelJS.Workbook {
  const book = createWorkbook("Ventas");
  addSummarySheet(book, data);
  addTableSheet(book, "Ventas", SALE_COLUMNS, data.sales, { totalsWhere: { columnIndex: 6, equals: "Completada" } });
  addModelSheets(book, data.modelSizes);
  addTableSheet(book, "Cambios", EXCHANGE_COLUMNS, data.exchanges);
  addTableSheet(book, "Anulaciones", VOID_COLUMNS, data.voids);
  return book;
}

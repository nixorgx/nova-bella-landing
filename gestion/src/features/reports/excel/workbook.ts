import ExcelJS from "exceljs";
import { sanitizeCell } from "./sanitize";

export const NUMBER_FORMAT = {
  money: '"Bs" #,##0.00;[Red]-"Bs" #,##0.00',
  int: "#,##0",
  date: "dd/mm/yyyy",
  datetime: "dd/mm/yyyy hh:mm",
  percent: "0.0%",
} as const;

export type ColumnKind = "text" | "money" | "int" | "date" | "datetime" | "percent";

export interface ColumnDef<T> {
  readonly header: string;
  readonly width: number;
  readonly kind: ColumnKind;
  readonly value: (row: T) => string | number | null | undefined;
  /** Real formula for the cell (the cached `value` is stored as its result). Receives the Excel row number. */
  readonly formula?: (row: T, excelRow: number) => string;
  /** Add this column to the totals row. */
  readonly total?: "sum";
}

export interface TableOptions {
  /** Totals only count rows whose text column (0-based index) equals a value (e.g. exclude "Anulada"). */
  readonly totalsWhere?: { readonly columnIndex: number; readonly equals: string };
  readonly tabColor?: string;
}

const HEADER_FILL = "FF211C16";
const TOTAL_FILL = "FFE2DAC6";
const TZ = "America/La_Paz";

const wallClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/**
 * A Date whose UTC fields equal the La Paz wall clock of `iso`. Excel dates carry no timezone, so
 * this is what makes the sheet show the time the shop saw, whatever the viewer's timezone is.
 */
export function laPazWallClock(iso: string): Date {
  const parts = Object.fromEntries(wallClock.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second));
}

/** A DATE column value ("2026-11-02"), shown as that calendar day. */
export const plainDate = (key: string): Date => new Date(`${key}T00:00:00Z`);

export function createWorkbook(title: string): ExcelJS.Workbook {
  const book = new ExcelJS.Workbook();
  book.creator = "NovaBella";
  book.title = title;
  book.created = new Date();
  // Formulas carry a cached result, but Excel / LibreOffice still recalculate when the file opens.
  book.calcProperties.fullCalcOnLoad = true;
  return book;
}

export async function toBuffer(book: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await book.xlsx.writeBuffer());
}

/** 1 -> A, 27 -> AA */
export function columnLetter(index: number): string {
  let n = index;
  let letters = "";
  while (n > 0) {
    const rest = (n - 1) % 26;
    letters = String.fromCharCode(65 + rest) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function cellValue<T>(column: ColumnDef<T>, row: T, excelRow: number): ExcelJS.CellValue {
  const raw = column.value(row);
  if (column.formula) return { formula: column.formula(row, excelRow), result: raw === null || raw === undefined || raw === "" ? undefined : Number(raw) };
  if (raw === null || raw === undefined || raw === "") return null;
  switch (column.kind) {
    case "text":
      return sanitizeCell(String(raw));
    case "date":
      return plainDate(String(raw).slice(0, 10));
    case "datetime":
      return laPazWallClock(String(raw));
    default:
      return Number(raw);
  }
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 22;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFF8F5EC" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
}

function numericTotal<T>(column: ColumnDef<T>, rows: readonly T[], keep: (row: T) => boolean): number {
  return rows.filter(keep).reduce((sum, row) => sum + (Number(column.value(row)) || 0), 0);
}

function writeTotals<T>(
  sheet: ExcelJS.Worksheet,
  columns: readonly ColumnDef<T>[],
  rows: readonly T[],
  options: TableOptions,
): void {
  const first = 2;
  const last = rows.length + 1;
  const totalRow = sheet.getRow(last + 1);
  totalRow.getCell(1).value = "TOTAL";
  const where = options.totalsWhere;
  const keep = (row: T) => !where || String(columns[where.columnIndex].value(row)) === where.equals;
  columns.forEach((column, index) => {
    if (column.total !== "sum") return;
    if (rows.length === 0) {
      totalRow.getCell(index + 1).value = 0; // a formula over an empty range would point at itself
      return;
    }
    const letter = columnLetter(index + 1);
    const range = `${letter}${first}:${letter}${last}`;
    const formula = where
      ? `SUMIFS(${range},${columnLetter(where.columnIndex + 1)}${first}:${columnLetter(where.columnIndex + 1)}${last},"${where.equals}")`
      : `SUBTOTAL(109,${range})`;
    totalRow.getCell(index + 1).value = { formula, result: numericTotal(column, rows, keep) };
  });
  totalRow.eachCell({ includeEmpty: true }, (cell, col) => {
    if (col > columns.length) return;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_FILL } };
    cell.border = { top: { style: "thin" } };
    const column = columns[col - 1];
    if (column.total === "sum" && column.kind !== "text") cell.numFmt = NUMBER_FORMAT[column.kind];
  });
}

/**
 * One data table per sheet: header row 1 (frozen, filterable), typed number formats, widths and a
 * totals row of real formulas (SUBTOTAL follows the filter; SUMIFS excludes e.g. voided sales).
 */
export function addTableSheet<T>(
  book: ExcelJS.Workbook,
  name: string,
  columns: readonly ColumnDef<T>[],
  rows: readonly T[],
  options: TableOptions = {},
): ExcelJS.Worksheet {
  const sheet = book.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: options.tabColor ? { tabColor: { argb: options.tabColor } } : undefined,
  });
  sheet.columns = columns.map((column) => ({ header: column.header, width: column.width }));
  styleHeader(sheet.getRow(1));
  rows.forEach((row, rowIndex) => {
    const target = sheet.getRow(rowIndex + 2);
    columns.forEach((column, index) => {
      const cell = target.getCell(index + 1);
      cell.value = cellValue(column, row, rowIndex + 2);
      if (column.kind !== "text") cell.numFmt = NUMBER_FORMAT[column.kind];
      if (column.kind === "money" || column.kind === "int") cell.alignment = { horizontal: "right" };
    });
  });
  writeTotals(sheet, columns, rows, options);
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: rows.length + 1, column: columns.length },
  };
  return sheet;
}

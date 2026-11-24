import type ExcelJS from "exceljs";
import { sanitizeCell } from "./sanitize";
import { columnLetter, NUMBER_FORMAT } from "./workbook";

const LABEL_FILL = "FFE2DAC6";

export interface SummaryCell {
  readonly label: string;
  readonly value: string | number | { formula: string; result: number };
  readonly format?: keyof typeof NUMBER_FORMAT;
}

/** The "Resumen" header block: report name, period, scope and when it was generated. */
export function addMetaRows(sheet: ExcelJS.Worksheet, title: string, meta: readonly [string, string][]): number {
  sheet.getColumn(1).width = 32;
  sheet.getColumn(2).width = 22;
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  meta.forEach(([label, value], index) => {
    const row = index + 2;
    sheet.getCell(`A${row}`).value = label;
    sheet.getCell(`A${row}`).font = { bold: true };
    sheet.getCell(`B${row}`).value = sanitizeCell(value);
  });
  return meta.length + 3; // next free row, after a blank line
}

/** Label / value rows starting at `start`; returns the next free row. */
export function addSummaryRows(sheet: ExcelJS.Worksheet, start: number, cells: readonly SummaryCell[]): number {
  cells.forEach((cell, index) => {
    const row = start + index;
    sheet.getCell(`A${row}`).value = cell.label;
    const target = sheet.getCell(`B${row}`);
    target.value = cell.value;
    if (cell.format) target.numFmt = NUMBER_FORMAT[cell.format];
    target.alignment = { horizontal: "right" };
  });
  return start + cells.length + 1;
}

export interface GridTable {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly (string | number | { formula: string; result: number })[])[];
  readonly formats: readonly (keyof typeof NUMBER_FORMAT | "text")[];
}

/** A small table placed anywhere on a sheet (header styled), returns the next free row. */
export function addGrid(sheet: ExcelJS.Worksheet, start: number, grid: GridTable): number {
  grid.headers.forEach((header, index) => {
    const cell = sheet.getCell(start, index + 1);
    cell.value = header;
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LABEL_FILL } };
    if (index > 0) cell.alignment = { horizontal: "right" };
  });
  grid.rows.forEach((row, rowIndex) => {
    row.forEach((value, colIndex) => {
      const cell = sheet.getCell(start + 1 + rowIndex, colIndex + 1);
      cell.value = typeof value === "string" ? sanitizeCell(value) : value;
      const format = grid.formats[colIndex];
      if (format !== "text") {
        cell.numFmt = NUMBER_FORMAT[format];
        cell.alignment = { horizontal: "right" };
      }
    });
  });
  return start + grid.rows.length + 2;
}

export { columnLetter };

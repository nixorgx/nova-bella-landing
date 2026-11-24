import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  addTableSheet,
  createWorkbook,
  laPazWallClock,
  NUMBER_FORMAT,
  toBuffer,
  type ColumnDef,
} from "@/features/reports/excel/workbook";

interface Row {
  readonly name: string;
  readonly at: string;
  readonly units: number;
  readonly amount: string;
  readonly status: string;
}

const COLUMNS: readonly ColumnDef<Row>[] = [
  { header: "Cliente", width: 28, kind: "text", value: (r) => r.name },
  { header: "Fecha", width: 18, kind: "datetime", value: (r) => r.at },
  { header: "Pares", width: 8, kind: "int", value: (r) => r.units, total: "sum" },
  { header: "Total", width: 14, kind: "money", value: (r) => r.amount, total: "sum" },
  { header: "Estado", width: 12, kind: "text", value: (r) => r.status },
];

const ROWS: readonly Row[] = [
  { name: "María Rojas", at: "2026-11-02T14:35:00.000Z", units: 2, amount: "250.50", status: "Completada" },
  { name: "=HYPERLINK(\"http://malo\")", at: "2026-11-03T03:10:00.000Z", units: 1, amount: "99.00", status: "Completada" },
  { name: "Cliente anulada", at: "2026-11-04T12:00:00.000Z", units: 1, amount: "80.00", status: "Anulada" },
];

async function roundTrip(build: (wb: ExcelJS.Workbook) => void): Promise<ExcelJS.Workbook> {
  const wb = createWorkbook("Prueba");
  build(wb);
  const reader = new ExcelJS.Workbook();
  await reader.xlsx.load((await toBuffer(wb)) as unknown as ArrayBuffer);
  return reader;
}

describe("addTableSheet", () => {
  it("writes header, formats, frozen header, autofilter and widths", async () => {
    const book = await roundTrip((wb) => addTableSheet(wb, "Ventas", COLUMNS, ROWS));
    const sheet = book.getWorksheet("Ventas")!;
    expect(sheet.getRow(1).values).toEqual([undefined, "Cliente", "Fecha", "Pares", "Total", "Estado"]);
    expect(sheet.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
    expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getColumn(1).width).toBe(28);
    expect(sheet.getCell("D2").numFmt).toBe(NUMBER_FORMAT.money);
    expect(sheet.getCell("D2").value).toBe(250.5);
    expect(sheet.getCell("B2").numFmt).toBe(NUMBER_FORMAT.datetime);
    expect(sheet.getCell("C2").numFmt).toBe(NUMBER_FORMAT.int);
  });

  it("stores La Paz wall-clock time (UTC-4) and never shifts it", async () => {
    const book = await roundTrip((wb) => addTableSheet(wb, "Ventas", COLUMNS, ROWS));
    const value = book.getWorksheet("Ventas")!.getCell("B2").value as Date;
    expect(value.toISOString()).toBe("2026-11-02T10:35:00.000Z");
    expect(laPazWallClock("2026-11-03T03:10:00.000Z").toISOString()).toBe("2026-11-02T23:10:00.000Z");
  });

  it("adds a totals row with real SUBTOTAL formulas and the cached result", async () => {
    const book = await roundTrip((wb) => addTableSheet(wb, "Ventas", COLUMNS, ROWS));
    const sheet = book.getWorksheet("Ventas")!;
    const total = sheet.getCell("D5").value as { formula: string; result: number };
    expect(total.formula).toBe("SUBTOTAL(109,D2:D4)");
    expect(total.result).toBeCloseTo(429.5, 2);
    expect(sheet.getCell("A5").value).toBe("TOTAL");
    expect((sheet.getCell("C5").value as { formula: string }).formula).toBe("SUBTOTAL(109,C2:C4)");
  });

  it("can exclude rows from the totals with SUMIFS on a status column", async () => {
    const book = await roundTrip((wb) =>
      addTableSheet(wb, "Ventas", COLUMNS, ROWS, { totalsWhere: { columnIndex: 4, equals: "Completada" } }),
    );
    const total = book.getWorksheet("Ventas")!.getCell("D5").value as { formula: string; result: number };
    expect(total.formula).toBe('SUMIFS(D2:D4,E2:E4,"Completada")');
    expect(total.result).toBeCloseTo(349.5, 2);
  });

  it("neutralizes formula injection in user text", async () => {
    const book = await roundTrip((wb) => addTableSheet(wb, "Ventas", COLUMNS, ROWS));
    expect(book.getWorksheet("Ventas")!.getCell("A3").value).toBe("'=HYPERLINK(\"http://malo\")");
  });

  it("keeps an empty report valid (header only, totals of zero)", async () => {
    const book = await roundTrip((wb) => addTableSheet(wb, "Ventas", COLUMNS, []));
    const sheet = book.getWorksheet("Ventas")!;
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getCell("D2").value).toBe(0);
  });
});

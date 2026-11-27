import ExcelJS from "exceljs";
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "@/lib/auth/guards";
import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import { createExchange } from "@/features/exchanges/create-exchange";
import { buildExport, ExportForbiddenError } from "@/features/reports/excel/export-service";
import { voidSale } from "@/features/sales/void-sale";
import { systemQuery } from "../helpers/system";
import { addStock, createBranch, createUser, createVariant, rpcCreateSale } from "../helpers/fixtures";

let branch: string;
let sellerSession: SessionPayload;
let adminSession: SessionPayload;
let seller: AuthUser;
let admin: AuthUser;

const COST_HEADER = /cost|margen|utilidad|usd|tc 70|proveedor|valor a costo/i;

const asUser = (session: SessionPayload, role: "seller" | "superadmin"): AuthUser => ({
  mustChangePassword: false,
  id: session.userId,
  username: "x",
  fullName: "Prueba",
  role,
  branchId: session.branchId,
  branchName: "Sucursal",
});

async function load(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(buffer as unknown as ArrayBuffer);
  return book;
}

function headersOf(book: ExcelJS.Workbook): string[] {
  const headers: string[] = [];
  book.eachSheet((sheet) => sheet.getRow(1).eachCell((cell) => headers.push(String(cell.value))));
  return headers;
}

beforeAll(async () => {
  branch = await createBranch();
  sellerSession = await createUser("seller", branch);
  adminSession = await createUser("superadmin", null);
  seller = asUser(sellerSession, "seller");
  admin = asUser(adminSession, "superadmin");

  const a = await createVariant("200.00");
  const b = await createVariant("250.00");
  for (const v of [a, b]) {
    await addStock(v.variantId, branch, 10);
    await systemQuery("insert into variant_costs (variant_id, last_cost_bs, avg_cost_bs) values ($1, 90, 90)", [v.variantId]);
  }
  const customer = (await systemQuery<{ id: string }>("insert into customers (branch_id, name) values ($1, '=CMD|calc') returning id", [branch])).rows[0].id;
  const sale = (lines: { v: string; price: string }[], method: string, customerId: string | null = null) =>
    withUser(sellerSession, (c) =>
      rpcCreateSale(
        c,
        { branchId: branch, customerId },
        lines.map((l) => ({ variantId: l.v, qty: 1, finalPrice: l.price })),
        [{ method, amount: lines.reduce((s, l) => s + Number(l.price), 0).toFixed(2) }],
      ),
    );
  await sale([{ v: a.variantId, price: "200.00" }], "efectivo", customer);
  await sale([{ v: b.variantId, price: "250.00" }], "qr");
  const gone = await sale([{ v: a.variantId, price: "200.00" }], "tarjeta");
  await voidSale(adminSession, { saleId: gone, reason: "Prueba de anulación" });
  const swapped = await sale([{ v: a.variantId, price: "200.00" }], "efectivo");
  await createExchange(sellerSession, {
    saleId: swapped, reason: "modelo", note: undefined, paymentMethod: "efectivo",
    lines: [{ returnedVariantId: a.variantId, newVariantId: b.variantId, qty: 1, priceDiffOverride: undefined }],
  });
});

describe("ventas export", () => {
  it("builds the workbook from the seller's own sales with totals, formats and no cost columns", async () => {
    const built = await buildExport(seller, "ventas", { periodo: "mes" });
    expect(built.filename).toMatch(/^ventas-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.xlsx$/);
    const book = await load(built.buffer);
    expect(book.worksheets.map((s) => s.name)).toEqual(["Resumen", "Ventas", "Modelos", "Matriz", "Cambios", "Anulaciones"]);
    expect(headersOf(book).filter((h) => COST_HEADER.test(h))).toEqual([]);

    const sales = book.getWorksheet("Ventas")!;
    expect(sales.rowCount).toBe(1 + 4 + 1); // header + 4 sales (one voided) + totals
    const totalRow = sales.getRow(6);
    const total = totalRow.getCell("K").value as { formula: string; result: number };
    expect(total.formula).toMatch(/^SUMIFS\(K2:K5,G2:G5,"Completada"\)$/);
    expect(total.result).toBeCloseTo(650, 2); // 200 + 250 + 200 (voided 200 excluded)
    expect(sales.getCell("K2").numFmt).toContain("Bs");
    // formula injection: the customer name is stored as text, not as a formula
    expect(sales.getCell("E2").value).toBe("'=CMD|calc");
  });

  it("sums by payment method including the exchange difference", async () => {
    const book = await load((await buildExport(seller, "ventas", { periodo: "mes" })).buffer);
    const summary = book.getWorksheet("Resumen")!;
    const rows = new Map<string, ExcelJS.Row>();
    summary.eachRow((row) => rows.set(String(row.getCell(1).value), row));
    const cash = rows.get("Efectivo")!;
    expect((cash.getCell(2).value as { result: number }).result).toBeCloseTo(400, 2);
    expect((cash.getCell(3).value as { result: number }).result).toBeCloseTo(50, 2); // exchange difference collected in cash
    expect((cash.getCell(4).value as { result: number }).result).toBeCloseTo(450, 2);
    expect((rows.get("QR")!.getCell(4).value as { result: number }).result).toBeCloseTo(250, 2);
    expect((rows.get("TOTAL COBRADO")!.getCell(4).value as { result: number }).result).toBeCloseTo(700, 2);
  });

  it("lists exchanges and voids with their details", async () => {
    const book = await load((await buildExport(seller, "ventas", { periodo: "mes" })).buffer);
    expect(book.getWorksheet("Cambios")!.getCell("F2").value).toBe(50);
    expect(book.getWorksheet("Anulaciones")!.getCell("E2").value).toBe("Prueba de anulación");
  });
});

describe("role rules", () => {
  it("blocks cost reports for sellers before any query runs", async () => {
    await expect(buildExport(seller, "rentabilidad", {})).rejects.toBeInstanceOf(ExportForbiddenError);
    await expect(buildExport(seller, "compras", {})).rejects.toBeInstanceOf(ExportForbiddenError);
  });

  it("gives the seller a stock export with no cost, and the superadmin the cost sheet", async () => {
    const sellerBook = await load((await buildExport(seller, "stock", {})).buffer);
    expect(sellerBook.worksheets.map((s) => s.name)).toEqual(["Resumen", "Stock"]);
    expect(headersOf(sellerBook).filter((h) => COST_HEADER.test(h))).toEqual([]);
    const adminBook = await load((await buildExport(admin, "stock", { sucursal: branch })).buffer);
    expect(adminBook.worksheets.map((s) => s.name)).toContain("Costos");
  });

  it("builds profit and purchases for the superadmin", async () => {
    const profit = await load((await buildExport(admin, "rentabilidad", { periodo: "mes", sucursal: branch })).buffer);
    const summary = profit.getWorksheet("Resumen")!;
    const cells: Record<string, unknown> = {};
    summary.eachRow((row) => (cells[String(row.getCell(1).value)] = row.getCell(2).value));
    expect(cells["Ingresos (ventas + diferencias de cambios)"]).toBeCloseTo(700, 2);
    expect(cells["Costo de lo vendido (costo al momento de la venta)"]).toBeCloseTo(270, 2); // 3 pairs x 90
    const purchases = await buildExport(admin, "compras", { periodo: "mes" });
    expect((await load(purchases.buffer)).getWorksheet("Compras")).toBeTruthy();
  });

  it("exports cash sessions (list and a single session with its sales)", async () => {
    const list = await load((await buildExport(admin, "caja", { periodo: "mes", sucursal: branch })).buffer);
    expect(list.getWorksheet("Cajas")!.rowCount).toBeGreaterThanOrEqual(3);
    const id = (await systemQuery<{ id: string }>("select id from cash_sessions where branch_id = $1 limit 1", [branch])).rows[0].id;
    const one = await load((await buildExport(admin, "caja", { sesion: id })).buffer);
    expect(one.getWorksheet("Ventas de la caja")).toBeTruthy();
  });
});

import { randomBytes } from "node:crypto";
import { systemQuery } from "./system";

export const tag = () => randomBytes(4).toString("hex");

async function insertId(text: string, values: unknown[]): Promise<string> {
  return (await systemQuery<{ id: string }>(text, values)).rows[0].id;
}

export const makeLine = (name = `Linea ${tag()}`) =>
  insertId("insert into product_lines (name) values ($1) returning id", [name]);

export const makeModel = (lineId: string, name = `Modelo ${tag()}`, price = "150.00", active = true) =>
  insertId("insert into models (line_id, name, base_sale_price, active) values ($1, $2, $3, $4) returning id", [
    lineId,
    name,
    price,
    active,
  ]);

export const makeColor = (name = `Color ${tag()}`, hex = "#336699") =>
  insertId("insert into colors (name, hex) values ($1, $2) returning id", [name, hex]);

export const makeSize = (label: string, sortOrder = 0) =>
  insertId("insert into sizes (label, sort_order) values ($1, $2) returning id", [label, sortOrder]);

export async function makeVariantRow(
  modelId: string,
  colorId: string,
  sizeId: string,
  sku: string,
  barcode: string | null = null,
  active = true,
): Promise<string> {
  return insertId(
    "insert into variants (model_id, color_id, size_id, sku, barcode, active) values ($1,$2,$3,$4,$5,$6) returning id",
    [modelId, colorId, sizeId, sku, barcode, active],
  );
}

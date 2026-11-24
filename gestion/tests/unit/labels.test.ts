import { describe, expect, it } from "vitest";
import {
  expandLabels,
  LABEL_PRESETS,
  labelsPerPage,
  MAX_LABELS,
  pageCss,
  paginate,
  presetById,
} from "@/features/catalog/labels/presets";
import {
  barcodeText,
  code128Svg,
  qrSvg,
  svgToDataUri,
} from "@/features/catalog/labels/codes";

const item = (sku: string, qty: number) => ({
  variantId: sku,
  sku,
  barcode: null,
  model: "Alba",
  color: "Negro",
  size: "38",
  price: "189.00",
  stock: 3,
  qty,
});

describe("expandLabels", () => {
  it("repeats each item by its quantity, in order", () => {
    const labels = expandLabels([item("A", 2), item("B", 1)]);
    expect(labels.map((l) => l.sku)).toEqual(["A", "A", "B"]);
  });

  it("ignores zero or negative quantities and caps the total", () => {
    expect(expandLabels([item("A", 0), item("B", -2)])).toHaveLength(0);
    expect(expandLabels([item("A", MAX_LABELS + 50)])).toHaveLength(MAX_LABELS);
  });
});

describe("presets", () => {
  it("offers a roll size and an A4 sheet", () => {
    expect(presetById("roll-50x30").widthMm).toBe(50);
    expect(presetById("roll-50x30").heightMm).toBe(30);
    expect(LABEL_PRESETS.some((p) => p.kind === "sheet")).toBe(true);
  });

  it("falls back to the first preset for unknown ids", () => {
    expect(presetById("nope").id).toBe(LABEL_PRESETS[0].id);
  });

  it("computes labels per page", () => {
    expect(labelsPerPage(presetById("roll-50x30"))).toBe(1);
    expect(labelsPerPage(presetById("a4-3x7"))).toBe(21);
  });

  it("paginates without losing labels", () => {
    const labels = expandLabels([item("A", 50)]);
    const pages = paginate(labels, presetById("a4-3x7"));
    expect(pages.map((p) => p.length)).toEqual([21, 21, 8]);
    expect(paginate([], presetById("a4-3x7"))).toEqual([]);
  });

  it("emits @page css with the physical paper size", () => {
    expect(pageCss(presetById("roll-50x30"))).toContain("size: 50mm 30mm");
    expect(pageCss(presetById("a4-3x7"))).toContain("size: 210mm 297mm");
  });

  it("A4 grid fits inside the sheet", () => {
    const p = presetById("a4-3x7");
    const width = p.marginLeftMm * 2 + p.columns * p.widthMm + (p.columns - 1) * p.gapXmm;
    const height = p.marginTopMm * 2 + p.rows * p.heightMm + (p.rows - 1) * p.gapYmm;
    expect(width).toBeLessThanOrEqual(p.pageWidthMm);
    expect(height).toBeLessThanOrEqual(p.pageHeightMm);
  });
});

describe("codes", () => {
  it("uses the barcode when printable ASCII, else the SKU", () => {
    expect(barcodeText({ sku: "DAM-ALBA", barcode: "7750001" })).toBe("7750001");
    expect(barcodeText({ sku: "DAM-ALBA", barcode: null })).toBe("DAM-ALBA");
    expect(barcodeText({ sku: "DAM-ALBA", barcode: "ñandú" })).toBe("DAM-ALBA");
  });

  it("renders a QR svg that encodes the sku", async () => {
    const svg = await qrSvg("DAM-ALBA-NEGRO-38");
    expect(svg).toContain("<svg");
    expect(svg).toContain("<path");
  });

  it("renders a Code 128 svg", () => {
    const svg = code128Svg("DAM-ALBA-NEGRO-38");
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
  });

  it("turns svg markup into an <img> safe data uri", () => {
    const uri = svgToDataUri("<svg xmlns='http://www.w3.org/2000/svg'></svg>");
    expect(uri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(uri).not.toContain("<");
    expect(decodeURIComponent(uri.split(",")[1])).toContain("<svg");
  });
});

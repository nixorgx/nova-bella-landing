export interface LabelData {
  readonly variantId: string;
  readonly sku: string;
  readonly barcode: string | null;
  readonly model: string;
  readonly color: string;
  readonly size: string;
  readonly price: string;
}

export interface LabelItem extends LabelData {
  readonly qty: number;
  readonly stock?: number;
}

export interface LabelPreset {
  readonly id: string;
  readonly name: string;
  readonly hint: string;
  readonly kind: "roll" | "sheet";
  readonly widthMm: number;
  readonly heightMm: number;
  readonly columns: number;
  readonly rows: number;
  readonly pageWidthMm: number;
  readonly pageHeightMm: number;
  readonly marginTopMm: number;
  readonly marginLeftMm: number;
  readonly gapXmm: number;
  readonly gapYmm: number;
}

/** Hard cap so one print job (and the preview) stays responsive. */
export const MAX_LABELS = 500;

const roll = (id: string, name: string, widthMm: number, heightMm: number, hint: string): LabelPreset => ({
  id,
  name,
  hint,
  kind: "roll",
  widthMm,
  heightMm,
  columns: 1,
  rows: 1,
  pageWidthMm: widthMm,
  pageHeightMm: heightMm,
  marginTopMm: 0,
  marginLeftMm: 0,
  gapXmm: 0,
  gapYmm: 0,
});

export const LABEL_PRESETS: readonly LabelPreset[] = [
  roll("roll-50x30", "50 × 30 mm", 50, 30, "Rollo de etiquetas, una por página"),
  roll("roll-40x25", "40 × 25 mm", 40, 25, "Rollo pequeño, una por página"),
  {
    id: "a4-3x7",
    name: "Hoja A4 · 21 etiquetas",
    hint: "63,5 × 38,1 mm, 3 columnas × 7 filas",
    kind: "sheet",
    widthMm: 63.5,
    heightMm: 38.1,
    columns: 3,
    rows: 7,
    pageWidthMm: 210,
    pageHeightMm: 297,
    marginTopMm: 15.1,
    marginLeftMm: 7.2,
    gapXmm: 2.54,
    gapYmm: 0,
  },
];

export function presetById(id: string): LabelPreset {
  return LABEL_PRESETS.find((preset) => preset.id === id) ?? LABEL_PRESETS[0];
}

export function labelsPerPage(preset: LabelPreset): number {
  return preset.columns * preset.rows;
}

/** One entry per physical label, in print order. */
export function expandLabels(items: readonly LabelItem[]): LabelData[] {
  const labels: LabelData[] = [];
  for (const { qty, ...data } of items) {
    const count = Math.max(0, Math.floor(qty));
    for (let copy = 0; copy < count && labels.length < MAX_LABELS; copy += 1) labels.push(data);
  }
  return labels;
}

export function paginate<T>(labels: readonly T[], preset: LabelPreset): T[][] {
  const size = labelsPerPage(preset);
  const pages: T[][] = [];
  for (let index = 0; index < labels.length; index += size) pages.push(labels.slice(index, index + size));
  return pages;
}

/** CSS for the browser print dialog so paper size matches the label stock. */
export function pageCss(preset: LabelPreset): string {
  return `@page { size: ${preset.pageWidthMm}mm ${preset.pageHeightMm}mm; margin: 0; }`;
}

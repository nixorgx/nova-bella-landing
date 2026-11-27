/** Maximum characters each SKU segment may use, so labels stay readable. */
export const SKU_PART_LIMITS = { line: 3, model: 8, color: 6, size: 4 } as const;

const DEFAULT_PART_LIMIT = 12;
const WORD_ABBREVIATION = 3;
const FALLBACK_PART = "X";

function normalizeWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

/**
 * Turns free text into an uppercase A-Z0-9 token. One word keeps its letters;
 * several words keep the first three letters of each ("Azul marino" -> "AZUMAR").
 */
export function slugPart(text: string, maxLength: number = DEFAULT_PART_LIMIT): string {
  const words = normalizeWords(text);
  const joined =
    words.length <= 1 ? (words[0] ?? "") : words.map((word) => word.slice(0, WORD_ABBREVIATION)).join("");
  return joined.slice(0, maxLength);
}

export interface SkuParts {
  readonly line: string;
  readonly model: string;
  readonly color: string;
  readonly size: string;
}

/** Deterministic `LINEA-MODELO-COLOR-TALLA` (before collision handling). */
export function buildSkuBase(parts: SkuParts): string {
  const segment = (value: string, key: keyof typeof SKU_PART_LIMITS) =>
    slugPart(value, SKU_PART_LIMITS[key]) || FALLBACK_PART;
  return [
    segment(parts.line, "line"),
    segment(parts.model, "model"),
    segment(parts.color, "color"),
    segment(parts.size, "size"),
  ].join("-");
}

/**
 * Gives every base a unique SKU: duplicates inside the batch and SKUs that already
 * exist get `-2`, `-3`, ... Comparison is case-insensitive. Pure: inputs untouched.
 */
export function assignUniqueSkus(bases: readonly string[], taken: Iterable<string>): string[] {
  const used = new Set<string>();
  for (const sku of taken) used.add(sku.toUpperCase());
  return bases.map((base) => {
    let candidate = base.toUpperCase();
    for (let suffix = 2; used.has(candidate); suffix += 1) {
      candidate = `${base.toUpperCase()}-${suffix}`;
    }
    used.add(candidate);
    return candidate;
  });
}

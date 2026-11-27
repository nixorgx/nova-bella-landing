import { one, type RawSearchParams } from "@/lib/search-params";
import type { CatalogModel } from "./public-data";

export const SORTS = ["destacados", "menor-precio", "mayor-precio", "nombre"] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Readonly<Record<Sort, string>> = {
  destacados: "Destacados",
  "menor-precio": "Menor precio",
  "mayor-precio": "Mayor precio",
  nombre: "De la A a la Z",
};

export const PAGE_SIZE = 24;

export interface CatalogFilters {
  readonly q?: string;
  readonly lineId?: string;
  readonly colorId?: string;
  readonly sizeId?: string;
  readonly min?: number;
  readonly max?: number;
  readonly sort: Sort;
  readonly page: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value.toLowerCase() : undefined;
}

function amount(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,6}(\.\d{1,2})?$/.test(value)) return undefined;
  return Number(value);
}

/** Reads ?q &linea &color &talla &min &max &orden &pagina. Bad values fall back; nothing throws. */
export function parseFilters(params: RawSearchParams): CatalogFilters {
  const sort = one(params.orden);
  const page = Number(one(params.pagina));
  return {
    q: one(params.q)?.slice(0, 60),
    lineId: uuid(one(params.linea)),
    colorId: uuid(one(params.color)),
    sizeId: uuid(one(params.talla)),
    min: amount(one(params.min)),
    max: amount(one(params.max)),
    sort: (SORTS as readonly string[]).includes(sort ?? "") ? (sort as Sort) : "destacados",
    page: Number.isInteger(page) && page >= 1 && page <= 200 ? page : 1,
  };
}

const fold = (text: string): string =>
  text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function hasActiveFilters(filters: CatalogFilters): boolean {
  return Boolean(filters.q || filters.lineId || filters.colorId || filters.sizeId || filters.min !== undefined || filters.max !== undefined);
}

function matches(model: CatalogModel, filters: CatalogFilters): boolean {
  if (filters.lineId && model.line_id !== filters.lineId) return false;
  if (filters.min !== undefined && model.price < filters.min) return false;
  if (filters.max !== undefined && model.price > filters.max) return false;
  if (filters.q) {
    const haystack = fold(`${model.name} ${model.line} ${model.description ?? ""} ${model.colors.map((c) => c.name).join(" ")}`);
    if (!filters.q.split(/\s+/).every((word) => haystack.includes(fold(word)))) return false;
  }
  if (filters.colorId && !model.colors.some((c) => c.id === filters.colorId)) return false;
  if (filters.sizeId && !model.sizes.some((s) => s.id === filters.sizeId)) return false;
  if (filters.colorId && filters.sizeId) {
    const c = filters.colorId.slice(0, 8);
    const s = filters.sizeId.slice(0, 8);
    if (!model.pairs.some((pair) => pair.startsWith(`${c}|${s}|`))) return false;
  }
  return true;
}

const byStockThen =
  (compare: (a: CatalogModel, b: CatalogModel) => number) =>
  (a: CatalogModel, b: CatalogModel): number =>
    Number(b.units > 0) - Number(a.units > 0) || compare(a, b);

const alphabetical = (a: CatalogModel, b: CatalogModel): number => a.name.localeCompare(b.name, "es");

const COMPARATORS: Readonly<Record<Sort, (a: CatalogModel, b: CatalogModel) => number>> = {
  destacados: byStockThen((a, b) => a.line.localeCompare(b.line, "es") || alphabetical(a, b)),
  "menor-precio": byStockThen((a, b) => a.price - b.price || alphabetical(a, b)),
  "mayor-precio": byStockThen((a, b) => b.price - a.price || alphabetical(a, b)),
  nombre: byStockThen(alphabetical),
};

export interface FilteredCatalog {
  readonly items: readonly CatalogModel[];
  readonly total: number;
  readonly pageCount: number;
  readonly page: number;
}

export function applyFilters(models: readonly CatalogModel[], filters: CatalogFilters): FilteredCatalog {
  const sorted = models.filter((model) => matches(model, filters)).sort(COMPARATORS[filters.sort]);
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(filters.page, pageCount);
  return { items: sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), total: sorted.length, pageCount, page };
}

export interface Facets {
  readonly lines: readonly { id: string; name: string }[];
  readonly colors: readonly { id: string; name: string; hex: string | null }[];
  readonly sizes: readonly { id: string; label: string }[];
  readonly priceMin: number;
  readonly priceMax: number;
}

/** Filter options come from the whole published catalog, not from the current result. */
export function buildFacets(models: readonly CatalogModel[]): Facets {
  const lines = new Map<string, string>();
  const colors = new Map<string, { id: string; name: string; hex: string | null }>();
  const sizes = new Map<string, string>();
  for (const model of models) {
    lines.set(model.line_id, model.line);
    for (const color of model.colors) colors.set(color.id, { id: color.id, name: color.name, hex: color.hex });
    for (const size of model.sizes) sizes.set(size.id, size.label);
  }
  const prices = models.map((m) => m.price);
  return {
    lines: [...lines].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "es")),
    colors: [...colors.values()].sort((a, b) => a.name.localeCompare(b.name, "es")),
    sizes: [...sizes].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true })),
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
  };
}

/** Same filters as URL parameters, optionally overriding some. */
export function filtersToQuery(filters: CatalogFilters, override: Partial<Record<string, string | undefined>> = {}): string {
  const params = new URLSearchParams();
  const base: Record<string, string | undefined> = {
    q: filters.q,
    linea: filters.lineId,
    color: filters.colorId,
    talla: filters.sizeId,
    min: filters.min?.toString(),
    max: filters.max?.toString(),
    orden: filters.sort === "destacados" ? undefined : filters.sort,
    pagina: filters.page > 1 ? String(filters.page) : undefined,
    ...override,
  };
  for (const [key, value] of Object.entries(base)) if (value) params.set(key, value);
  const text = params.toString();
  return text ? `?${text}` : "";
}

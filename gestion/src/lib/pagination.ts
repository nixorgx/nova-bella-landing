export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export interface PageRequest {
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly rows: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly pageCount: number;
  /** 1-based position of the first / last row shown (0 when empty). */
  readonly from: number;
  readonly to: number;
}

type RawParam = string | readonly string[] | undefined;

function firstInt(value: RawParam): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string" || !/^\d{1,9}$/.test(raw.trim())) return null;
  const parsed = Number(raw.trim());
  return parsed >= 1 ? parsed : null;
}

/** Reads `?pagina=&tamano=` safely: anything invalid falls back to the defaults. */
export function parsePageRequest(params: {
  readonly pagina?: RawParam;
  readonly tamano?: RawParam;
}): PageRequest {
  const size = firstInt(params.tamano);
  return {
    page: firstInt(params.pagina) ?? 1,
    pageSize: Math.min(size ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE),
  };
}

/** Number of pages for `total` rows (an empty list still has one, empty, page). */
export function pageCountFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Clamps the requested page into range (a stale link past the end shows the last page). */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCountFor(total, pageSize));
}

export function buildPage<T>(rows: readonly T[], total: number, request: PageRequest): Page<T> {
  const page = clampPage(request.page, total, request.pageSize);
  const from = rows.length === 0 ? 0 : (page - 1) * request.pageSize + 1;
  return {
    rows,
    total,
    page,
    pageSize: request.pageSize,
    pageCount: pageCountFor(total, request.pageSize),
    from,
    to: rows.length === 0 ? 0 : from + rows.length - 1,
  };
}

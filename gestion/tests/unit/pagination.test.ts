import { describe, expect, it } from "vitest";
import { buildPage, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, parsePageRequest } from "@/lib/pagination";

describe("parsePageRequest", () => {
  it("defaults to the first page of the default size", () => {
    expect(parsePageRequest({})).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("accepts valid numbers (strings or arrays from search params)", () => {
    expect(parsePageRequest({ pagina: "3", tamano: "25" })).toEqual({ page: 3, pageSize: 25 });
    expect(parsePageRequest({ pagina: ["2", "9"], tamano: ["10"] })).toEqual({ page: 2, pageSize: 10 });
  });

  it("falls back on garbage and clamps the size", () => {
    expect(parsePageRequest({ pagina: "-4", tamano: "0" })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePageRequest({ pagina: "abc", tamano: "1.5" })).toEqual({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    expect(parsePageRequest({ tamano: "100000" }).pageSize).toBe(MAX_PAGE_SIZE);
    expect(parsePageRequest({ pagina: "99999999999999999999" }).page).toBe(1);
  });
});

describe("buildPage", () => {
  const request = { page: 2, pageSize: 10 };

  it("computes totals and the visible range", () => {
    expect(buildPage(["a", "b"], 12, request)).toEqual({
      rows: ["a", "b"],
      total: 12,
      page: 2,
      pageSize: 10,
      pageCount: 2,
      from: 11,
      to: 12,
    });
  });

  it("reports an empty result with a single empty page", () => {
    expect(buildPage([], 0, request)).toMatchObject({ total: 0, page: 1, pageCount: 1, from: 0, to: 0 });
  });
});

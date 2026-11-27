import { describe, expect, it } from "vitest";
import { MAX_CELL_LENGTH, sanitizeCell } from "@/features/reports/excel/sanitize";

describe("sanitizeCell (spreadsheet formula injection)", () => {
  it.each(["=SUM(A1:A9)", "+34 600", "-2+3", "@cmd", "=HYPERLINK(\"http://x\")", "\t=1+1", "\r=1"])(
    "neutralizes %j with a leading apostrophe",
    (value) => {
      expect(sanitizeCell(value).startsWith("'")).toBe(true);
    },
  );
  it("keeps ordinary text and names untouched", () => {
    expect(sanitizeCell("María Fernanda Rojas")).toBe("María Fernanda Rojas");
    expect(sanitizeCell("Boutique Lucía 2-4")).toBe("Boutique Lucía 2-4");
    expect(sanitizeCell("")).toBe("");
  });
  it("catches dangerous characters after leading whitespace", () => {
    expect(sanitizeCell("  =1+1")).toBe("'  =1+1");
  });
  it("passes null and undefined as empty text and strips control characters", () => {
    expect(sanitizeCell(null)).toBe("");
    expect(sanitizeCell(undefined)).toBe("");
    expect(sanitizeCell("a\u0000b\u0007c")).toBe("abc");
  });
  it("limits the length to what a cell can hold", () => {
    expect(sanitizeCell("x".repeat(MAX_CELL_LENGTH + 500)).length).toBe(MAX_CELL_LENGTH);
  });
});

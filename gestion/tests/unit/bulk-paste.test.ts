import { describe, expect, it } from "vitest";
import { parseBulkText } from "@/features/purchases/bulk-paste";
import { formatRateInput } from "@/lib/number-input";

describe("parseBulkText", () => {
  it("reads semicolon, tab and space separated rows", () => {
    const result = parseBulkText("ALB-NEG-38;4;14,50\nURB-CAF-40\t2\t24.00\nCOL-AZU-33 6 11");
    expect(result.invalid).toEqual([]);
    expect(result.lines).toEqual([
      { code: "ALB-NEG-38", qtyInput: "4", costInput: "14,50" },
      { code: "URB-CAF-40", qtyInput: "2", costInput: "24.00" },
      { code: "COL-AZU-33", qtyInput: "6", costInput: "11" },
    ]);
  });
  it("reports rows it cannot read and ignores blanks", () => {
    const result = parseBulkText("\nSOLOCODIGO\nA;x;3\n");
    expect(result.lines).toHaveLength(0);
    expect(result.invalid).toEqual(["SOLOCODIGO", "A;x;3"]);
  });
});

describe("formatRateInput", () => {
  it("trims trailing zeros and uses a decimal comma", () => {
    expect(formatRateInput("6.9600")).toBe("6,96");
    expect(formatRateInput("7.0000")).toBe("7");
    expect(formatRateInput("10.5000")).toBe("10,5");
  });
});

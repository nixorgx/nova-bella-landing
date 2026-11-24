import { describe, expect, it } from "vitest";
import { parseInteger, parseRate } from "@/lib/number-input";

describe("parseRate (exchange rates, up to 4 decimals)", () => {
  it("reads comma or dot decimals", () => {
    expect(parseRate("6,96")).toBe("6.96");
    expect(parseRate("10.5")).toBe("10.5");
    expect(parseRate("6,9650")).toBe("6.9650");
  });
  it("rejects zero, negatives, junk and over-precision", () => {
    for (const bad of ["", "0", "0,0000", "-6", "abc", "6,96501"]) expect(parseRate(bad), bad).toBeNull();
  });
});

describe("parseInteger", () => {
  it("accepts whole positive numbers within bounds", () => {
    expect(parseInteger("12", 1, 100)).toBe(12);
    expect(parseInteger(" 7 ", 1, 100)).toBe(7);
  });
  it("rejects decimals, zero, huge and junk", () => {
    for (const bad of ["1,5", "0", "-2", "x", "", "101"]) expect(parseInteger(bad, 1, 100), bad).toBeNull();
  });
});

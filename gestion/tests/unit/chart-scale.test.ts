import { describe, expect, it } from "vitest";
import { bucketSeries, compactBs, MAX_BARS, niceMax, yTicks } from "@/lib/chart-scale";

describe("niceMax / yTicks", () => {
  it("rounds the top of the axis up to a clean number", () => {
    expect(niceMax(0)).toBe(100);
    expect(niceMax(83)).toBe(100);
    expect(niceMax(1234)).toBe(1500);
    expect(niceMax(2600)).toBe(3000);
    expect(niceMax(9999)).toBe(10000);
  });
  it("gives evenly spaced ticks from zero to the nice max", () => {
    expect(yTicks(1234)).toEqual([0, 500, 1000, 1500]);
    expect(yTicks(0)).toEqual([0, 50, 100]);
  });
});

describe("compactBs", () => {
  it("is full under 10,000 and compact above, one style per axis", () => {
    expect(compactBs(0)).toBe("0");
    expect(compactBs(1500)).toBe("1.500");
    expect(compactBs(12_000)).toBe("12 mil");
    expect(compactBs(1_500_000)).toBe("1,5 M");
  });
});

describe("bucketSeries", () => {
  const day = (n: number) => `2026-01-${String(n).padStart(2, "0")}`;
  it("keeps one bar per day while the range is short", () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ day: day(i + 1), total: "10.00", count: 1 }));
    expect(bucketSeries(points)).toHaveLength(10);
  });
  it("groups by week (Monday start) when there would be too many bars", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const points = Array.from({ length: 120 }, (_, i) => ({
      day: new Date(start + i * 86_400_000).toISOString().slice(0, 10),
      total: "10.00",
      count: 1,
    }));
    const buckets = bucketSeries(points);
    expect(buckets.length).toBeLessThanOrEqual(MAX_BARS);
    expect(buckets.reduce((sum, b) => sum + Number(b.total), 0)).toBeCloseTo(1200, 2);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(120);
    expect(buckets[0].label).toMatch(/sem/i);
  });
});

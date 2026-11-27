import { describe, expect, it } from "vitest";
import {
  buildHeatmap,
  fillDailySeries,
  heatIntensity,
  marginPct,
  mergeByMethod,
  pctChange,
  profitOf,
  rankTop,
  ticketAverage,
} from "@/features/reports/aggregate";

describe("ticketAverage", () => {
  it("divides the amount by the number of sales with half-up rounding", () => {
    expect(ticketAverage("1000.00", 3)).toBe("333.33");
    expect(ticketAverage("10.00", 8)).toBe("1.25");
    expect(ticketAverage("2.50", 4)).toBe("0.63");
  });
  it("is zero when there are no sales", () => {
    expect(ticketAverage("0.00", 0)).toBe("0.00");
  });
});

describe("pctChange / marginPct", () => {
  it("computes the change versus the previous period", () => {
    expect(pctChange("1200.00", "1000.00")).toBe(20);
    expect(pctChange("750.00", "1000.00")).toBe(-25);
    expect(pctChange("100.00", "0.00")).toBeNull();
  });
  it("computes margin over revenue with one decimal", () => {
    expect(marginPct("200.00", "120.00")).toBe("40.0");
    expect(marginPct("300.00", "200.00")).toBe("33.3");
    expect(marginPct("0.00", "10.00")).toBeNull();
  });
});

describe("profitOf", () => {
  it("nets exchange price differences and the cost swing of exchanged pairs", () => {
    // sold for 1000 (cost 600); exchanged: +40 paid, new pair costs 10 more than the returned one
    const result = profitOf({ salesRevenue: "1000.00", exchangeDiff: "40.00", salesCost: "600.00", exchangeCostDelta: "10.00" });
    expect(result).toEqual({ revenue: "1040.00", cost: "610.00", profit: "430.00", marginPct: "41.3" });
  });
  it("can be negative (selling under cost)", () => {
    expect(profitOf({ salesRevenue: "100.00", exchangeDiff: "0.00", salesCost: "130.00", exchangeCostDelta: "0.00" })).toMatchObject({
      profit: "-30.00",
      marginPct: "-30.0",
    });
  });
});

describe("fillDailySeries", () => {
  it("returns one point per day, zero where nothing was sold", () => {
    const points = fillDailySeries(
      [
        { day: "2026-11-02", total: "150.50", count: 2 },
        { day: "2026-11-04", total: "99.00", count: 1 },
      ],
      { from: "2026-11-01", to: "2026-11-05" },
    );
    expect(points.map((p) => [p.day, p.total, p.count])).toEqual([
      ["2026-11-01", "0.00", 0],
      ["2026-11-02", "150.50", 2],
      ["2026-11-03", "0.00", 0],
      ["2026-11-04", "99.00", 1],
      ["2026-11-05", "0.00", 0],
    ]);
  });
});

describe("heatmap", () => {
  const cells = [
    { model: "Alba", size: "37", sizeOrder: 37, units: 4 },
    { model: "Alba", size: "38", sizeOrder: 38, units: 9 },
    { model: "Urbano", size: "38", sizeOrder: 38, units: 3 },
    { model: "Urbano", size: "41", sizeOrder: 41, units: 1 },
    { model: "Wawa", size: "26", sizeOrder: 26, units: 0 },
  ];
  it("orders models by units sold and sizes ascending, with totals", () => {
    const map = buildHeatmap(cells);
    expect(map.models.map((m) => [m.model, m.total])).toEqual([["Alba", 13], ["Urbano", 4]]);
    expect(map.sizes.map((s) => [s.label, s.total])).toEqual([["37", 4], ["38", 12], ["41", 1]]);
    expect(map.max).toBe(9);
    expect(map.total).toBe(17);
    expect(map.models[0].cells["38"]).toBe(9);
  });
  it("scales the intensity between 0 and 1", () => {
    expect(heatIntensity(0, 9)).toBe(0);
    expect(heatIntensity(9, 9)).toBe(1);
    expect(heatIntensity(3, 0)).toBe(0);
    expect(heatIntensity(4, 9)).toBeGreaterThan(heatIntensity(1, 9));
  });
  it("ranks the top N and folds nothing silently", () => {
    expect(rankTop([{ n: "a", v: 1 }, { n: "b", v: 5 }, { n: "c", v: 3 }], 2, (r) => r.v).map((r) => r.n)).toEqual(["b", "c"]);
  });
});

describe("mergeByMethod", () => {
  it("adds exchange differences (collected + / refunded -) to the sales per method", () => {
    const rows = mergeByMethod(
      { efectivo: "500.00", qr: "300.00", transferencia: "0.00", tarjeta: "100.00" },
      { efectivo: "-20.00", qr: "40.00", transferencia: "0.00", tarjeta: "0.00" },
    );
    expect(rows).toEqual([
      { method: "efectivo", sales: "500.00", exchanges: "-20.00", net: "480.00" },
      { method: "qr", sales: "300.00", exchanges: "40.00", net: "340.00" },
      { method: "transferencia", sales: "0.00", exchanges: "0.00", net: "0.00" },
      { method: "tarjeta", sales: "100.00", exchanges: "0.00", net: "100.00" },
    ]);
  });
});

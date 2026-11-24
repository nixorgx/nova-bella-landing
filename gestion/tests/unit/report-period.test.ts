import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInRange,
  eachDay,
  previousMonthSpan,
  previousRange,
  resolvePeriod,
  startOfWeek,
  MAX_RANGE_DAYS,
} from "@/features/reports/period";

const THURSDAY = "2026-11-26";

describe("date helpers", () => {
  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("starts the week on Monday", () => {
    expect(startOfWeek("2026-11-26")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-23")).toBe("2026-11-23");
    expect(startOfWeek("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the previous week
  });

  it("lists every day of an inclusive range and counts them", () => {
    expect(eachDay("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(daysInRange({ from: "2026-11-01", to: "2026-11-30" })).toBe(30);
  });
});

describe("resolvePeriod", () => {
  it("resolves today, week-to-date and month-to-date", () => {
    expect(resolvePeriod({ periodo: "hoy" }, THURSDAY)).toMatchObject({ kind: "hoy", from: THURSDAY, to: THURSDAY });
    expect(resolvePeriod({ periodo: "semana" }, THURSDAY)).toMatchObject({ kind: "semana", from: "2026-11-23", to: THURSDAY });
    expect(resolvePeriod({ periodo: "mes" }, THURSDAY)).toMatchObject({ kind: "mes", from: "2026-11-01", to: THURSDAY });
  });

  it("defaults to the month when the parameter is missing or unknown", () => {
    expect(resolvePeriod({}, THURSDAY).kind).toBe("mes");
    expect(resolvePeriod({ periodo: "ayer" }, THURSDAY).kind).toBe("mes");
  });

  it("uses a custom range and swaps it when reversed", () => {
    expect(resolvePeriod({ periodo: "rango", desde: "2026-10-05", hasta: "2026-10-20" }, THURSDAY)).toMatchObject({
      kind: "rango",
      from: "2026-10-05",
      to: "2026-10-20",
    });
    expect(resolvePeriod({ periodo: "rango", desde: "2026-10-20", hasta: "2026-10-05" }, THURSDAY)).toMatchObject({
      from: "2026-10-05",
      to: "2026-10-20",
    });
  });

  it("completes a half-open custom range and falls back when it has no valid dates", () => {
    expect(resolvePeriod({ periodo: "rango", desde: "2026-11-10" }, THURSDAY)).toMatchObject({ from: "2026-11-10", to: THURSDAY });
    expect(resolvePeriod({ periodo: "rango", hasta: "2026-11-10" }, THURSDAY)).toMatchObject({ from: "2026-11-10", to: "2026-11-10" });
    expect(resolvePeriod({ periodo: "rango", desde: "basura", hasta: "2026-13-45" }, THURSDAY).kind).toBe("mes");
  });

  it("never lets a range exceed the maximum span", () => {
    const period = resolvePeriod({ periodo: "rango", desde: "2020-01-01", hasta: THURSDAY }, THURSDAY);
    expect(period.to).toBe(THURSDAY);
    expect(daysInRange(period)).toBe(MAX_RANGE_DAYS);
  });

  it("describes the period in Spanish for headings and file names", () => {
    expect(resolvePeriod({ periodo: "hoy" }, THURSDAY).label).toBe("Hoy");
    expect(resolvePeriod({ periodo: "mes" }, THURSDAY).label).toMatch(/noviembre/i);
    expect(resolvePeriod({ periodo: "rango", desde: "2026-10-05", hasta: "2026-10-20" }, THURSDAY).label).toBe("05/10/2026 al 20/10/2026");
  });
});

describe("previousMonthSpan", () => {
  it("compares the same number of elapsed days of the previous month", () => {
    expect(previousMonthSpan("2026-11-26")).toEqual({ from: "2026-10-01", to: "2026-10-26", fullTo: "2026-10-31" });
  });
  it("clips when the previous month is shorter", () => {
    expect(previousMonthSpan("2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28", fullTo: "2026-02-28" });
  });
  it("crosses the year", () => {
    expect(previousMonthSpan("2027-01-15")).toEqual({ from: "2026-12-01", to: "2026-12-15", fullTo: "2026-12-31" });
  });
});

describe("previousRange", () => {
  it("is the period of the same length right before", () => {
    expect(previousRange({ from: "2026-11-23", to: "2026-11-26" })).toEqual({ from: "2026-11-19", to: "2026-11-22" });
    expect(previousRange({ from: "2026-11-26", to: "2026-11-26" })).toEqual({ from: "2026-11-25", to: "2026-11-25" });
    expect(previousRange({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-01-29", to: "2026-02-28" });
  });
});

import { describe, expect, it } from "vitest";
import {
  classifyScan,
  INITIAL_SCAN_STATE,
  normalizeScannedCode,
  recordKey,
  type ScanState,
} from "@/lib/scan";

function type(times: readonly number[]): ScanState {
  return times.reduce<ScanState>((state, now) => recordKey(state, now), INITIAL_SCAN_STATE);
}

describe("classifyScan", () => {
  it("treats a fast burst of keystrokes as a scanner", () => {
    const state = type([0, 8, 16, 24, 33, 41, 49, 58]);
    expect(classifyScan(state)).toBe("scanner");
  });

  it("treats human typing as manual", () => {
    expect(classifyScan(type([0, 180, 410, 700, 990]))).toBe("manual");
  });

  it("treats one slow key inside the burst as manual", () => {
    expect(classifyScan(type([0, 10, 20, 200, 210, 220]))).toBe("manual");
  });

  it("needs a minimum number of characters", () => {
    expect(classifyScan(type([0, 5, 10]))).toBe("manual");
    expect(classifyScan(INITIAL_SCAN_STATE)).toBe("manual");
  });

  it("starts a new burst after a long pause", () => {
    const state = type([0, 700, 710, 720, 730, 740]);
    expect(classifyScan(state)).toBe("scanner");
  });
});

describe("recordKey", () => {
  it("is immutable", () => {
    const next = recordKey(INITIAL_SCAN_STATE, 5);
    expect(INITIAL_SCAN_STATE.count).toBe(0);
    expect(next.count).toBe(1);
  });
});

describe("normalizeScannedCode", () => {
  it("trims and removes control characters", () => {
    expect(normalizeScannedCode("  7750001234567\r\n")).toBe("7750001234567");
    expect(normalizeScannedCode("AB\u0000C")).toBe("ABC");
  });
});

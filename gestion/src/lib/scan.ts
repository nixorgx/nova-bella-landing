/** USB barcode readers type like a keyboard, but far faster than any person. */
export const SCANNER_MAX_GAP_MS = 50;
export const SCANNER_MIN_CHARS = 4;
/** A longer pause means a new burst (the previous keys were just typing). */
const BURST_RESET_MS = 300;

export interface ScanState {
  readonly count: number;
  readonly lastAt: number | null;
  readonly maxGap: number;
}

export const INITIAL_SCAN_STATE: ScanState = { count: 0, lastAt: null, maxGap: 0 };

/** Registers a printable keystroke at `now` (ms). Returns a new state. */
export function recordKey(state: ScanState, now: number): ScanState {
  if (state.lastAt === null || now - state.lastAt > BURST_RESET_MS) {
    return { count: 1, lastAt: now, maxGap: 0 };
  }
  return { count: state.count + 1, lastAt: now, maxGap: Math.max(state.maxGap, now - state.lastAt) };
}

export type ScanSource = "scanner" | "manual";

/** Called when Enter arrives: was the text typed by a reader or by a person? */
export function classifyScan(state: ScanState): ScanSource {
  return state.count >= SCANNER_MIN_CHARS && state.maxGap <= SCANNER_MAX_GAP_MS ? "scanner" : "manual";
}

/** Strips whitespace and control characters some readers append. */
export function normalizeScannedCode(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, "").trim();
}

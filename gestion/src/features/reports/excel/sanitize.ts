/** Excel cells hold up to 32,767 characters. */
export const MAX_CELL_LENGTH = 32_767;

const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

/**
 * Text that came from a person (customer names, notes, reasons, supplier...) is written to the
 * spreadsheet as TEXT that can never run as a formula: a leading apostrophe defuses values that
 * start with = + - @ (also after blanks, tab or CR), the OWASP rule for CSV/Excel injection.
 */
export function sanitizeCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const clean = value.replace(CONTROL_CHARS, "");
  const safe = FORMULA_START.test(clean) ? `'${clean}` : clean;
  return safe.slice(0, MAX_CELL_LENGTH);
}

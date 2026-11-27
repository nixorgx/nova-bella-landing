/**
 * Bolivian mobile numbers: 8 digits starting with 6 or 7 (WhatsApp needs a mobile). Accepts the usual ways
 * people type them: "7123 4567", "+591 71234567", "00591-7123-4567", "(591) 71234567".
 * Returns the 8 national digits, or null when it cannot be a Bolivian mobile number.
 */
export function normalizeBoPhone(raw: string): string | null {
  let digits = raw.replace(/[\s().-]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("591") && digits.length === 11) digits = digits.slice(3);
  return /^[67]\d{7}$/.test(digits) ? digits : null;
}

/** "71234567" -> "7123 4567" for display. */
export function formatBoPhone(national: string): string {
  return /^\d{8}$/.test(national) ? `${national.slice(0, 4)} ${national.slice(4)}` : national;
}

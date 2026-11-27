/** Bolivian date/time formatting shared by lists and receipts. */
const TZ = "America/La_Paz";

const dateTime = new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short", timeZone: TZ });
const dateOnly = new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
const timeOnly = new Intl.DateTimeFormat("es-BO", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });

export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));
export const formatDate = (iso: string): string => dateOnly.format(new Date(iso));
export const formatTime = (iso: string): string => timeOnly.format(new Date(iso));
/** "YYYY-MM-DD" in La Paz time (what <input type=date> and filters use). */
export const todayKey = (now: Date = new Date()): string => dayKey.format(now);

/** A plain DATE column ("2026-03-10"): shown as that calendar day, never shifted by the timezone. */
export function formatPlainDate(value: string): string {
  return new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${value}T00:00:00Z`),
  );
}

export const formatInt = (value: number): string => new Intl.NumberFormat("es-BO").format(value);

/** "000123" style sale number. */
export const saleNumberLabel = (value: number): string => String(value).padStart(6, "0");

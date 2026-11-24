export type RawSearchParams = Record<string, string | string[] | undefined>;

/** First non-empty value of a query parameter, trimmed. */
export function one(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() ? first.trim() : undefined;
}

export function uuidParam(value: string | string[] | undefined): string | undefined {
  const text = one(value);
  return text && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text) ? text : undefined;
}

/** YYYY-MM-DD that is a real calendar day, or undefined (bad links never throw). */
export function dateParam(value: string | string[] | undefined): string | undefined {
  const text = one(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  const parsed = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || !parsed.toISOString().startsWith(text) ? undefined : text;
}

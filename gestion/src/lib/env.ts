import { z } from "zod";

type Source = Record<string, string | undefined>;

const MIN_SECRET = 32;
const BCRYPT_MIN = 4;
const BCRYPT_MAX = 15;
const BCRYPT_DEFAULT = 12;

function fail(error: z.ZodError): never {
  const detail = error.issues.map((issue) => issue.message).join("; ");
  throw new Error(`Configuracion invalida: ${detail}`);
}

function parse<T extends z.ZodType>(schema: T, source: Source): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) fail(parsed.error);
  return parsed.data;
}

const sessionSchema = z.object({
  SESSION_SECRET: z
    .string({ error: "SESSION_SECRET es obligatoria" })
    .min(MIN_SECRET, `SESSION_SECRET debe tener al menos ${MIN_SECRET} caracteres`),
});

/** Secret that signs session cookies (needed by the proxy too, so nothing else is required). */
export function getSessionSecret(source: Source = process.env): string {
  return parse(sessionSchema, source).SESSION_SECRET;
}

const contextSchema = z.object({
  DB_CONTEXT_SECRET: z
    .string({ error: "DB_CONTEXT_SECRET es obligatoria" })
    .min(MIN_SECRET, `DB_CONTEXT_SECRET debe tener al menos ${MIN_SECRET} caracteres`),
});

/** Secret shared with the database to sign the per-request identity (see migration 009). */
export function getContextSecret(source: Source = process.env): string {
  return parse(contextSchema, source).DB_CONTEXT_SECRET;
}

const runtimeDbSchema = z.object({
  DATABASE_URL_SELLER: z.string({ error: "DATABASE_URL_SELLER es obligatoria" }).min(1, "DATABASE_URL_SELLER es obligatoria"),
  DATABASE_URL_SUPERADMIN: z.string({ error: "DATABASE_URL_SUPERADMIN es obligatoria" }).min(1, "DATABASE_URL_SUPERADMIN es obligatoria"),
  DATABASE_URL_AUTH: z.string({ error: "DATABASE_URL_AUTH es obligatoria" }).min(1, "DATABASE_URL_AUTH es obligatoria"),
});

export type RuntimeDbEnv = z.infer<typeof runtimeDbSchema>;

/**
 * Connection strings of the least-privilege runtime roles. DATABASE_URL (owner) is NOT
 * part of the runtime: it is only read by migrations, seed and tests.
 */
export function getRuntimeDbEnv(source: Source = process.env): RuntimeDbEnv {
  return parse(runtimeDbSchema, source);
}

const publicDbSchema = z.object({
  DATABASE_URL_PUBLIC: z
    .string({ error: "DATABASE_URL_PUBLIC es obligatoria" })
    .min(1, "DATABASE_URL_PUBLIC es obligatoria"),
});

/** Anonymous store login (app_runtime_public): only EXECUTE on the public_*() functions. */
export function getPublicDbUrl(source: Source = process.env): string {
  return parse(publicDbSchema, source).DATABASE_URL_PUBLIC;
}

const orderTokenSchema = z.object({
  ORDER_TOKEN_SECRET: z
    .string({ error: "ORDER_TOKEN_SECRET es obligatoria" })
    .min(MIN_SECRET, `ORDER_TOKEN_SECRET debe tener al menos ${MIN_SECRET} caracteres`),
});

/**
 * Key of the HMAC that derives the buyer's order token. Separate from SESSION_SECRET on purpose:
 * rotating the session secret must not kill every order link already sent to buyers.
 */
export function getOrderTokenSecret(source: Source = process.env): string {
  return parse(orderTokenSchema, source).ORDER_TOKEN_SECRET;
}

/** Public site origin for absolute links (sitemap, OpenGraph). Optional; falls back to Vercel's production URL. */
export function siteUrl(source: Source = process.env): string {
  const explicit = source.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = source.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "http://localhost:3000";
}

/** Parses "true"/"1"/"yes"/"on" and "false"/"0"/"no"/"off"; anything else uses the fallback. */
export function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  const normalized = value?.trim().toLowerCase();
  if (normalized === undefined || normalized === "") return fallback;
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

/** Session cookie `Secure` flag: COOKIE_SECURE overrides; default is on in production. */
export function cookieSecure(source: Source = process.env): boolean {
  return parseBoolean(source.COOKIE_SECURE, source.NODE_ENV === "production");
}

/**
 * Number of trusted reverse-proxy hops in front of the app (TRUST_PROXY=1 / true => 1).
 * 0 means X-Forwarded-For is ignored because any client could forge it.
 */
export function trustedProxyHops(source: Source = process.env): number {
  const raw = source.TRUST_PROXY?.trim().toLowerCase();
  if (!raw || raw === "false" || raw === "0" || raw === "no" || raw === "off") return 0;
  if (raw === "true" || raw === "yes" || raw === "on") return 1;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0;
}

/** bcrypt work factor: 12 by default; tests set BCRYPT_COST lower to stay fast. */
export function bcryptCost(source: Source = process.env): number {
  const raw = source.BCRYPT_COST;
  if (!raw) return BCRYPT_DEFAULT;
  const cost = Number(raw);
  if (!Number.isInteger(cost) || cost < BCRYPT_MIN || cost > BCRYPT_MAX) {
    throw new Error(`Configuracion invalida: BCRYPT_COST debe estar entre ${BCRYPT_MIN} y ${BCRYPT_MAX}`);
  }
  return cost;
}

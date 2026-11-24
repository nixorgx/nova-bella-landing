/**
 * Security headers. The CSP is nonce-based (per request, built in src/proxy.ts) so no
 * 'unsafe-inline' scripts are needed. Next.js reads the nonce from the request's CSP header
 * and stamps it on its own scripts/styles; pages are therefore rendered dynamically.
 */
export interface CspOptions {
  readonly nonce: string;
  /** Next dev needs eval (React debugging), inline styles (HMR) and a websocket. */
  readonly isDev: boolean;
  /** Only behind HTTPS: upgrading sub-requests would break plain-http `next start` on localhost. */
  readonly upgradeInsecure: boolean;
}

export function buildCsp({ nonce, isDev, upgradeInsecure }: CspOptions): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Data-driven colour swatches use style="" attributes; element styles still need the nonce.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "media-src 'self' blob:",
    `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (upgradeInsecure) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

/** A fresh, unguessable value per request. */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}

export const HSTS_MAX_AGE_SECONDS = 63_072_000; // two years

/** HSTS is meaningless (and sticky) over plain http, so it is only sent in production builds. */
export function strictTransportSecurity(isProduction: boolean): string | null {
  return isProduction ? `max-age=${HSTS_MAX_AGE_SECONDS}; includeSubDomains` : null;
}

import { NextResponse, type NextRequest } from "next/server";
import { canAccess, homeFor, isPublicPath, LOGIN_PATH } from "@/lib/auth/routes";
import { decodeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { cookieSecure } from "@/lib/env";
import { buildCsp, generateNonce } from "@/lib/security/csp";

const CSP_HEADER = "Content-Security-Policy";

function secured(response: NextResponse, csp: string): NextResponse {
  response.headers.set(CSP_HEADER, csp);
  return response;
}

/**
 * 1) Nonce-based Content-Security-Policy on every response (request header too, so Next.js
 *    can stamp the nonce on its scripts/styles while rendering).
 * 2) Optimistic gate: verifies the signed cookie and role-based route access. Real
 *    authorization is re-checked in guards (server) and by Postgres RLS.
 */
export async function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    upgradeInsecure: cookieSecure(),
  });
  const { pathname } = request.nextUrl;
  const session = await decodeSession(request.cookies.get(SESSION_COOKIE)?.value);

  const next = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set(CSP_HEADER, csp);
    return secured(NextResponse.next({ request: { headers: requestHeaders } }), csp);
  };
  const redirect = (path: string) => secured(NextResponse.redirect(new URL(path, request.url)), csp);

  // The public store (and its sitemap/robots) is anonymous: no session needed, same nonce CSP.
  if (isPublicPath(pathname)) return next();

  if (pathname === LOGIN_PATH) {
    return session ? redirect(homeFor(session.role)) : next();
  }
  if (!session) {
    const response = redirect(LOGIN_PATH);
    if (request.cookies.has(SESSION_COOKIE)) response.cookies.delete(SESSION_COOKIE);
    return response;
  }
  if (pathname === "/" || !canAccess(session.role, pathname)) {
    return redirect(homeFor(session.role));
  }
  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|tienda/img/|.*\\.(?:png|jpg|jpeg|svg|ico|webp|woff2?)$).*)"],
};

import { NextResponse } from "next/server";

/**
 * Image bytes straight from the database as a cacheable response. Defense in depth for user-origin bytes:
 * fixed image/webp type (re-encoded by sharp at upload), nosniff, and a CSP that forbids everything if
 * somebody ever navigates to the file itself.
 */
const LOCKDOWN = "default-src 'none'; sandbox";

export function imageResponse(
  request: Request,
  row: { bytes: Buffer; etag: string },
  cache: "public-immutable" | "private-short",
): Response {
  const etag = `"${row.etag}"`;
  const headers: Record<string, string> = {
    ETag: etag,
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": LOCKDOWN,
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": cache === "public-immutable" ? "public, max-age=31536000, immutable" : "private, max-age=300",
  };
  if (request.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
  return new NextResponse(new Uint8Array(row.bytes), { status: 200, headers: { ...headers, "Content-Length": String(row.bytes.length) } });
}

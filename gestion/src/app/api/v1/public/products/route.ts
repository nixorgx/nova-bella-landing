import { NextResponse } from "next/server";
import { getCatalog } from "@/features/store/public-data";
import { toLandingProducts } from "@/features/store/landing-adapter";

/** Cross-origin read-only storefront bridge. The management application keeps its own auth. */
const ORIGINAL_LANDING = "https://nova-bella-boutique-2026.keenorbit34.chatgpt.site";

function allowOrigin(origin: string | null): string | null {
  if (!origin) return null;
  const origins = [ORIGINAL_LANDING, process.env.NOVA_BELLA_LANDING_ORIGIN ?? ""]
    .filter(Boolean)
    .map(value => { try { return new URL(value).origin; } catch { return ""; } });
  if (process.env.NODE_ENV === "development") origins.push("http://localhost:5173", "http://127.0.0.1:5173");
  return origins.includes(origin) ? origin : null;
}

function headers(origin: string | null): Record<string, string> {
  return {
    ...(allowOrigin(origin) ? { "Access-Control-Allow-Origin": allowOrigin(origin)! } : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Cache-Control": "public, max-age=0, s-maxage=30",
    Vary: "Origin",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !allowOrigin(origin)) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, { status: 204, headers: headers(origin) });
}

export async function GET(request: Request) {
  const origin = request.headers.get("origin");
  // The catalog is anonymous, but we never authorize CORS for arbitrary websites.
  try {
    const catalog = await getCatalog();
    const items = toLandingProducts(catalog, request.url);
    return NextResponse.json({ items, source: "novabella-gestion" }, { headers: headers(origin) });
  } catch {
    return NextResponse.json({ detail: "Catálogo temporalmente no disponible" }, {
      status: 503,
      headers: { ...headers(origin), "Cache-Control": "no-store" },
    });
  }
}

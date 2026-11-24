import { NextResponse } from "next/server";
import { authQuery, publicQuery } from "@/lib/db";

export const dynamic = "force-dynamic";

function safeErrorCategory(error: unknown): string {
  const obj = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : null;
  const msg = typeof obj?.message === "string" ? obj.message.toLowerCase() : "";
  if (msg.includes("tenant") || msg.includes("user not found")) return "TENANT_NOT_FOUND";
  if (msg.includes("password authentication failed") || msg.includes("authentication failed")) return "AUTH_FAILED";
  if (msg.includes("certificate") || msg.includes("ssl")) return "TLS_FAILED";
  if (msg.includes("timeout")) return "TIMEOUT";
  if (msg.includes("permission denied")) return "PERMISSION_DENIED";
  if (msg.includes("connect") || msg.includes("refused")) return "CONNECTION_FAILED";
  return typeof obj?.code === "string" && /^[A-Z0-9_]{2,30}$/.test(obj.code) ? obj.code : "UNKNOWN";
}

function runtimeShape(kind: "auth" | "public") {
  const raw = kind === "auth" ? process.env.DATABASE_URL_AUTH : process.env.DATABASE_URL_PUBLIC;
  if (!raw) return { urlConfigured: false };
  try {
    const url = new URL(raw);
    const user = decodeURIComponent(url.username);
    return {
      urlConfigured: true,
      poolerHost: url.hostname.endsWith(".pooler.supabase.com"),
      directHost: url.hostname.startsWith("db.") && url.hostname.endsWith(".supabase.co"),
      port: url.port || "5432",
      roleHasTenantSuffix: /\\.[a-z0-9]{20}$/.test(user),
      roleMatchesKind: user.startsWith("app_runtime_" + kind),
      databaseName: url.pathname === "/postgres" ? "postgres" : "other",
    };
  } catch {
    return { urlConfigured: false };
  }
}

export async function GET() {
  const checks = await Promise.allSettled([
    authQuery("select 1 as ok"),
    publicQuery("select 1 as ok"),
  ]);
  const ok = checks.every(result => result.status === "fulfilled");
  for (const [idx, result] of checks.entries()) {
    if (result.status !== "rejected") continue;
    const kind = idx === 0 ? "auth" : "public";
    console.error("[NovaBella DB health]", {
      kind,
      category: safeErrorCategory(result.reason),
      ...runtimeShape(kind),
      caConfigured: Boolean(process.env.SUPABASE_CA_CERT),
    });
  }
  return NextResponse.json({ status: ok ? "ok" : "unavailable" }, {
    status: ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}

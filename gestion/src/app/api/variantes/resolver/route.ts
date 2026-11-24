import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { resolveScan } from "@/features/catalog/search";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/variantes/resolver?code=... : barcode or SKU of one variant, or { hit: null }. */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401, headers: NO_STORE });
  const params = new URL(request.url).searchParams;
  const code = params.get("code") ?? "";
  const sucursal = params.get("sucursal");
  const branchId = sucursal && /^[0-9a-f-]{36}$/i.test(sucursal) ? sucursal : null;
  try {
    const hit = await resolveScan(toSession(user), code, branchId);
    return NextResponse.json({ hit }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo resolver el código." }, { status: 500, headers: NO_STORE });
  }
}

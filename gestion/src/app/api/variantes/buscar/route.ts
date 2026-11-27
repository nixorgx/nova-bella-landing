import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { searchVariants } from "@/features/catalog/search";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * GET /api/variantes/buscar?q=alba%20negro&modelo=<uuid>&limite=12&inactivos=1
 * Available to both roles; results contain price and stock only (never cost).
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401, headers: NO_STORE });

  const params = new URL(request.url).searchParams;
  const modelo = params.get("modelo");
  const modelId = modelo && /^[0-9a-f-]{36}$/i.test(modelo) ? modelo : undefined;
  const sucursal = params.get("sucursal");
  const branchId = sucursal && /^[0-9a-f-]{36}$/i.test(sucursal) ? sucursal : undefined;
  const limit = Number(params.get("limite") ?? "") || undefined;
  try {
    const hits = await searchVariants(toSession(user), {
      query: params.get("q") ?? "",
      modelId,
      limit,
      includeInactive: params.get("inactivos") === "1",
      branchId,
    });
    return NextResponse.json({ hits }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo buscar. Intente nuevamente." }, { status: 500, headers: NO_STORE });
  }
}

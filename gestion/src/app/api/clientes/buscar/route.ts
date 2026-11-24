import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { searchCustomers } from "@/features/customers/queries";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** GET /api/clientes/buscar?q=ana : name, phone or CI/NIT. Branch rules come from RLS. */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado." }, { status: 401, headers: NO_STORE });
  const q = new URL(request.url).searchParams.get("q") ?? "";
  try {
    const customers = await searchCustomers(toSession(user), q);
    return NextResponse.json({ customers }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "No se pudo buscar." }, { status: 500, headers: NO_STORE });
  }
}

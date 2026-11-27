import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/guards";
import { buildExport, ExportForbiddenError, isExportReport, XLSX_MIME } from "@/features/reports/excel/export-service";
import { ExportTooLargeError } from "@/features/reports/export-queries";
import type { RawSearchParams } from "@/lib/search-params";

const NO_STORE = { "Cache-Control": "private, no-store" };

function json(message: string, status: number): Response {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

/**
 * GET /reportes/exportar/<ventas|stock|compras|rentabilidad|caja>?periodo=&desde=&hasta=&sucursal=&vendedor=
 * Server-side .xlsx. Role rules live in buildExport: cost reports are 403 for sellers and the
 * seller-safe reports are scoped to the seller's own branch/sales in the SQL itself.
 */
export async function GET(request: Request, { params }: { params: Promise<{ reporte: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) return json("No autorizado.", 401);
  const { reporte } = await params;
  if (!isExportReport(reporte)) return json("Ese reporte no existe.", 404);

  const query: RawSearchParams = Object.fromEntries(new URL(request.url).searchParams.entries());
  try {
    const built = await buildExport(user, reporte, query);
    return new Response(new Uint8Array(built.buffer), {
      headers: {
        ...NO_STORE,
        "Content-Type": XLSX_MIME,
        "Content-Disposition": `attachment; filename="${built.filename}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof ExportForbiddenError) return json(error.message, 403);
    if (error instanceof ExportTooLargeError) return json(error.message, 413);
    if (error instanceof RangeError) return json(error.message, 404);
    return json("No se pudo generar el archivo. Intente nuevamente.", 500);
  }
}

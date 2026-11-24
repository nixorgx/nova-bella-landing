import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { imageResponse } from "@/features/store/image-response";
import { getAdminThumb } from "@/features/store-admin/queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Thumbnail preview for the catalog admin (works for models not published yet). Superadmin only. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") return new NextResponse(null, { status: 403 });
  const { id } = await context.params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const row = await getAdminThumb(toSession(user), id);
  return row ? imageResponse(request, row, "private-short") : new NextResponse(null, { status: 404 });
}

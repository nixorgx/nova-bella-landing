import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { withUser } from "@/lib/db";
import { imageResponse } from "@/features/store/image-response";

/** Preview of the payment QR for the settings page (superadmin only). */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") return new NextResponse(null, { status: 403 });
  const { rows } = await withUser(toSession(user), (c) =>
    c.query<{ bytes: Buffer; etag: string }>("select bytes, etag from store_assets where key = 'payment_qr'"),
  );
  return rows[0] ? imageResponse(request, rows[0], "private-short") : new NextResponse(null, { status: 404 });
}

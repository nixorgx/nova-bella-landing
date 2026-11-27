import { NextResponse } from "next/server";
import { publicQuery } from "@/lib/db";
import { imageResponse } from "@/features/store/image-response";
import { hashOrderToken, isWellFormedToken } from "@/features/store/order-token";
import { LIMITS, requestIp, reserveIp } from "@/features/store/throttle";

/** The shop's payment QR, only for somebody holding the link of a QR order. */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  if (!isWellFormedToken(token)) return new NextResponse(null, { status: 404 });
  const gate = await reserveIp(LIMITS.orderViewIp, await requestIp());
  if (!gate.allowed) return new NextResponse(null, { status: 429 });
  try {
    const { rows } = await publicQuery<{ bytes: Buffer; etag: string }>("select bytes, etag from public_payment_qr($1)", [hashOrderToken(token)]);
    if (!rows[0]) return new NextResponse(null, { status: 404 });
    return imageResponse(request, rows[0], "private-short");
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

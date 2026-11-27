import { NextResponse } from "next/server";
import { publicQuery } from "@/lib/db";
import { imageResponse } from "@/features/store/image-response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Public product photo. The id is a random UUID per upload, so the content is immutable and cached for a year. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return new NextResponse(null, { status: 404 });
  const params = new URL(request.url).searchParams;
  // Only `?t=1` exists: random query strings would each be a separate cache entry that reaches the database.
  if ([...params.keys()].some((key) => key !== "t") || (params.has("t") && params.get("t") !== "1")) return new NextResponse(null, { status: 404 });
  const size = params.get("t") === "1" ? "thumb" : "full";
  try {
    const { rows } = await publicQuery<{ bytes: Buffer; etag: string }>("select bytes, etag from public_image($1, $2)", [id, size]);
    if (!rows[0]) return new NextResponse(null, { status: 404 });
    return imageResponse(request, rows[0], "public-immutable");
  } catch {
    return new NextResponse(null, { status: 503 });
  }
}

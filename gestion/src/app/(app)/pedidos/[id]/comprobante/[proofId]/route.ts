import { NextResponse } from "next/server";
import { getCurrentUser, toSession } from "@/lib/auth/guards";
import { getProof } from "@/features/orders/queries";
import { imageResponse } from "@/features/store/image-response";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Payment proofs are private: signed-in superadmin only (sellers also fail in the database), never cached publicly. */
export async function GET(request: Request, context: { params: Promise<{ id: string; proofId: string }> }) {
  const user = await getCurrentUser();
  if (!user || user.role !== "superadmin") return new NextResponse(null, { status: 403 });
  const { id, proofId } = await context.params;
  if (!UUID.test(id) || !UUID.test(proofId)) return new NextResponse(null, { status: 404 });
  const proof = await getProof(toSession(user), id, proofId);
  if (!proof) return new NextResponse(null, { status: 404 });
  const response = imageResponse(request, proof, "private-short");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

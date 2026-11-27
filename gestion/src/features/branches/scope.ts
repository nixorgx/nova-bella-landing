import { uuidParam, type RawSearchParams } from "@/lib/search-params";

interface Actor {
  readonly role: "superadmin" | "seller";
  readonly branchId: string | null;
}

/**
 * The branch a screen is limited to. A seller is ALWAYS pinned to their own branch, whatever the
 * URL says (the database enforces it again with RLS); the superadmin picks one with ?sucursal=
 * or sees every branch (null).
 */
export function branchFilterFor(actor: Actor, raw: RawSearchParams["sucursal"]): string | null {
  if (actor.role === "seller") return actor.branchId;
  return uuidParam(raw) ?? null;
}

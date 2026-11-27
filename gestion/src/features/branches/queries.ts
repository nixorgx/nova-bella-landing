import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";

export interface BranchOption {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
}

/**
 * Branches the caller can see (RLS: a seller only sees their own). Active ones by default; filters
 * over history pass `includeInactive` so a closed branch can still be looked up.
 */
export async function listBranchOptions(
  session: SessionPayload,
  options: { readonly includeInactive?: boolean } = {},
): Promise<BranchOption[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string; name: string; city: string | null }>(
      `select id, name, city from branches ${options.includeInactive ? "" : "where active"} order by name`,
    );
    return rows;
  });
}

/** The branch a screen works on: the seller's own, or the requested/first one for the superadmin. */
export function pickBranch(
  session: SessionPayload,
  options: readonly BranchOption[],
  requested?: string,
): BranchOption | null {
  if (session.role === "seller") return options.find((b) => b.id === session.branchId) ?? null;
  return options.find((b) => b.id === requested) ?? options[0] ?? null;
}

export interface BranchSummary {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly active: boolean;
  readonly units: number;
  readonly sellers: number;
  readonly openCash: boolean;
}

/** Why a branch cannot be deactivated yet (same rules the database enforces). */
export function deactivationBlockers(branch: BranchSummary): readonly string[] {
  const blockers: string[] = [];
  if (branch.units > 0) blockers.push(`Tiene ${branch.units} ${branch.units === 1 ? "par" : "pares"} en stock: transfiéralos a otra sucursal o ajústelos a cero.`);
  if (branch.openCash) blockers.push("Tiene una caja abierta: ciérrela primero.");
  if (branch.sellers > 0) blockers.push(`Tiene ${branch.sellers} ${branch.sellers === 1 ? "vendedor activo" : "vendedores activos"}: asígnelos a otra sucursal.`);
  return blockers;
}

/** Every branch (also inactive ones) with what blocks deactivating it. Superadmin only (RLS). */
export async function listBranchSummaries(session: SessionPayload): Promise<BranchSummary[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select b.id, b.name, b.city, b.active,
              coalesce((select sum(sl.qty) from stock_levels sl where sl.branch_id = b.id), 0)::int as units,
              (select count(*) from users u where u.branch_id = b.id and u.role = 'seller' and u.active)::int as sellers,
              exists (select 1 from cash_sessions c where c.branch_id = b.id and c.closed_at is null) as open_cash
         from branches b order by b.active desc, lower(b.name)`,
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      city: row.city,
      active: row.active,
      units: row.units,
      sellers: row.sellers,
      openCash: row.open_cash,
    }));
  });
}

export interface SellerAssignment {
  readonly id: string;
  readonly username: string;
  readonly fullName: string;
  readonly branchId: string | null;
  readonly branchName: string | null;
}

export async function listSellerAssignments(session: SessionPayload): Promise<SellerAssignment[]> {
  return withUser(session, async (client) => {
    const { rows } = await client.query(
      `select u.id, u.username, u.full_name, u.branch_id, b.name as branch_name
         from users u left join branches b on b.id = u.branch_id
        where u.role = 'seller' and u.active order by lower(u.username)`,
    );
    return rows.map((row) => ({ id: row.id, username: row.username, fullName: row.full_name, branchId: row.branch_id, branchName: row.branch_name }));
  });
}

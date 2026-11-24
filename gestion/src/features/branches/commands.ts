import type { SessionPayload } from "@/lib/auth/session";
import { withUser } from "@/lib/db";
import type { BranchInput } from "./schemas";

export async function createBranch(session: SessionPayload, input: BranchInput, active: boolean): Promise<string> {
  return withUser(session, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "insert into branches (name, city, active) values ($1, $2, $3) returning id",
      [input.name, input.city, active],
    );
    return rows[0].id;
  });
}

/** Returns false when the branch does not exist. */
export async function updateBranch(session: SessionPayload, id: string, input: BranchInput): Promise<boolean> {
  return withUser(session, async (client) => {
    const result = await client.query("update branches set name = $2, city = $3 where id = $1", [id, input.name, input.city]);
    return (result.rowCount ?? 0) > 0;
  });
}

/** The database refuses to deactivate a branch with stock, open cash, or active sellers (IN005). */
export async function setBranchActive(session: SessionPayload, id: string, active: boolean): Promise<boolean> {
  return withUser(session, async (client) => {
    const result = await client.query("update branches set active = $2 where id = $1", [id, active]);
    return (result.rowCount ?? 0) > 0;
  });
}

/** Moves a seller to an active branch; their old sessions die (token_version bump in the DB). */
export async function assignSeller(session: SessionPayload, userId: string, branchId: string): Promise<boolean> {
  return withUser(session, async (client) => {
    const result = await client.query("update users set branch_id = $2 where id = $1 and role = 'seller'", [userId, branchId]);
    return (result.rowCount ?? 0) > 0;
  });
}

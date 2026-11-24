import { withUser } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/guards";
import { toSession } from "@/lib/auth/guards";

export interface UserListItem {
  readonly id: string;
  readonly username: string;
  readonly fullName: string;
  readonly role: "superadmin" | "seller";
  readonly branchName: string | null;
  readonly active: boolean;
  readonly lastLoginAt: string | null;
  readonly mustChangePassword: boolean;
  readonly passwordChangedAt: string | null;
}

export interface BranchOption {
  readonly id: string;
  readonly name: string;
}

/** Runs under the caller's DB role: only a superadmin gets rows back from `users`. */
export async function listUsers(actor: AuthUser): Promise<readonly UserListItem[]> {
  return withUser(toSession(actor), async (client) => {
    const { rows } = await client.query(
      `select u.id, u.username, u.full_name, u.role, u.active, u.last_login_at, u.must_change_password, u.password_changed_at, b.name as branch_name
         from users u left join branches b on b.id = u.branch_id
        order by u.active desc, u.role, u.username`,
    );
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      role: row.role,
      branchName: row.branch_name,
      active: row.active,
      lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
      mustChangePassword: row.must_change_password,
      passwordChangedAt: row.password_changed_at ? new Date(row.password_changed_at).toISOString() : null,
    }));
  });
}

export async function listActiveBranches(actor: AuthUser): Promise<readonly BranchOption[]> {
  return withUser(toSession(actor), async (client) => {
    const { rows } = await client.query("select id, name from branches where active order by name");
    return rows.map((row) => ({ id: row.id, name: row.name }));
  });
}

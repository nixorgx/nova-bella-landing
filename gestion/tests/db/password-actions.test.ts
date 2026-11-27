import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/guards";
import { decodeSession, SESSION_COOKIE } from "@/lib/auth/session";
import { createBranch, createUser } from "../helpers/fixtures";
import { systemQuery } from "../helpers/system";

const cookieSet = vi.fn();
let signedIn: AuthUser;

vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet, get: vi.fn() }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("@/lib/auth/guards", async (original) => ({
  ...(await original<typeof import("@/lib/auth/guards")>()),
  requireSessionUser: async () => signedIn,
  requireRole: async () => signedIn,
}));

import { changeOwnPasswordAction, resetUserPasswordAction } from "@/features/account/actions";

const CURRENT = "clave-actual-123";
const form = (values: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
};

async function newSeller(mustChange = false): Promise<AuthUser> {
  const branch = await createBranch();
  const session = await createUser("seller", branch);
  await systemQuery("update users set password_hash = $2, must_change_password = $3 where id = $1", [session.userId, bcrypt.hashSync(CURRENT, 4), mustChange]);
  // the trigger bumps the version on a password change: start every scenario from a known 0
  await systemQuery("update users set token_version = 0 where id = $1", [session.userId]);
  const { rows } = await systemQuery<{ username: string }>("select username from users where id = $1", [session.userId]);
  return { id: session.userId, username: rows[0].username, fullName: "Vendedora Prueba", role: "seller", branchId: branch, branchName: "S", mustChangePassword: mustChange };
}

const stored = async (id: string) => (await systemQuery<{ password_hash: string; token_version: number }>("select password_hash, token_version from users where id = $1", [id])).rows[0];

beforeEach(() => cookieSet.mockReset());

describe("changeOwnPasswordAction", () => {
  it("changes the password, re-issues this session with the new token version and tells nothing sensitive", async () => {
    signedIn = await newSeller();
    const state = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-9" }));
    expect(state).toMatchObject({ ok: true });
    expect(JSON.stringify(state)).not.toContain("frase-nueva-segura-9");
    const after = await stored(signedIn.id);
    expect(await bcrypt.compare("frase-nueva-segura-9", after.password_hash)).toBe(true);
    expect(after.token_version).toBe(1);
    const [name, token] = cookieSet.mock.calls[0];
    expect(name).toBe(SESSION_COOKIE);
    expect(await decodeSession(token)).toMatchObject({ userId: signedIn.id, tokenVersion: 1, role: "seller" });
  });

  it("a wrong current password gives one clear message, changes nothing and issues no cookie", async () => {
    signedIn = await newSeller();
    const state = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: "no-es-esta-123456", newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-9" }));
    expect(state).toEqual({ ok: false, fieldErrors: { currentPassword: "La contraseña actual no es correcta." } });
    expect((await stored(signedIn.id)).token_version).toBe(0);
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("blocks after five wrong tries, even when the sixth would have been right", async () => {
    signedIn = await newSeller();
    const wrong = form({ currentPassword: "no-es-esta-123456", newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-9" });
    for (let i = 0; i < 5; i += 1) await changeOwnPasswordAction({ ok: false }, wrong);
    const blocked = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-9" }));
    expect(blocked.ok).toBe(false);
    expect(blocked.message).toMatch(/Demasiados intentos\. Espere \d+ min/);
    expect((await stored(signedIn.id)).token_version).toBe(0);
  });

  it("enforces the policy: 12+ characters, different from the current one, confirmed", async () => {
    signedIn = await newSeller();
    const short = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: "corta", confirmPassword: "corta" }));
    expect(short.fieldErrors?.newPassword).toMatch(/al menos 12/);
    const same = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: CURRENT, confirmPassword: CURRENT }));
    expect(same.fieldErrors?.newPassword).toBe("La contraseña nueva debe ser distinta de la actual.");
    const mismatch = await changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-8" }));
    expect(mismatch.fieldErrors?.confirmPassword).toBe("Las contraseñas no coinciden.");
    expect((await stored(signedIn.id)).token_version).toBe(0);
  });

  it("after a forced change the user is sent to their home page", async () => {
    signedIn = await newSeller(true);
    await expect(
      changeOwnPasswordAction({ ok: false }, form({ currentPassword: CURRENT, newPassword: "frase-nueva-segura-9", confirmPassword: "frase-nueva-segura-9" })),
    ).rejects.toThrow("REDIRECT:/ventas");
    const { rows } = await systemQuery("select must_change_password from users where id = $1", [signedIn.id]);
    expect(rows[0].must_change_password).toBe(false);
  });
});

describe("resetUserPasswordAction (superadmin)", () => {
  it("resets another account, returns the temporary password once and flags the change", async () => {
    const target = await newSeller();
    const admin = await createUser("superadmin", null);
    signedIn = { id: admin.userId, username: "admin", fullName: "Admin", role: "superadmin", branchId: null, branchName: null, mustChangePassword: false };
    const state = await resetUserPasswordAction({ ok: false }, form({ userId: target.id, newPassword: "Temporal-Frase-47-x", mustChange: "on" }));
    expect(state).toMatchObject({ ok: true, temporaryPassword: "Temporal-Frase-47-x", targetUsername: target.username });
    const { rows } = await systemQuery("select must_change_password, token_version, password_hash from users where id = $1", [target.id]);
    expect(rows[0].must_change_password).toBe(true);
    expect(rows[0].token_version).toBe(1);
    expect(await bcrypt.compare("Temporal-Frase-47-x", rows[0].password_hash)).toBe(true);
    const noFlag = await resetUserPasswordAction({ ok: false }, form({ userId: target.id, newPassword: "Temporal-Frase-48-x" }));
    expect(noFlag.ok).toBe(true);
    expect((await systemQuery("select must_change_password from users where id = $1", [target.id])).rows[0].must_change_password).toBe(false);
  });

  it("rejects a short password and the superadmin's own id", async () => {
    const admin = await createUser("superadmin", null);
    signedIn = { id: admin.userId, username: "admin", fullName: "Admin", role: "superadmin", branchId: null, branchName: null, mustChangePassword: false };
    const target = await newSeller();
    expect((await resetUserPasswordAction({ ok: false }, form({ userId: target.id, newPassword: "corta" }))).fieldErrors?.newPassword).toMatch(/al menos 12/);
    expect((await resetUserPasswordAction({ ok: false }, form({ userId: admin.userId, newPassword: "Temporal-Frase-47-x" }))).ok).toBe(false);
  });
});

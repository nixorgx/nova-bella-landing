import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const loadAuthRecord = vi.fn();

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("@/lib/auth/auth-db", () => ({ loadAuthRecord: (...args: unknown[]) => loadAuthRecord(...args) }));

import { encodeSession } from "@/lib/auth/session";
import { getCurrentUser, requireRole, requireUser, toSession } from "@/lib/auth/guards";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  username: "vendedor1",
  fullName: "Vendedor Uno",
  role: "seller",
  branchId: "22222222-2222-4222-8222-222222222222",
  branchName: "Central",
  tokenVersion: 2,
};

async function signIn(role: "seller" | "superadmin" = "seller") {
  const token = await encodeSession({ userId: row.id, role, branchId: row.branchId, tokenVersion: row.tokenVersion });
  cookieGet.mockReturnValue({ value: token });
}

beforeEach(() => {
  cookieGet.mockReset();
  loadAuthRecord.mockReset();
});

describe("guards", () => {
  it("returns null without a cookie, with a bad cookie, or for inactive users", async () => {
    cookieGet.mockReturnValue(undefined);
    expect(await getCurrentUser()).toBeNull();
    cookieGet.mockReturnValue({ value: "garbage" });
    expect(await getCurrentUser()).toBeNull();
    await signIn();
    loadAuthRecord.mockResolvedValue(null);
    expect(await getCurrentUser()).toBeNull();
  });

  it("loads the user from the database, not from the token", async () => {
    await signIn("superadmin");
    loadAuthRecord.mockResolvedValue(row);
    const user = await getCurrentUser();
    expect(user).toMatchObject({ role: "seller", fullName: "Vendedor Uno", branchName: "Central" });
    expect(toSession(user!)).toEqual({ userId: row.id, role: "seller", branchId: row.branchId });
  });

  it("rejects a token whose version no longer matches the database (logout-all, password change)", async () => {
    await signIn();
    loadAuthRecord.mockResolvedValue({ ...row, tokenVersion: row.tokenVersion + 1 });
    expect(await getCurrentUser()).toBeNull();
  });

  it("requireUser redirects to /login", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("clears a dead session cookie through the reset route instead of looping on /login", async () => {
    await signIn();
    loadAuthRecord.mockResolvedValue(null);
    await expect(requireUser()).rejects.toThrow("REDIRECT:/api/sesion/reiniciar");
  });

  it("requireRole sends other roles home", async () => {
    await signIn();
    loadAuthRecord.mockResolvedValue(row);
    await expect(requireRole("superadmin")).rejects.toThrow("REDIRECT:/ventas");
    await expect(requireRole("seller", "superadmin")).resolves.toMatchObject({ username: "vendedor1" });
  });
});

describe("forced password change", () => {
  it("getCurrentUser is null and requireUser redirects to the change page; requireSessionUser still returns the user", async () => {
    const { requireSessionUser } = await import("@/lib/auth/guards");
    await signIn();
    loadAuthRecord.mockResolvedValue({ ...row, mustChangePassword: true });
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser()).rejects.toThrow("REDIRECT:/cuenta/contrasena");
    await expect(requireSessionUser()).resolves.toMatchObject({ username: "vendedor1", mustChangePassword: true });
  });
});

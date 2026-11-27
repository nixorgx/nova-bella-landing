import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withUser } from "@/lib/db";

const UID = "11111111-1111-4111-8111-111111111111";
const session = { userId: UID, role: "seller", branchId: UID } as const;

function fakePool(queryImpl: (text: string) => Promise<unknown>) {
  const release = vi.fn();
  const client = { query: vi.fn((text: string) => queryImpl(text)), release };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  (globalThis as unknown as { __inventarioPools?: Record<string, Pool> }).__inventarioPools = { seller: pool };
  return { client, release };
}

afterEach(() => {
  (globalThis as unknown as { __inventarioPools?: unknown }).__inventarioPools = undefined;
});

describe("withUser pooling", () => {
  it("releases the client normally after a successful transaction", async () => {
    const { release, client } = fakePool(async () => ({ rows: [] }));
    await withUser(session, async () => "ok");
    expect(release).toHaveBeenCalledWith(false);
    expect(client.query.mock.calls.map(([text]) => String(text).split(" ")[0])).toEqual(["begin", "select", "commit"]);
  });

  it("rolls back and returns a healthy client to the pool when the work fails", async () => {
    const { release, client } = fakePool(async () => ({ rows: [] }));
    await expect(withUser(session, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(client.query).toHaveBeenCalledWith("rollback");
    expect(release).toHaveBeenCalledWith(false);
  });

  it("destroys the connection (release(true)) when ROLLBACK itself fails", async () => {
    const { release } = fakePool(async (text) => {
      if (text === "rollback") throw new Error("connection lost");
      return { rows: [] };
    });
    await expect(withUser(session, async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("refuses roles that have no pool", async () => {
    fakePool(async () => ({ rows: [] }));
    await expect(withUser({ ...session, role: "auth" as never }, async () => 1)).rejects.toThrow(/Rol de sesion invalido/);
  });
});

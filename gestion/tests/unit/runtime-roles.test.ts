import { describe, expect, it } from "vitest";
import { readRuntimeCredentials } from "../../scripts/lib/runtime-roles";

const env = {
  DATABASE_URL_SELLER: "postgres://app_runtime_seller:pw%40s@localhost:5433/inventario",
  DATABASE_URL_SUPERADMIN: "postgres://app_runtime_superadmin:pw-admin@localhost:5433/inventario",
  DATABASE_URL_AUTH: "postgres://app_runtime_auth:pw-auth@localhost:5433/inventario",
  DATABASE_URL_PUBLIC: "postgres://app_runtime_public:pw-public@localhost:5433/inventario",
  DB_CONTEXT_SECRET: "c".repeat(40),
};

describe("readRuntimeCredentials", () => {
  it("extracts and decodes the passwords and the context secret", () => {
    expect(readRuntimeCredentials(env)).toEqual({
      passwords: { DATABASE_URL_SELLER: "pw@s", DATABASE_URL_SUPERADMIN: "pw-admin", DATABASE_URL_AUTH: "pw-auth", DATABASE_URL_PUBLIC: "pw-public" },
      contextSecret: "c".repeat(40),
    });
  });

  it("refuses missing URLs, wrong login names, empty passwords and short secrets", () => {
    expect(() => readRuntimeCredentials({ ...env, DATABASE_URL_SELLER: undefined })).toThrow(/DATABASE_URL_SELLER/);
    expect(() =>
      readRuntimeCredentials({ ...env, DATABASE_URL_SELLER: "postgres://postgres:pw@localhost:5433/inventario" }),
    ).toThrow(/app_runtime_seller/);
    expect(() =>
      readRuntimeCredentials({ ...env, DATABASE_URL_AUTH: "postgres://app_runtime_auth@localhost:5433/inventario" }),
    ).toThrow(/contrasena/);
    expect(() => readRuntimeCredentials({ ...env, DB_CONTEXT_SECRET: "short" })).toThrow(/32/);
  });
});

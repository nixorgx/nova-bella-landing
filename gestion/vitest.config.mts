import { randomBytes } from "node:crypto";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Same files the app and scripts read; values already in the environment win.
loadDotenv({ path: path.join(import.meta.dirname, ".env.local"), quiet: true });

// The test database is always a dedicated, disposable `*_test` database.
process.env.TEST_DATABASE_URL ??= "postgres://postgres@localhost:5433/inventario_test";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const testDatabaseName = new URL(testDatabaseUrl).pathname;

// Runtime roles are cluster-wide, so tests reuse the credentials from .env.local (global
// setup applies them) and only point them at the test database. When they are not set (CI),
// throwaway random passwords are generated for this run: nothing credential-like is committed.
const RUNTIME_LOGINS = {
  DATABASE_URL_SELLER: "app_runtime_seller",
  DATABASE_URL_SUPERADMIN: "app_runtime_superadmin",
  DATABASE_URL_AUTH: "app_runtime_auth",
  DATABASE_URL_PUBLIC: "app_runtime_public",
} as const;

function throwawaySecret(): string {
  return randomBytes(24).toString("base64url");
}

// Global setup runs in this process and workers get `test.env`; both must agree on the
// credentials, so fallbacks are written to process.env too.
for (const [name, login] of Object.entries(RUNTIME_LOGINS)) {
  if (process.env[name]) continue;
  const url = new URL(testDatabaseUrl);
  url.username = login;
  url.password = throwawaySecret();
  process.env[name] = url.toString();
}
process.env.DB_CONTEXT_SECRET ??= throwawaySecret();
const sessionSecret = throwawaySecret();

function runtimeUrl(name: keyof typeof RUNTIME_LOGINS): string {
  const url = new URL(process.env[name] as string);
  url.pathname = testDatabaseName;
  return url.toString();
}

const runtimeEnv = {
  DATABASE_URL_SELLER: runtimeUrl("DATABASE_URL_SELLER"),
  DATABASE_URL_SUPERADMIN: runtimeUrl("DATABASE_URL_SUPERADMIN"),
  DATABASE_URL_AUTH: runtimeUrl("DATABASE_URL_AUTH"),
  DATABASE_URL_PUBLIC: runtimeUrl("DATABASE_URL_PUBLIC"),
};

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    env: {
      // Owner connection: fixtures and migrations only (tests/helpers/system.ts).
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      ...runtimeEnv,
      SESSION_SECRET: sessionSecret,
      DB_CONTEXT_SECRET: process.env.DB_CONTEXT_SECRET,
      // Cheap hashes keep user-creation tests fast; production default is 12.
      BCRYPT_COST: "4",
    },
    testTimeout: 20_000,
    hookTimeout: 60_000,
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      reporter: ["text-summary", "text"],
    },
  },
});

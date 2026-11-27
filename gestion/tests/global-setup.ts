import { isLocalDatabase, recreateDatabase, runMigrations } from "../scripts/lib/migrator";
import { configureRuntime } from "../scripts/lib/runtime-roles";

/** Builds a fresh `inventario_test` database once per test run. */
export default async function setup(): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL no esta definida");
  if (!isLocalDatabase(url) || !/_test$/.test(new URL(url).pathname)) {
    throw new Error("Las pruebas solo pueden correr contra una base local terminada en _test");
  }
  await recreateDatabase(url);
  await runMigrations(url);
  await configureRuntime(url);
}

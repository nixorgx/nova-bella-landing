import { say, warn } from "./lib/log";
import { loadEnv, requireDatabaseUrl } from "./lib/load-env";
import { isLocalDatabase, recreateDatabase, runMigrations } from "./lib/migrator";
import { configureRuntime } from "./lib/runtime-roles";
import { runSeed } from "./seed-data";

async function main(): Promise<void> {
  loadEnv();
  const url = requireDatabaseUrl();
  if (!isLocalDatabase(url) && !process.argv.includes("--allow-remote")) {
    throw new Error("db:reset solo corre contra una base local (use --allow-remote bajo su riesgo).");
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("db:reset esta deshabilitado en produccion.");
  }
  await recreateDatabase(url);
  const result = await runMigrations(url);
  await configureRuntime(url);
  say(`migraciones aplicadas: ${result.applied.length}`);
  await runSeed(url);
}

main().catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});

import { say, warn } from "./lib/log";
import { loadEnv, requireDatabaseUrl } from "./lib/load-env";
import { runMigrations } from "./lib/migrator";
import { configureRuntime } from "./lib/runtime-roles";

async function main(): Promise<void> {
  loadEnv();
  const url = requireDatabaseUrl();
  const result = await runMigrations(url);
  await configureRuntime(url);
  for (const name of result.applied) say(`aplicada  ${name}`);
  say(`${result.applied.length} aplicadas, ${result.skipped.length} ya existentes`);
}

main().catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});

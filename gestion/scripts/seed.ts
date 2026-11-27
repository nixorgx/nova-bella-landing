import { warn } from "./lib/log";
import { loadEnv, requireDatabaseUrl } from "./lib/load-env";
import { runSeed } from "./seed-data";

loadEnv();
runSeed(requireDatabaseUrl()).catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});

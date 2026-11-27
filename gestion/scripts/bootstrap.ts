import { say, warn } from "./lib/log";
import { loadEnv, requireDatabaseUrl } from "./lib/load-env";
import { readBootstrapConfig, runBootstrap } from "./lib/bootstrap";

async function main(): Promise<void> {
  loadEnv();
  const config = readBootstrapConfig(process.env, process.argv.slice(2));
  const result = await runBootstrap(requireDatabaseUrl(), config);
  say(
    result.adminCreated
      ? `superadmin "${config.username}" creado.`
      : result.adminPasswordReset
        ? `superadmin "${config.username}": contraseña restablecida.`
        : `superadmin "${config.username}" ya existía (no se tocó su contraseña; use --reset-password para cambiarla).`,
  );
  say(result.branchesCreated.length ? `sucursales creadas: ${result.branchesCreated.join(", ")}` : "no hubo sucursales nuevas.");
  say("bootstrap listo. No se insertó ningún dato de demostración.");
}

main().catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});

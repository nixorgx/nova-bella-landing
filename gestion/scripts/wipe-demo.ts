import { say, warn } from "./lib/log";
import { loadEnv, requireDatabaseUrl } from "./lib/load-env";
import { isLocalDatabase } from "./lib/migrator";
import { WIPE_CONFIRMATION, wipeDemoData } from "./lib/wipe";

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const url = requireDatabaseUrl();
  if (!args.includes(`--confirm=${WIPE_CONFIRMATION}`)) {
    throw new Error(
      `Esto BORRA ventas, stock, compras, clientes, cajas y vendedores. Para continuar: npm run db:wipe-demo -- --confirm=${WIPE_CONFIRMATION}`,
    );
  }
  if (!isLocalDatabase(url) && !args.includes("--allow-remote")) {
    throw new Error("La base no es local. Si de verdad quiere limpiar la base remota, agregue --allow-remote.");
  }
  const result = await wipeDemoData(url, { keepCatalog: args.includes("--keep-catalog") });
  say(`limpieza lista: ${result.tables.length} tablas vaciadas, ${result.sellersRemoved} vendedores eliminados.`);
  say("Se conservaron sucursales, superadmin, configuración e historial de migraciones.");
}

main().catch((error: Error) => {
  warn(error.message);
  process.exit(1);
});

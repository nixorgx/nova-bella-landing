import { config } from "dotenv";
import path from "node:path";

/** Loads .env.local then .env (first value wins). Safe to call repeatedly. */
export function loadEnv(): void {
  const root = path.resolve(__dirname, "../..");
  config({ path: path.join(root, ".env.local"), quiet: true });
  config({ path: path.join(root, ".env"), quiet: true });
}

export function requireDatabaseUrl(name = "DATABASE_URL"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Copie .env.example a .env.local.`);
  }
  return value;
}

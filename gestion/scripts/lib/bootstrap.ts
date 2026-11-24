import bcrypt from "bcryptjs";
import { Client } from "pg";
import { bcryptCost } from "../../src/lib/env";
import { MIN_SEED_PASSWORD_LENGTH } from "./seed-passwords";

/** Production bootstrap: ONLY the superadmin, the first branch(es) and the default settings. No demo data. */
export interface BranchSpec {
  readonly name: string;
  readonly city: string | null;
  readonly active: boolean;
}

export interface BootstrapConfig {
  readonly username: string;
  readonly fullName: string;
  readonly password: string;
  readonly branches: readonly BranchSpec[];
  readonly resetPassword: boolean;
}

export interface BootstrapResult {
  readonly adminCreated: boolean;
  readonly adminPasswordReset: boolean;
  readonly branchesCreated: readonly string[];
}

const USERNAME = /^[a-z0-9._-]{3,32}$/;
export const DEFAULT_BRANCHES = "Central:Santa Cruz;La Paz:La Paz:inactiva";

/**
 * "Name:City[:inactiva]" entries separated by ";". The city may be empty ("Central::"). A branch
 * is active unless it says "inactiva" (La Paz opens mid-year: create it now, activate it later).
 */
export function parseBranches(raw: string): BranchSpec[] {
  const specs = raw
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry): BranchSpec => {
      const [name = "", city = "", state = ""] = entry.split(":").map((part) => part.trim());
      if (name.length < 2 || name.length > 60) throw new Error(`Sucursal no válida: "${entry}". Use Nombre:Ciudad[:inactiva].`);
      if (city.length > 60) throw new Error(`La ciudad de "${name}" es demasiado larga.`);
      if (state !== "" && state.toLowerCase() !== "inactiva" && state.toLowerCase() !== "activa") {
        throw new Error(`Estado no válido para "${name}": use "activa" o "inactiva".`);
      }
      return { name, city: city || null, active: state.toLowerCase() !== "inactiva" };
    });
  if (specs.length === 0) throw new Error("Defina al menos una sucursal en BOOTSTRAP_BRANCHES.");
  if (!specs.some((spec) => spec.active)) throw new Error("Al menos una sucursal debe quedar activa.");
  const names = specs.map((spec) => spec.name.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("Hay sucursales repetidas en BOOTSTRAP_BRANCHES.");
  return specs;
}

/** Reads and validates the configuration from the environment (nothing is hardcoded). */
export function readBootstrapConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
  argv: readonly string[] = [],
): BootstrapConfig {
  const password = env.BOOTSTRAP_SUPERADMIN_PASSWORD ?? "";
  if (password.length < MIN_SEED_PASSWORD_LENGTH) {
    throw new Error(`Defina BOOTSTRAP_SUPERADMIN_PASSWORD (mínimo ${MIN_SEED_PASSWORD_LENGTH} caracteres).`);
  }
  if (new TextEncoder().encode(password).length > 72) throw new Error("BOOTSTRAP_SUPERADMIN_PASSWORD no puede pasar de 72 bytes.");
  const username = (env.BOOTSTRAP_SUPERADMIN_USERNAME ?? "naty").trim().toLowerCase();
  if (!USERNAME.test(username)) throw new Error("BOOTSTRAP_SUPERADMIN_USERNAME debe tener 3 a 32 caracteres: letras, números, punto o guion.");
  const fullName = (env.BOOTSTRAP_SUPERADMIN_NAME ?? "Administradora").trim();
  if (fullName.length < 2 || fullName.length > 80) throw new Error("BOOTSTRAP_SUPERADMIN_NAME debe tener entre 2 y 80 caracteres.");
  return {
    username,
    fullName,
    password,
    branches: parseBranches(env.BOOTSTRAP_BRANCHES ?? DEFAULT_BRANCHES),
    resetPassword: argv.includes("--reset-password"),
  };
}

/**
 * Idempotent. Creates the superadmin if missing (an existing one keeps its password unless
 * `--reset-password`), creates missing branches (never touches existing ones) and makes sure the
 * default settings rows exist (the migrations already insert them; this only repairs a wiped table).
 */
export async function runBootstrap(databaseUrl: string, config: BootstrapConfig): Promise<BootstrapResult> {
  const hash = await bcrypt.hash(config.password, bcryptCost());
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{ role: string }>("select role from users where lower(username) = $1", [config.username]);
    if (existing.rows[0] && existing.rows[0].role !== "superadmin") {
      throw new Error(`El usuario "${config.username}" ya existe y no es superadmin.`);
    }
    let adminCreated = false;
    let adminPasswordReset = false;
    if (!existing.rows[0]) {
      await client.query(
        "insert into users (username, full_name, password_hash, role, branch_id) values ($1, $2, $3, 'superadmin', null)",
        [config.username, config.fullName, hash],
      );
      adminCreated = true;
    } else if (config.resetPassword) {
      await client.query("update users set password_hash = $2, active = true where lower(username) = $1", [config.username, hash]);
      adminPasswordReset = true;
    }
    const branchesCreated: string[] = [];
    for (const branch of config.branches) {
      const result = await client.query(
        "insert into branches (name, city, active) values ($1, $2, $3) on conflict ((lower(name))) do nothing",
        [branch.name, branch.city, branch.active],
      );
      if ((result.rowCount ?? 0) > 0) branchesCreated.push(branch.name);
    }
    await client.query(
      `insert into app_settings (key, value) values ('target_margin_pct', '40'), ('max_discount_pct', null)
       on conflict (key) do nothing`,
    );
    // Store defaults (the migration inserts them too): the shop starts CLOSED, with nothing published.
    await client.query(
      `insert into app_settings (key, value) values ('store_open', 'false'), ('store_whatsapp', null), ('store_branch_id', null),
         ('store_bank_instructions', null), ('store_policy_exchange', null), ('store_policy_shipping', null)
       on conflict (key) do nothing`,
    );
    await client.query("commit");
    return { adminCreated, adminPasswordReset, branchesCreated };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

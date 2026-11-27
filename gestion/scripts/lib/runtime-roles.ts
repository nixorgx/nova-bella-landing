import { Client } from "pg";

/** Login roles created (NOLOGIN) by migration 009; this module turns them on. */
export const RUNTIME_ROLES = {
  DATABASE_URL_SELLER: "app_runtime_seller",
  DATABASE_URL_SUPERADMIN: "app_runtime_superadmin",
  DATABASE_URL_AUTH: "app_runtime_auth",
  /** Anonymous store traffic (migration 019): EXECUTE on public_*() functions only. */
  DATABASE_URL_PUBLIC: "app_runtime_public",
} as const;

export type RuntimeEnvName = keyof typeof RUNTIME_ROLES;

export const MIN_CONTEXT_SECRET_LENGTH = 32;

export interface RuntimeCredentials {
  readonly passwords: Readonly<Record<RuntimeEnvName, string>>;
  readonly contextSecret: string;
}

/** Extracts and validates the runtime role passwords and the context secret from env. */
export function readRuntimeCredentials(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RuntimeCredentials {
  const passwords = {} as Record<RuntimeEnvName, string>;
  for (const name of Object.keys(RUNTIME_ROLES) as RuntimeEnvName[]) {
    const raw = env[name];
    if (!raw) throw new Error(`Falta la variable de entorno ${name}. Copie .env.example a .env.local.`);
    const url = new URL(raw);
    const expected = RUNTIME_ROLES[name];
    if (decodeURIComponent(url.username) !== expected) {
      throw new Error(`${name} debe conectarse con el usuario ${expected}.`);
    }
    if (!url.password) throw new Error(`${name} necesita una contrasena.`);
    passwords[name] = decodeURIComponent(url.password);
  }
  const contextSecret = env.DB_CONTEXT_SECRET ?? "";
  if (contextSecret.length < MIN_CONTEXT_SECRET_LENGTH) {
    throw new Error(`DB_CONTEXT_SECRET debe tener al menos ${MIN_CONTEXT_SECRET_LENGTH} caracteres.`);
  }
  return { passwords, contextSecret };
}

/**
 * Enables LOGIN with the configured passwords and stores the context-signing secret in
 * the target database. Runs as the admin (owner) login; safe to repeat after migrations.
 */
export async function configureRuntime(
  adminUrl: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const credentials = readRuntimeCredentials(env);
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const name of Object.keys(RUNTIME_ROLES) as RuntimeEnvName[]) {
      const { rows } = await client.query<{ sql: string }>(
        "select format('alter role %I with login password %L', $1::text, $2::text) as sql",
        [RUNTIME_ROLES[name], credentials.passwords[name]],
      );
      await client.query(rows[0].sql);
    }
    await ensureDefinerPolicies(client);
    await client.query(
      `insert into app_private.settings (key, value) values ('context_secret', $1)
       on conflict (key) do update set value = excluded.value`,
      [credentials.contextSecret],
    );
  } finally {
    await client.end();
  }
}

/** `auto` tries BYPASSRLS and falls back; `false` skips it (policy mode); `true` requires it. */
export type DefinerBypassMode = "auto" | "true" | "false";

export function readDefinerBypassMode(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DefinerBypassMode {
  const raw = (env.APP_DEFINER_BYPASSRLS ?? "auto").trim().toLowerCase();
  if (raw === "auto" || raw === "true" || raw === "false") return raw;
  throw new Error("APP_DEFINER_BYPASSRLS debe ser auto, true o false.");
}

/**
 * Creates `app_definer` BEFORE migration 009 (which only creates it when missing), so a host
 * that forbids BYPASSRLS to the migration owner (managed Postgres such as Neon) still works:
 * the role is then created without it and `ensureDefinerPolicies` adds `to app_definer`
 * policies instead. Also lets a non-superuser migration owner own objects as `app_definer`.
 * Idempotent; safe to run on every migration.
 */
export async function prepareDefinerRole(
  client: Client,
  mode: DefinerBypassMode = readDefinerBypassMode(),
): Promise<void> {
  const create = {
    auto: `begin
             create role app_definer nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;
           exception when insufficient_privilege then
             create role app_definer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
           end;`,
    true: "create role app_definer nologin nosuperuser nocreatedb nocreaterole noinherit bypassrls;",
    false: "create role app_definer nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;",
  }[mode];
  await client.query(`
    do $$
    begin
      if not exists (select 1 from pg_roles where rolname = 'app_definer') then
        ${create}
      end if;
      -- ALTER ... OWNER TO app_definer needs the owner to be able to SET ROLE to it.
      if not (select rolsuper from pg_roles where rolname = current_user)
         and not pg_has_role(current_user, 'app_definer', 'SET') then
        execute format('grant app_definer to %I', current_user);
      end if;
    end
    $$`);
  // A non-superuser owner can only hand objects to app_definer if it may create in the schema;
  // the privilege is lent for the duration of the migration run (see `revokeDefinerCreate`).
  await client.query("create schema if not exists app_private");
  await client.query("grant create on schema public, app_private to app_definer");
}

/** Takes back the temporary CREATE privilege lent by `prepareDefinerRole`. */
export async function revokeDefinerCreate(client: Client): Promise<void> {
  await client.query("revoke create on schema public, app_private from app_definer");
}

/**
 * When `app_definer` lacks BYPASSRLS, gives it a permissive policy on every table with row
 * level security (the grants in 009/011 still limit what it can touch). Idempotent; runs
 * after every migration so tables added later are covered too.
 */
export async function ensureDefinerPolicies(client: Client): Promise<void> {
  await client.query(`
    do $$
    declare
      tbl record;
    begin
      if exists (select 1 from pg_roles where rolname = 'app_definer' and rolbypassrls) then
        return;
      end if;
      for tbl in
        select c.oid::regclass as rel, c.relname
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      loop
        if not exists (select 1 from pg_policies where schemaname = 'public'
                          and tablename = tbl.relname and policyname = 'definer_all') then
          execute format('create policy definer_all on %s for all to app_definer using (true) with check (true)', tbl.rel);
        end if;
      end loop;
    end
    $$`);
}

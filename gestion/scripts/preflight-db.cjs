// One-time deployment diagnostic. Never log database connection strings, credentials or query results.
const { Client } = require("pg");
const { createHmac } = require("node:crypto");
let adminId;

function makeConnection(kind) {
  const value = process.env["DATABASE_URL_" + kind];
  if (!value) throw Object.assign(new Error("missing database URL"), { code: "MISSING_URL" });
  const url = new URL(value);
  const host = process.env.SUPABASE_POOLER_HOST?.trim().toLowerCase();
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    if (host) {
      if (!/^aws-[0-9]+-us-west-2\.pooler\.supabase\.com$/.test(host)) throw new Error("invalid Supabase pooler host");
      url.hostname = host;
    }
    const ref = process.env.SUPABASE_PROJECT_REF?.trim();
    if (!ref || !/^[a-z0-9]{20}$/.test(ref)) throw new Error("invalid project reference");
    const role = decodeURIComponent(url.username);
    if (!role.endsWith("." + ref)) {
      if (role.includes(".")) throw new Error("wrong project reference");
      url.username = role + "." + ref;
    }
  }
  const ca = process.env.SUPABASE_CA_CERT?.replace(/\\n/g, "\n").trim();
  if (ca) {
    for (const k of ["sslmode", "sslrootcert", "sslcert", "sslkey", "uselibpqcompat"]) url.searchParams.delete(k);
  }
  return { connectionString: url.toString(), ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}), connectionTimeoutMillis: 12000 };
}
(async () => {
 for (const kind of ["AUTH", "PUBLIC", "SUPERADMIN"]) {
   let client;
   try {
     client = new Client(makeConnection(kind));
     await client.connect();
     await client.query("select 1");
     if (kind === "SUPERADMIN") {
       const secret = process.env.DB_CONTEXT_SECRET;
       if (!secret || secret.length < 32 || !adminId) throw Object.assign(new Error("context not configured"), { code: "CONTEXT_MISSING" });
       const expiry = Math.floor(Date.now() / 1000) + 60;
       const signature = createHmac("sha256", secret).update(adminId + "|-|" + expiry).digest("hex");
       const token = adminId + ".-." + expiry + "." + signature;
       await client.query("begin");
       try {
         await client.query("select set_config('app.ctx', $1, true)", [token]);
         const result = await client.query("select app_user_id() as id, app_role() as role");
         if (result.rows[0]?.id !== adminId || result.rows[0]?.role !== "superadmin") {
           throw Object.assign(new Error("context signature invalid"), { code: "DB_CONTEXT_MISMATCH" });
         }
       } finally { await client.query("rollback"); }
     }
     if (kind === "AUTH") {
       const found = await client.query("select * from auth_login_lookup($1)", ["naty"]);
       adminId = found.rows[0]?.id;
       if (!adminId) throw Object.assign(new Error("admin missing"), { code: "ADMIN_MISSING" });
       await client.query("begin");
       try {
         await client.query("select * from auth_reserve_attempt($1, $2, $3)", ["nova:build:preflight", 5, 60]);
         await client.query("select auth_clear_attempts($1)", ["nova:build:preflight"]);
       } finally {
         await client.query("rollback");
       }
     }
     console.log("[NovaBella build database preflight] " + kind + ": PASS");
   } catch (e) {
     const err = e && typeof e === "object" ? e : {};
     const code = String(err.code || err.cause?.code || "UNKNOWN").replace(/[^A-Za-z0-9_]/g, "").slice(0,48);
     const type = code === "UNKNOWN" ? (/certificate/i.test(err.message||"") ? "CERTIFICATE" : /tenant/i.test(err.message||"") ? "TENANT" : /password/i.test(err.message||"") ? "PASSWORD" : "UNKNOWN") : code;
     console.error("[NovaBella build database preflight] " + kind + ": FAIL category=" + type);
   } finally { if (client) await client.end().catch(()=>{}); }
 }
})().catch(() => { console.error("[NovaBella build database preflight] UNEXPECTED"); });

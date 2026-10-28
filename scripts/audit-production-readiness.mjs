// Read-only operational evidence. Never print credentials, users or clinical rows.
const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (!process.env.SUPABASE_ACCESS_TOKEN)
  throw Error("SUPABASE_ACCESS_TOKEN must be configured securely.");
async function get(path) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/${path}`,
    {
      headers: { Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN },
    },
  );
  if (!response.ok)
    throw Error(`Readiness check ${path}: HTTP ${response.status}`);
  return response.json();
}
const [auth, backups] = await Promise.all([
  get("config/auth"),
  get("database/backups"),
]);
const query = `select (select substring(v from length('pgrst.db_pre_request=')+1) from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig)v where r.rolname='authenticator' and v like 'pgrst.db_pre_request=%' limit 1) as api_guard,(select count(*)::int from auth.mfa_factors where status='verified') as verified_factors,(select max(version) from supabase_migrations.schema_migrations) as schema_version`;
const response = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/query`,
  {
    method: "POST",
    headers: {
      Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, read_only: true }),
  },
);
if (!response.ok)
  throw Error("Database readiness check: HTTP " + response.status);
const [database] = await response.json();
console.log(
  JSON.stringify(
    {
      checkedAt: new Date().toISOString(),
      authentication: {
        totpEnroll: auth.mfa_totp_enroll_enabled === true,
        totpVerify: auth.mfa_totp_verify_enabled === true,
        apiGuard: database.api_guard ?? null,
        verifiedFactors: database.verified_factors,
        sessionTimebox: auth.sessions_timebox ?? null,
        inactivityTimeout: auth.sessions_inactivity_timeout ?? null,
      },
      backups: {
        pitrEnabled: backups.pitr_enabled === true,
        visibleBackupCount: Array.isArray(backups.backups)
          ? backups.backups.length
          : null,
        restoreTest: "NOT_PERFORMED",
      },
      schemaVersion: database.schema_version,
    },
    null,
    2,
  ),
);

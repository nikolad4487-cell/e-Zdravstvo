// Uses the selected project's Management API. Defaults to a read-only plan.
// No reset, seed, credentials in files, or replay of existing migrations.
import { readFile, readdir } from "node:fs/promises";
import { migrationSql } from "./lib/migration-sql.mjs";
const url = process.env.VITE_SUPABASE_URL,
  token = process.env.SUPABASE_ACCESS_TOKEN;
if (!url || !token)
  throw new Error("Configured Supabase URL and access token required.");
const host = new URL(url).hostname;
if (!/^[a-z0-9]+\.supabase\.co$/.test(host))
  throw new Error("Unsupported project URL.");
const ref = host.split(".")[0],
  apply = process.argv.includes("--apply");
async function query(sql, readonly = true) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: sql, read_only: readonly }),
      signal: AbortSignal.timeout(60000),
    },
  );
  const data = await r.json();
  if (!r.ok)
    throw new Error(
      `Management API ${r.status}: ${data.message ?? "query failed"}`,
    );
  return data;
}
const files = (await readdir("supabase/migrations"))
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort();
const local = new Map(
  files.map((file) => {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    return [match[1], { file, name: match[2] }];
  }),
);
const remote = await query(
  "select version,name from supabase_migrations.schema_migrations order by version",
);
if (!Array.isArray(remote)) throw new Error("Unexpected migration history.");
for (const row of remote) {
  if (!local.has(row.version) || local.get(row.version).name !== row.name)
    throw new Error("Unrecognized remote migration: " + row.version);
}
const done = new Set(remote.map((row) => row.version));
const pending = [...local].filter(([version]) => !done.has(version));
if (pending.some(([version]) => remote.some((row) => row.version > version)))
  throw new Error("Historical migration gap: reconcile before applying.");
console.log(
  `${remote.length} existing migrations; ${pending.length} pending. ${apply ? "Applying" : "Read-only plan"}.`,
);
const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
for (const [version, { file, name }] of pending) {
  console.log((apply ? "APPLY " : "PENDING ") + file);
  if (!apply) continue;
  const source = await readFile("supabase/migrations/" + file, "utf8");
  await query(migrationSql(source, version, name), false);
  const verified = await query(
    `select version from supabase_migrations.schema_migrations where version=${quote(version)}`,
  );
  if (verified.length !== 1)
    throw new Error("Migration completion not confirmed: " + file);
  console.log("VERIFIED " + version);
}
if (apply) console.log("Migration application complete.");

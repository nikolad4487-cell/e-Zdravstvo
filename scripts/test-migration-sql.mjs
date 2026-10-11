import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { migrationSql } from "./lib/migration-sql.mjs";
const db = new PGlite();
try {
  await db.exec(
    "create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])",
  );
  const source =
    "begin;\ncreate function public.pattern() returns text language sql as $$select '^[0-9]{1,2}$'::text$$;\ncommit;\n";
  await db.exec(migrationSql(source, "test-1", "literal dollars"));
  assert.equal(
    (
      await db.query(
        "select statements[1] value from supabase_migrations.schema_migrations",
      )
    ).rows[0].value,
    source,
  );
  assert.equal(
    (await db.query("select pattern() value")).rows[0].value,
    "^[0-9]{1,2}$",
  );
  console.log(
    "PASS migration executes and preserves dollar-quoted SQL exactly",
  );
  await assert.rejects(
    db.exec(
      migrationSql(
        "begin;create table rollback_probe(id int);select missing_function();commit;",
        "test-2",
        "rollback",
      ),
    ),
  );
  await db.exec("rollback");
  assert.equal(
    (await db.query("select to_regclass('rollback_probe') value")).rows[0]
      .value,
    null,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from supabase_migrations.schema_migrations",
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS failed migration rolls back schema and migration record together",
  );
  assert.throws(() => migrationSql("select 1;", "test-3", "unwrapped"));
  console.log("PASS nontransactional migrations are rejected");
} finally {
  await db.close();
}

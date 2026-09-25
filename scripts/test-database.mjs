// Runs real PostgreSQL RLS using PGlite; only Supabase infrastructure is stubbed.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth; create schema storage;
  create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated,anon;
  grant execute on function auth.uid() to authenticated,anon;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`);
for (const file of [
  "202609250001_foundation.sql",
  "202609250002_private_storage.sql",
])
  await db.exec(
    await readFile(
      new URL(`../supabase/migrations/${file}`, import.meta.url),
      "utf8",
    ),
  );
await db.exec(
  await readFile(new URL("../supabase/seed.sql", import.meta.url), "utf8"),
);
const ids = {
  admin: "20000000-0000-4000-8000-000000000001",
  doctor: "20000000-0000-4000-8000-000000000002",
  patient: "20000000-0000-4000-8000-000000000003",
  school: "20000000-0000-4000-8000-000000000004",
  other: "20000000-0000-4000-8000-000000000005",
  nurse: "20000000-0000-4000-8000-000000000006",
  institution: "20000000-0000-4000-8000-000000000007",
};
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000003";
for (const id of Object.values(ids))
  await db.query(
    "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
    [id, JSON.stringify({ first_name: "Fictional", role: "SYSTEM_ADMIN" })],
  );
await db.exec(`insert into public.institutions(id,name,code) values('${otherOrg}','Other test institution','OTHER');
  insert into public.institution_users(institution_id,user_id) values('${org}','${ids.doctor}'),('${org}','${ids.nurse}'),('${org}','${ids.institution}'),('${otherOrg}','${ids.other}');
  insert into public.user_roles(user_id,role,institution_id) values('${ids.admin}','SYSTEM_ADMIN',null),('${ids.patient}','PATIENT',null),('${ids.school}','SCHOOL_ADMIN',null),('${ids.doctor}','DOCTOR','${org}'),('${ids.nurse}','NURSE','${org}'),('${ids.institution}','INSTITUTION_ADMIN','${org}'),('${ids.other}','DOCTOR','${otherOrg}');`);
let passed = 0;
async function asUser(user, action) {
  await db.exec(
    `set role authenticated; set request.jwt.claim.sub = '${ids[user]}';`,
  );
  try {
    return await action();
  } finally {
    await db.exec("reset role; reset request.jwt.claim.sub;");
  }
}
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`PASS ${name}`);
}
const rows = async (sql) => (await db.query(sql)).rows;
await test("all public tables enforce RLS", async () =>
  assert.equal(
    (
      await rows(
        "select count(*)::int as n from pg_tables where schemaname='public' and not rowsecurity",
      )
    )[0].n,
    0,
  ));
await test("profile trigger never accepts metadata roles", async () =>
  assert.equal(
    (
      await rows(
        `select count(*)::int as n from public.user_roles where role='SYSTEM_ADMIN'`,
      )
    )[0].n,
    1,
  ));
await test("patient reads only own profile", () =>
  asUser("patient", async () =>
    assert.deepEqual(
      (await rows("select id from profiles")).map((r) => r.id),
      [ids.patient],
    ),
  ));
await test("school cannot read other profiles or institutions", () =>
  asUser("school", async () => {
    assert.equal((await rows("select id from profiles")).length, 1);
    assert.equal((await rows("select id from institutions")).length, 0);
  }));
await test("doctor sees only assigned institution", () =>
  asUser("doctor", async () =>
    assert.deepEqual(
      (await rows("select id from institutions")).map((r) => r.id),
      [org],
    ),
  ));
await test("doctor cannot enumerate peer profiles", () =>
  asUser("doctor", async () =>
    assert.equal((await rows("select id from profiles")).length, 1),
  ));
await test("patient cannot grant own role", () =>
  asUser("patient", () =>
    assert.rejects(
      db.exec(
        `insert into user_roles(user_id,role) values('${ids.patient}','SYSTEM_ADMIN')`,
      ),
    ),
  ));
await test("patient cannot escalate using RPC", () =>
  asUser("patient", () =>
    assert.rejects(
      db.exec(`select assign_role('${ids.patient}','SYSTEM_ADMIN')`),
    ),
  ));
await test("profile owner cannot change demo or identity fields", () =>
  asUser("patient", () =>
    assert.rejects(
      db.exec(`update profiles set is_demo=true where id='${ids.patient}'`),
    ),
  ));
await test("profile name update is permitted and audited", async () => {
  await asUser("patient", () =>
    db.exec("update profiles set first_name='Updated'"),
  );
  assert.equal(
    (
      await rows(
        `select count(*)::int n from audit_logs where action='PROFILES_UPDATE' and user_id='${ids.patient}'`,
      )
    )[0].n,
    1,
  );
});
await test("institution admin sees scoped staff only", () =>
  asUser("institution", async () =>
    assert.deepEqual(
      new Set((await rows("select id from profiles")).map((r) => r.id)),
      new Set([ids.institution, ids.doctor, ids.nurse]),
    ),
  ));
await test("institution admin cannot grant system administrator", () =>
  asUser("institution", () =>
    assert.rejects(
      db.exec(`select assign_role('${ids.institution}','SYSTEM_ADMIN')`),
    ),
  ));
await test("institution admin cannot grant another institution role", () =>
  asUser("institution", () =>
    assert.rejects(
      db.exec(`select assign_role('${ids.other}','NURSE','${otherOrg}')`),
    ),
  ));
await test("institution admin can grant scoped clinical role", () =>
  asUser("institution", () =>
    db.exec(`select assign_role('${ids.nurse}','DOCTOR','${org}')`),
  ));
await test("suspended membership immediately removes effective roles", async () => {
  await db.exec(
    `update institution_users set active=false where user_id='${ids.nurse}'`,
  );
  await asUser("nurse", async () => {
    assert.equal((await rows("select id from user_roles")).length, 0);
    assert.equal((await rows("select id from institutions")).length, 0);
  });
});
await test("audit data is inaccessible to clinical users", () =>
  asUser("doctor", async () =>
    assert.equal((await rows("select id from audit_logs")).length, 0),
  ));
await test("audit rows cannot be forged by a client", () =>
  asUser("patient", () =>
    assert.rejects(
      db.exec(
        "insert into audit_logs(action,entity_type) values('FAKE','test')",
      ),
    ),
  ));
await test("session audit RPC rejects unsupported actions", () =>
  asUser("patient", () =>
    assert.rejects(
      db.exec("select record_session_event('PRESCRIPTION_ISSUED')"),
    ),
  ));
await test("session audit actor is derived from authenticated identity", async () => {
  await asUser("patient", () =>
    db.exec("select record_session_event('LOGIN_SUCCESS')"),
  );
  assert.equal(
    (
      await rows("select user_id from audit_logs where action='LOGIN_SUCCESS'")
    )[0].user_id,
    ids.patient,
  );
});
await test("even privileged audit updates are rejected", () =>
  assert.rejects(db.exec("update audit_logs set action='TAMPERED'")));
await test("audit truncate is rejected", () =>
  assert.rejects(db.exec("truncate audit_logs")));
await test("central admin can read organizational metadata", () =>
  asUser("admin", async () =>
    assert.equal((await rows("select id from institutions")).length, 2),
  ));
await test("anonymous access is denied", async () => {
  await db.exec("set role anon");
  try {
    await assert.rejects(db.exec("select * from profiles"));
    await assert.rejects(
      db.exec("select record_session_event('LOGIN_SUCCESS')"),
    );
  } finally {
    await db.exec("reset role");
  }
});
await test("document bucket is private", async () =>
  assert.equal(
    (
      await rows(
        "select public from storage.buckets where id='medical-documents'",
      )
    )[0].public,
    false,
  ));
console.log(
  `\n${passed} database checks passed. Supabase Auth/API/Storage integration must additionally be verified against a running Supabase instance.`,
);
await db.close();

import { PGlite } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

export async function workflowFixture() {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz,encrypted_password text,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema auth to authenticated,anon;
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
  }
  const id = (n) => `60000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const org = id(10),
    doc = id(20),
    otherDoc = id(21);
  for (let n = 1; n <= 6; n++)
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      id(n),
      `fictional${n}@example.test`,
    ]);
  await db.exec(`insert into institutions(id,name,code) values('${org}','Izmišljena ustanova','WORKFLOW');
    insert into institution_users(institution_id,user_id) values('${org}','${id(1)}'),('${org}','${id(2)}'),('${org}','${id(6)}');
    insert into user_roles(user_id,role,institution_id) values('${id(1)}','DOCTOR','${org}'),('${id(2)}','DOCTOR','${org}'),('${id(3)}','PATIENT',null),('${id(4)}','PATIENT',null),('${id(5)}','SYSTEM_ADMIN',null),('${id(6)}','NURSE','${org}');
    insert into doctors(id,user_id,institution_id,display_name) values('${doc}','${id(1)}','${org}','dr. Test'),('${otherDoc}','${id(2)}','${org}','dr. Drugi');`);
  async function as(n, fn) {
    await db.exec(
      `set role ${n === 0 ? "anon" : "authenticated"};set request.jwt.claim.sub='${n === 0 ? "" : id(n)}'`,
    );
    try {
      return await fn();
    } finally {
      await db.exec("reset role;reset request.jwt.claim.sub");
    }
  }
  async function rpc(name, args = []) {
    return (
      await db.query(
        `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) result`,
        args,
      )
    ).rows[0].result;
  }
  const patient = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Testna",
        last_name: "Osoba",
        birth_date: "2000-01-01",
        sex: "F",
      },
      doc,
    ]),
  );
  const secondPatient = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Druga",
        last_name: "Osoba",
        birth_date: "1990-01-01",
        sex: "M",
      },
      doc,
    ]),
  );
  await db.query("update patients set user_id=$1 where id=$2", [
    id(3),
    patient,
  ]);
  await db.query("update patients set user_id=$1 where id=$2", [
    id(4),
    secondPatient,
  ]);
  await db.query(
    "insert into patient_doctors(patient_id,doctor_id) values($1,$2)",
    [secondPatient, otherDoc],
  );
  return { db, id, org, doc, otherDoc, patient, secondPatient, as, rpc };
}

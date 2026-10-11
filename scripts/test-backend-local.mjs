// Disposable local Supabase only: never accepts a hosted project or real data.
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
if (process.env.ALLOW_DISPOSABLE_LOCAL_TESTS !== "true")
  throw new Error(
    "Set ALLOW_DISPOSABLE_LOCAL_TESTS=true for a disposable local Supabase instance.",
  );
const status = JSON.parse(
  execFileSync("supabase", ["status", "--output", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }),
);
const url = status.API_URL,
  key = status.ANON_KEY,
  service = status.SERVICE_ROLE_KEY;
if (
  !url ||
  !key ||
  !service ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname)
)
  throw new Error("Only local Supabase is allowed.");
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(url, service, options);
const password = "Local-Test-" + randomBytes(18).toString("hex"),
  run = randomUUID().slice(0, 8),
  org = randomUUID(),
  doc = randomUUID();
async function ok(result) {
  assert.equal(result.error, null);
  return result.data;
}
const clients = {},
  accounts = {};
for (const [name, role] of [
  ["doctor", "DOCTOR"],
  ["patient", "PATIENT"],
  ["other", "PATIENT"],
  ["administrator", "SYSTEM_ADMIN"],
]) {
  const email = `${name}-${run}@example.test`;
  const result = await ok(
    await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { first_name: "Fictional", last_name: name },
      app_metadata: { local_integration_test: true },
    }),
  );
  accounts[name] = { id: result.user.id, email };
  clients[name] = createClient(url, key, options);
  await ok(await clients[name].auth.signInWithPassword({ email, password }));
}
await ok(
  await admin.from("institutions").insert({
    id: org,
    name: "Fictional local integration institution",
    code: "CI-" + run,
  }),
);
await ok(
  await admin
    .from("institution_users")
    .insert({ institution_id: org, user_id: accounts.doctor.id }),
);
await ok(
  await admin.from("user_roles").insert(
    Object.entries(accounts).map(([name, a]) => ({
      user_id: a.id,
      role:
        name === "doctor"
          ? "DOCTOR"
          : name === "administrator"
            ? "SYSTEM_ADMIN"
            : "PATIENT",
      institution_id: name === "doctor" ? org : null,
    })),
  ),
);
await ok(
  await admin.from("doctors").insert({
    id: doc,
    user_id: accounts.doctor.id,
    institution_id: org,
    display_name: "Fictional CI doctor",
  }),
);
const patient = await ok(
  await clients.doctor.rpc("create_patient", {
    data: {
      first_name: "Fictional",
      last_name: "CI patient",
      birth_date: "2000-01-01",
      sex: "UNKNOWN",
    },
    doctor_id: doc,
  }),
);
await ok(
  await admin
    .from("patients")
    .update({ user_id: accounts.patient.id })
    .eq("id", patient),
);
const anon = createClient(url, key, options);
assert.equal(
  await ok(await anon.rpc("application_schema_version")),
  2026101103,
);
assert.ok((await anon.rpc("get_patient_chart", { patient_id: patient })).error);
assert.ok(
  (await clients.other.rpc("get_patient_chart", { patient_id: patient })).error,
);
assert.ok(
  (
    await clients.administrator.rpc("get_patient_chart", {
      patient_id: patient,
    })
  ).error,
);
assert.equal(
  (await ok(await clients.patient.rpc("get_my_chart"))).patient.id,
  patient,
);
assert.equal(
  (
    await ok(
      await clients.doctor.rpc("get_patient_chart", { patient_id: patient }),
    )
  ).can_write,
  true,
);
assert.ok(
  (
    await clients.patient.rpc("update_patient_record", {
      patient_id: patient,
      blood_group: "A+",
      warnings: "Unauthorized",
    })
  ).error,
);
const hidden = await clients.other
  .from("patients")
  .select("id")
  .eq("id", patient);
assert.equal(hidden.data?.length ?? 0, 0);
assert.ok(
  (
    await clients.patient.rpc("configure_notification_delivery", {
      enabled: true,
    })
  ).error,
);
// Edge Function must validate Auth itself when gateway verify_jwt is disabled.
let response;
for (let attempt = 0; attempt < 30; attempt++) {
  try {
    response = await fetch(url + "/functions/v1/document-files", {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status === 401) break;
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
assert.equal(response?.status, 401);
await writeFile(
  ".env.live-tests",
  [
    `VITE_SUPABASE_URL=${url}`,
    `VITE_SUPABASE_ANON_KEY=${key}`,
    `E2E_PATIENT_EMAIL=${accounts.patient.email}`,
    `E2E_PATIENT_PASSWORD=${password}`,
  ].join("\n") + "\n",
  { mode: 0o600 },
);
for (const client of Object.values(clients)) await client.auth.signOut();
console.log(
  "10 local Auth, PostgREST, RLS and Edge authorization checks passed. Fictional fixtures retained in disposable local database.",
);

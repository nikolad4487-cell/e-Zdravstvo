import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: key,
  DEMO_PASSWORD: password,
  ALLOW_DEMO_SEED: allow,
} = process.env;
if (
  !url ||
  !key ||
  !password ||
  password.length < 12 ||
  allow !== "true" ||
  key.startsWith("replace-") ||
  password.startsWith("replace-")
)
  throw new Error(
    "Set .env.seed with a real service-role key, unique password (12+ characters) and ALLOW_DEMO_SEED=true. Use only a disposable development project.",
  );
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const institution = "10000000-0000-4000-8000-000000000001";
const accounts = [
  ["admin", "Testni", "Administrator", ["SYSTEM_ADMIN"]],
  ["lijecnik", "Lana", "Vedrić", ["DOCTOR", "INSTITUTION_ADMIN"]],
  ["sestra", "Mila", "Oblačić", ["NURSE"]],
  ["pacijent", "Tin", "Primjerić", ["PATIENT"]],
  ["skola", "Nela", "Školić", ["SCHOOL_ADMIN"]],
];
function assert(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
const org = assert(
  await client
    .from("institutions")
    .select("id")
    .eq("id", institution)
    .maybeSingle(),
);
if (!org) throw new Error("Run migrations and supabase/seed.sql first.");
const users = [];
for (let page = 1; ; page++) {
  const data = assert(
    await client.auth.admin.listUsers({ page, perPage: 100 }),
  );
  users.push(...data.users);
  if (data.users.length < 100) break;
}
for (const [name, first_name, last_name, roles] of accounts) {
  const email = `${name}@demo.e-zdravstvo.test`;
  let user = users.find((u) => u.email === email);
  if (user && user.app_metadata?.demo_seed !== "e-zdravstvo-v1")
    throw new Error(`Refusing to modify non-seed account: ${email}`);
  if (!user)
    user = assert(
      await client.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { first_name, last_name },
        app_metadata: { demo_seed: "e-zdravstvo-v1" },
      }),
    ).user;
  // Reruns do not silently reset passwords or overwrite existing names.
  assert(
    await client.from("profiles").update({ is_demo: true }).eq("id", user.id),
  );
  for (const role of roles) {
    const scoped = [
      "DOCTOR",
      "NURSE",
      "INSTITUTION_ADMIN",
      "PHARMACIST",
      "LAB_TECHNICIAN",
    ].includes(role);
    if (scoped)
      assert(
        await client
          .from("institution_users")
          .upsert(
            { user_id: user.id, institution_id: institution, active: true },
            { onConflict: "institution_id,user_id" },
          ),
      );
    const existing = await client
      .from("user_roles")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", role);
    assert(existing);
    if (!existing.data.length)
      assert(
        await client.from("user_roles").insert({
          user_id: user.id,
          role,
          institution_id: scoped ? institution : null,
        }),
      );
  }
  console.log(`${email} — ${roles.join(" + ")} (TEST ACCOUNT)`);
}
console.log(
  "Demo accounts ready. Password is the DEMO_PASSWORD you supplied; it is never printed.",
);

import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: key,
  DEMO_PASSWORD: password,
  ALLOW_DEMO_SEED: allow,
} = process.env;
if (!url || !key || !password || allow !== "true")
  throw new Error("Development seed requires .env and .env.seed.");
const client = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await client.auth.signInWithPassword({
  email: "lijecnik@demo.e-zdravstvo.test",
  password,
});
if (error || data.user?.app_metadata.demo_seed !== "e-zdravstvo-v1")
  throw new Error("Verified demo physician required.");
const date = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Europe/Zagreb",
}).format(new Date(Date.now() + 86400000));
for (let i = 1; i <= 3; i++) {
  const result = await client.rpc("save_appointment", {
    appointment_id: null,
    expected_version: null,
    request_id: `a0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    data: {
      patient_id: `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      doctor_id: "30000000-0000-4000-8000-000000000001",
      local_time: date + "T10:" + String((i - 1) * 20).padStart(2, "0"),
      duration_minutes: 20,
      kind: "Testni termin — seed",
    },
  });
  if (result.error) throw new Error(result.error.message);
}
await client.auth.signOut();
console.log("Three fictional appointments seeded through authorized RPCs.");

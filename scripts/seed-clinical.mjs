import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL: url,
  SUPABASE_SERVICE_ROLE_KEY: key,
  ALLOW_DEMO_SEED: allow,
} = process.env;
if (!url || !key || allow !== "true")
  throw new Error(
    "Development seed requires .env.seed and ALLOW_DEMO_SEED=true",
  );
const db = createClient(url, key, { auth: { persistSession: false } });
function check(r) {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}
const users = [];
for (let page = 1; ; page++) {
  const data = check(await db.auth.admin.listUsers({ page, perPage: 100 }));
  users.push(...data.users);
  if (data.users.length < 100) break;
}
function user(name) {
  const u = users.find(
    (u) =>
      u.email === name + "@demo.e-zdravstvo.test" &&
      u.app_metadata.demo_seed === "e-zdravstvo-v1",
  );
  if (!u) throw new Error("Run seed-demo first: " + name);
  return u.id;
}
const org = "10000000-0000-4000-8000-000000000001";
const doctorIds = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
];
for (const [i, name] of ["lijecnik", "lijecnik2", "lijecnik3"].entries())
  check(
    await db.from("doctors").upsert(
      {
        id: doctorIds[i],
        user_id: user(name),
        institution_id: org,
        display_name: [
          "dr. Lana Vedrić",
          "dr. Vito Vedrić",
          "dr. Ema Primjerić",
        ][i],
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
const names = [
  ["Tin", "Primjerić"],
  ["Lina", "Testić"],
  ["Vid", "Oblačić"],
  ["Nika", "Vedrić"],
  ["Roko", "Izmišljenić"],
  ["Mara", "Testović"],
  ["Ivo", "Primjerić"],
  ["Ena", "Oblačić"],
  ["Luka", "Vedrić"],
  ["Tea", "Testić"],
];
for (const [i, [first_name, last_name]] of names.entries()) {
  const id = `40000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
  check(
    await db.from("patients").upsert(
      {
        id,
        user_id: i === 0 ? user("pacijent") : null,
        institution_id: org,
        first_name,
        last_name,
        birth_date: i === 0 ? "2010-03-14" : `${1980 + i * 3}-05-12`,
        sex: i % 2 === 0 ? "M" : "F",
        address: `Primjerna ulica ${i + 1}`,
        city: "Testni Grad",
        postal_code: "10000",
        phone: "TEST-" + String(i + 1),
        insurance: "Demonstracijsko osiguranje",
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
  check(
    await db.from("medical_records").upsert(
      {
        patient_id: id,
        blood_group: i === 0 ? "A+" : null,
        warnings:
          i === 0 ? "Isključivo izmišljeni podaci za razvoj i testiranje." : "",
      },
      { onConflict: "patient_id", ignoreDuplicates: true },
    ),
  );
  check(
    await db
      .from("patient_doctors")
      .upsert(
        { patient_id: id, doctor_id: doctorIds[0], is_primary: true },
        { onConflict: "patient_id,doctor_id", ignoreDuplicates: true },
      ),
  );
  if (i >= 7)
    check(
      await db.from("patient_doctors").upsert(
        {
          patient_id: id,
          doctor_id: doctorIds[i === 9 ? 2 : 1],
          is_primary: false,
        },
        { onConflict: "patient_id,doctor_id", ignoreDuplicates: true },
      ),
    );
  if (i < 2)
    check(
      await db
        .from("patient_staff")
        .upsert(
          { patient_id: id, user_id: user("sestra"), institution_id: org },
          { onConflict: "patient_id,user_id", ignoreDuplicates: true },
        ),
    );
}
for (const [i, name] of [
  "Penicilin — testni zapis",
  "Pelud — testni zapis",
  "Lateks — testni zapis",
].entries())
  check(
    await db.from("allergies").upsert(
      {
        id: `50000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        name,
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
console.log(
  "Phase 2 seed ready: 3 doctors, 2 nurses, 10 fictional patients, explicit care relationships.",
);
for (const [i, name] of [
  "Demonstracijska dijagnoza A",
  "Demonstracijska dijagnoza B",
  "Demonstracijsko kronično stanje",
].entries())
  check(
    await db.from("diagnoses").upsert(
      {
        id: `60000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        code: `DEMO-${i + 1}`,
        name,
        coding_system: "DEMO",
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
for (const [i, name] of [
  "Testni pripravak A",
  "Testni pripravak B",
  "Testni pripravak C",
].entries())
  check(
    await db.from("medications").upsert(
      {
        id: `70000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
        name,
        active_ingredient: "Demonstracijska tvar — nije stvarni lijek",
        strength: "Demo",
        form: "Testni oblik",
        packaging: "Testno pakiranje",
        route: "Samo demonstracija",
      },
      { onConflict: "id", ignoreDuplicates: true },
    ),
  );
console.log(
  "Phase 3 demonstration catalogs ready; not a real medicinal product directory.",
);

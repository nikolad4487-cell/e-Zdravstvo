import { createClient } from "@supabase/supabase-js";
const {
  SUPABASE_URL: url,
  VITE_SUPABASE_ANON_KEY: key,
  DEMO_PASSWORD: password,
  ALLOW_DEMO_SEED: allow,
} = process.env;
if (!url || !key || !password || allow !== "true")
  throw new Error("Requires .env, .env.seed and ALLOW_DEMO_SEED=true.");
const client = createClient(url, key, { auth: { persistSession: false } });
function check(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
check(
  await client.auth.signInWithPassword({
    email: "lijecnik@demo.e-zdravstvo.test",
    password,
  }),
);
async function rpc(name, args) {
  return check(await client.rpc(name, args));
}
const date = new Date().toISOString().slice(0, 10),
  expires = new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10);
const diagnosis = "60000000-0000-4000-8000-000000000001",
  medication = "70000000-0000-4000-8000-000000000001";
for (let i = 1; i <= 3; i++) {
  const patient_id = `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const chart = await rpc("get_patient_chart", { patient_id });
  let encounter = chart.encounters.find(
    (e) => e.reason === "Demonstracijski pregled — seed v1",
  );
  if (!encounter) {
    const id = await rpc("create_encounter", {
      patient_id,
      data: {
        encountered_at: new Date().toISOString(),
        kind: "Demonstracijski pregled",
        reason: "Demonstracijski pregled — seed v1",
        anamnesis: "Izmišljeni primjer anamneze za provjeru rada sustava.",
        symptoms: "Testni opis tegoba.",
        objective_status: "Demonstracijski zapis, nije medicinska procjena.",
        systolic: 120,
        diastolic: 80,
        pulse: 72,
        temperature: 36.5,
        spo2: 98,
        height_cm: 170,
        weight_kg: 65,
        therapy: "Isključivo testni pripravak.",
        recommendations: "Podaci služe isključivo testiranju aplikacije.",
        diagnoses: [{ id: diagnosis, is_primary: true }],
      },
    });
    encounter = { id };
  }
  if (!chart.diagnoses.length)
    await rpc("add_patient_diagnosis", {
      patient_id,
      data: {
        diagnosis_id: diagnosis,
        diagnosed_at: date,
        status: i === 3 ? "CHRONIC" : "ACTIVE",
        notes: "Izmišljeni seed zapis.",
      },
    });
  if (!chart.therapy.length)
    await rpc("add_patient_therapy", {
      patient_id,
      data: {
        medication_id: medication,
        dosage: "Demonstracijsko doziranje",
        frequency: "Testna učestalost",
        start_date: date,
        notes: "Nije stvarna terapija.",
      },
    });
  const base = { expires_on: expires, encounter_id: encounter.id };
  await rpc("issue_document", {
    patient_id,
    document_kind: "PRESCRIPTION",
    request_id: `80000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    data: {
      ...base,
      items: [
        {
          medication_id: medication,
          dosage: "Testni unos — nije medicinska uputa",
          quantity: 1,
          route: "Demonstracija",
          duration: "Testno trajanje",
          notes: "Izmišljeni pripravak.",
        },
      ],
    },
  });
  await rpc("issue_document", {
    patient_id,
    document_kind: "REFERRAL",
    request_id: `81000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    data: {
      ...base,
      referral_type: "SPECIALIST",
      specialty: "Testna specijalnost",
      reason: "Demonstracijsko upućivanje.",
      diagnosis_id: diagnosis,
      priority: "REGULAR",
      notes: "Izmišljeni seed zapis.",
    },
  });
  if (i <= 2)
    await rpc("issue_document", {
      patient_id,
      document_kind: "SCHOOL_EXCUSE",
      request_id: `82000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      data: {
        ...base,
        date_from: date,
        date_to: date,
        category: "Demonstracijski opravdani izostanak",
        school: "Testna škola Oblak",
        notes: "Izmišljeni primjer za provjeru digitalnog dokumenta.",
      },
    });
}
check(await client.auth.signOut());
console.log(
  "Seed ready: 3 encounters, diagnoses and therapies; 3 prescriptions, 3 referrals, 2 excuses. All fictional, issued through authenticated doctor RPCs.",
);

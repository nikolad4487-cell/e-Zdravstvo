import { z } from "zod";
import { db } from "../lib/supabase";
import type { Patient } from "../types/clinical";
import {
  baseChartSchema,
  chartSchema,
  clinicalContextSchema,
  institutionOverviewSchema,
  patientSummarySchema,
} from "../types/clinical";
export function unwrap<T>(result: {
  data: T;
  error: { message: string; code?: string } | null;
}): T {
  if (result.error) {
    if (result.error.code === "23P01")
      throw new Error(
        "Odabrani termin preklapa se s drugim terminom liječnika ili pacijenta. Odaberite drugo vrijeme.",
      );
    if (result.error.code === "40001")
      throw new Error(
        "Zapis je u međuvremenu izmijenjen. Osvježite prikaz pa ponovite izmjenu.",
      );
    if (result.error.code === "42501")
      throw new Error(
        "Nemate ovlast za ovu radnju ili je pristup pacijentu opozvan.",
      );
    throw new Error(
      "Spremanje ili dohvat nije uspio. Provjerite obvezna polja i pokušajte ponovno.",
    );
  }
  return result.data;
}
export async function searchPatients(term = "", page = 0) {
  return z.array(patientSummarySchema).parse(
    unwrap(
      await db().rpc("search_patients_page", {
        search_term: term,
        page_number: page,
      }),
    ),
  );
}
export async function getBaseChart(id: string) {
  return baseChartSchema.parse(
    unwrap(await db().rpc("get_patient_chart", { patient_id: id })),
  );
}
export async function getChart(id: string) {
  return chartSchema.parse(
    unwrap(await db().rpc("get_patient_chart", { patient_id: id })),
  );
}
export async function getContext() {
  return clinicalContextSchema.parse(
    unwrap(await db().rpc("clinical_context", {})),
  );
}
export async function createPatient(
  data: Record<string, string>,
  doctorId: string,
) {
  return z
    .string()
    .parse(
      unwrap(await db().rpc("create_patient", { data, doctor_id: doctorId })),
    );
}
export const patientDetailFields = [
  "first_name",
  "last_name",
  "birth_date",
  "sex",
  "address",
  "city",
  "postal_code",
  "phone",
  "email",
  "insurance",
  "emergency_contact",
] as const;
export async function updatePatientDetails(
  patient: Patient,
  data: Record<string, string>,
) {
  unwrap(
    await db().rpc("update_patient_details", {
      patient_id: patient.id,
      data,
      expected_data: Object.fromEntries(
        patientDetailFields.map((field) => [field, patient[field]]),
      ),
    }),
  );
}
export async function getInstitutions() {
  return institutionOverviewSchema.parse(
    unwrap(await db().rpc("institution_overview", {})),
  );
}

export async function getMyChart() {
  return chartSchema
    .nullable()
    .parse(unwrap(await db().rpc("get_my_chart", {})));
}

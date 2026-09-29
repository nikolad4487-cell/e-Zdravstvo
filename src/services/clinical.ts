import { z } from "zod";
import { db } from "../lib/supabase";
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
export async function searchPatients(term = "") {
  return z
    .array(patientSummarySchema)
    .parse(unwrap(await db().rpc("search_patients", { search_term: term })));
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

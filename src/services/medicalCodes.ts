import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const diagnosisCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  coding_system: z.string().optional(),
  catalog_metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type DiagnosisCode = z.infer<typeof diagnosisCodeSchema>;
export const medicalCodeSchema = z.object({
  list_id: z.string(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  source_page: z.number().nullable().optional(),
});
export async function searchDiagnosisCodes(term = "", page = 0) {
  return z.array(diagnosisCodeSchema).parse(
    unwrap(
      await db().rpc("search_diagnosis_codes", {
        search_term: term,
        page_number: page,
      }),
    ),
  );
}
export async function searchMedicalCodes(list: string, term = "", page = 0) {
  return z.array(medicalCodeSchema).parse(
    unwrap(
      await db().rpc("search_medical_codes", {
        catalog_id: list,
        search_term: term,
        page_number: page,
      }),
    ),
  );
}
export async function medicalCodeCatalogs() {
  return z
    .object({
      sources: z.array(
        z.object({
          id: z.string(),
          file_name: z.string(),
          revision: z.string(),
          expected_count: z.number(),
          imported_count: z.number(),
        }),
      ),
      lists: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          external_only: z.boolean(),
          count: z.number(),
        }),
      ),
    })
    .parse(unwrap(await db().rpc("medical_code_catalogs", {})));
}
export async function medicalCodeSource(list: string) {
  return z
    .object({ source_text: z.string() })
    .nullable()
    .parse(unwrap(await db().rpc("medical_code_source", { catalog_id: list })));
}
export const referralCategories: Record<string, string> = {
  A1: "SPECIALIST",
  A2: "FOLLOW_UP",
  A3: "DIAGNOSTICS",
  A4: "SPECIALIST",
  A5: "SPECIALIST",
  A6: "DIAGNOSTICS",
  B1: "HOSPITAL",
  B2: "HOSPITAL",
  C1: "SPECIALIST",
  C2: "HOSPITAL",
  C3: "DIAGNOSTICS",
  D1: "SPECIALIST",
  D2: "HOSPITAL",
  K: "OTHER",
};

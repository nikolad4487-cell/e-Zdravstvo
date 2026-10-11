import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const pharmacySchema = z.object({
  id: z.string(),
  number: z.string(),
  status: z.string(),
  issued_at: z.string(),
  expires_on: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  doctor_name: z.string(),
  items: z.array(
    z.object({
      name: z.string(),
      strength: z.string(),
      dosage: z.string(),
      quantity: z.number(),
      dispensed: z.number(),
      remaining: z.number(),
      route: z.string(),
      duration: z.string(),
      notes: z.string(),
    }),
  ),
  dispensing_events: z.array(
    z.object({
      id: z.string(),
      institution_name: z.string(),
      pharmacist_name: z.string(),
      created_at: z.string(),
      items: z.array(z.object({ index: z.number(), quantity: z.number() })),
    }),
  ),
  dispensation: z
    .object({
      institution_name: z.string(),
      pharmacist_name: z.string(),
      created_at: z.string(),
    })
    .nullable(),
});
export type PharmacyPrescription = z.infer<typeof pharmacySchema>;
export async function myMedications(
  active: boolean,
  page: number,
  term: string,
) {
  return z.array(pharmacySchema).parse(
    unwrap(
      await db().rpc("search_my_medications", {
        active_only: active,
        search_term: term,
        page_number: page,
      }),
    ),
  );
}
export async function pharmacyLookup(number: string, patient: string) {
  return pharmacySchema.nullable().parse(
    unwrap(
      await db().rpc("pharmacy_lookup", {
        document_number: number,
        patient_number: patient,
      }),
    ),
  );
}
export async function pharmacyInstitutions() {
  return z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(unwrap(await db().rpc("pharmacy_institutions", {})));
}

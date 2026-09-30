import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const vaccinationSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  vaccine: z.string(),
  target_disease: z.string(),
  dose: z.string(),
  administered_on: z.string(),
  batch: z.string(),
  next_dose_on: z.string().nullable(),
  notes: z.string(),
  superseded_by: z.string().nullable(),
  correction_reason: z.string(),
  doctor_name: z.string(),
  institution_name: z.string(),
  can_amend: z.boolean(),
});
export type Vaccination = z.infer<typeof vaccinationSchema>;
export async function vaccinations(personal: boolean, patientId?: string) {
  return z
    .array(vaccinationSchema)
    .parse(
      unwrap(
        await db().rpc("list_vaccinations", {
          personal,
          patient_filter: patientId ?? null,
        }),
      ),
    );
}

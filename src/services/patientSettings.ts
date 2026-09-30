import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const patientSettingsSchema = z.object({
  patient: z.object({
    id: z.string(),
    name: z.string(),
    birth_date: z.string(),
    patient_number: z.string(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    address: z.string().nullable(),
    city: z.string().nullable(),
    postal_code: z.string().nullable(),
    emergency_contact: z.string().nullable(),
  }),
  team: z.array(
    z.object({
      user_id: z.string(),
      name: z.string(),
      role: z.string(),
      allowed: z.boolean(),
    }),
  ),
});
export async function mySettings() {
  return patientSettingsSchema
    .nullable()
    .parse(unwrap(await db().rpc("my_patient_settings", {})));
}
export async function myAccessHistory(page: number) {
  return z
    .array(
      z.object({
        id: z.string(),
        action: z.string(),
        created_at: z.string(),
        actor: z.string(),
      }),
    )
    .parse(unwrap(await db().rpc("my_access_history", { page_number: page })));
}

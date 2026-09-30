import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const threadSchema = z.object({
  patient_id: z.string(),
  doctor_id: z.string(),
  patient_name: z.string(),
  doctor_name: z.string(),
  messaging_enabled: z.boolean(),
  last_message_at: z.string().nullable(),
});
export type MessageThread = z.infer<typeof threadSchema>;
export const messageSchema = z.object({
  id: z.string(),
  body: z.string(),
  created_at: z.string(),
  own: z.boolean(),
});
export async function messageThreads(personal: boolean, search: string) {
  return z
    .array(threadSchema)
    .parse(
      unwrap(
        await db().rpc("message_threads", { personal, search_term: search }),
      ),
    );
}
export async function readMessages(
  patient_id: string,
  doctor_id: string,
  before_time: string | null,
) {
  return z
    .array(messageSchema)
    .parse(
      unwrap(
        await db().rpc("read_messages", { patient_id, doctor_id, before_time }),
      ),
    );
}
const therapy = z.object({
  id: z.string(),
  patient_id: z.string(),
  medication_id: z.string(),
  name: z.string(),
  strength: z.string(),
  route: z.string(),
  dosage: z.string(),
  frequency: z.string(),
  renewal_allowed: z.boolean(),
  status: z.string(),
  end_date: z.string().nullable(),
  patient_name: z.string(),
});
const request = z.object({
  id: z.string(),
  therapy_id: z.string(),
  patient_id: z.string(),
  note: z.string(),
  status: z.enum(["PENDING", "APPROVED", "DECLINED"]),
  response: z.string().nullable(),
  document_id: z.string().nullable(),
  created_at: z.string(),
  medication_name: z.string(),
  patient_name: z.string(),
});
export type RenewalTherapy = z.infer<typeof therapy>;
export type RenewalRequest = z.infer<typeof request>;
export async function renewalOverview(personal: boolean, patientId?: string) {
  return z
    .object({ therapies: z.array(therapy), requests: z.array(request) })
    .parse(
      unwrap(
        await db().rpc("renewal_overview", {
          personal,
          patient_filter: patientId ?? null,
        }),
      ),
    );
}

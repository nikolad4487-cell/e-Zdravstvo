import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import { hospitalServiceSchema } from "../types/hospital";
export const priorityContextSchema = z.object({
  departments: z.array(
    z.object({
      id: z.string(),
      institution_id: z.string(),
      institution_name: z.string(),
      name: z.string(),
      duration_minutes: z.number(),
      active: z.boolean(),
    }),
  ),
  services: z.array(
    hospitalServiceSchema.extend({
      department_id: z.string(),
      department_name: z.string(),
      duration_minutes: z.number(),
      shifts: z.array(
        z.object({
          weekday: z.number(),
          shift: z.enum(["MORNING", "AFTERNOON"]),
        }),
      ),
    }),
  ),
});
export type PriorityService = z.infer<
  typeof priorityContextSchema
>["services"][number];
export const prioritySlotSchema = z.object({
  starts_at: z.string(),
  duration_minutes: z.number(),
});
export type PrioritySlot = z.infer<typeof prioritySlotSchema>;
export async function priorityContext(manage = false) {
  return priorityContextSchema.parse(
    unwrap(await db().rpc("priority_hospital_context", { manage })),
  );
}
export async function prioritySlots(
  patient: string,
  service: string,
  from: string,
  to: string,
) {
  if (!service) return [];
  return z
    .array(prioritySlotSchema)
    .parse(
      unwrap(
        await db().rpc("priority_hospital_slots", {
          patient_id: patient,
          service_id: service,
          date_from: from,
          date_to: to,
        }),
      ),
    );
}
export async function priorityReferrals(
  patient: string,
  service: string,
  starts: string,
  term: string,
  page: number,
) {
  if (!service || !starts) return [];
  return z
    .array(
      z.object({
        id: z.string(),
        number: z.string(),
        expires_on: z.string(),
        issued_at: z.string(),
      }),
    )
    .parse(
      unwrap(
        await db().rpc("priority_hospital_referrals", {
          patient_id: patient,
          service_id: service,
          starts_at: starts,
          search_term: term,
          page_number: page,
        }),
      ),
    );
}
export const emailStatusLabels: Record<string, string> = {
  PENDING: "Potvrda e-mailom je u redu za slanje.",
  SENDING: "Potvrda e-mailom se šalje.",
  SENT: "Potvrda e-mailom je poslana.",
  UNAVAILABLE:
    "Potvrda e-mailom nije poslana: usluga e-maila još nije aktivirana.",
  DISABLED:
    "Potvrda e-mailom nije poslana: pacijent nije uključio e-mail obavijesti.",
  UNVERIFIED:
    "Potvrda e-mailom nije poslana: pacijentova e-mail adresa nije potvrđena.",
  NO_ACCOUNT:
    "Potvrda e-mailom nije poslana: pacijent nema povezan korisnički račun.",
  FAILED: "Slanje potvrde e-mailom nije uspjelo.",
  CANCELLED: "Slanje potvrde e-mailom je otkazano.",
  NOT_QUEUED: "Potvrda e-mailom nije u redu za slanje.",
};

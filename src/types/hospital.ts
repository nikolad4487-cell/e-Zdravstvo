import { z } from "zod";
export const laboratoryStepSchema = z.object({
  day_offset: z.number(),
  time: z.string(),
  label: z.string(),
  instructions: z.string().optional(),
});
export const laboratoryTestSchema = z.object({
  id: z.string(),
  code: z.string(),
  catalog_list: z.string().nullable().optional(),
  name: z.string(),
  required_time: z.string().nullable(),
  sampling_from: z.string().optional(),
  sampling_until: z.string().optional(),
  instructions: z.string(),
  steps: z.array(laboratoryStepSchema),
  active: z.boolean().optional(),
});
export const laboratoryDetailsSchema = z.object({
  service_id: z.string(),
  procedure_code: z.string(),
  service_name: z.string(),
  sampling_method: z.enum(["VENIPUNCTURE", "CANNULA", "OTHER"]),
  required_time: z.string().nullable(),
  sampling_from: z.string().optional(),
  sampling_until: z.string().optional(),
  tests: z.array(laboratoryTestSchema),
  specimens: z
    .array(z.object({ code: z.string(), name: z.string() }))
    .optional(),
});
export const hospitalServiceSchema = z.object({
  id: z.string(),
  institution_id: z.string(),
  doctor_id: z.string(),
  name: z.string(),
  specialty: z.string(),
  booking_kind: z.enum(["SPECIALIST", "LABORATORY"]).default("SPECIALIST"),
  procedure_code: z.string().default(""),
  location: z.string(),
  instructions: z.string(),
  active: z.boolean(),
  institution_name: z.string(),
  doctor_name: z.string(),
});
export const hospitalContextSchema = z.object({
  services: z.array(hospitalServiceSchema),
  institutions: z.array(z.object({ id: z.string(), name: z.string() })),
  doctors: z.array(
    z.object({
      id: z.string(),
      institution_id: z.string(),
      display_name: z.string(),
    }),
  ),
});
export const hospitalSlotSchema = z.object({
  id: z.string(),
  service_id: z.string(),
  starts_at: z.string(),
  duration_minutes: z.number(),
  priority_only: z.boolean(),
  active: z.boolean(),
  booked: z.boolean(),
});
export const hospitalBookingSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  slot_id: z.string(),
  referral_id: z.string().nullable(),
  priority: z.boolean(),
  priority_reason: z.string(),
  laboratory_details: laboratoryDetailsSchema.nullable().optional(),
  status: z.enum(["BOOKED", "ARRIVED", "COMPLETED", "CANCELLED", "NO_SHOW"]),
  version: z.number(),
  cancellation_reason: z.string().nullable(),
  starts_at: z.string(),
  duration_minutes: z.number(),
  service_name: z.string(),
  specialty: z.string(),
  location: z.string(),
  instructions: z.string(),
  institution_name: z.string(),
  specialist_name: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  can_cancel: z.boolean(),
  can_process: z.boolean(),
  can_reschedule: z.boolean(),
  service_id: z.string(),
});
export type HospitalService = z.infer<typeof hospitalServiceSchema>;
export type HospitalSlot = z.infer<typeof hospitalSlotSchema>;
export type HospitalBooking = z.infer<typeof hospitalBookingSchema>;
export type HospitalMode = "PERSONAL" | "CARE" | "PROVIDER";

import { z } from "zod";
export const appointmentStatusLabels = {
  SCHEDULED: "Naručen",
  ARRIVED: "Stigao",
  IN_PROGRESS: "Pregled u tijeku",
  COMPLETED: "Završeno",
  CANCELLED: "Otkazano",
  NO_SHOW: "Nije došao",
} as const;
export type AppointmentStatus = keyof typeof appointmentStatusLabels;
export const appointmentSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  doctor_id: z.string(),
  starts_at: z.string(),
  duration_minutes: z.number(),
  kind: z.string(),
  status: z.enum([
    "SCHEDULED",
    "ARRIVED",
    "IN_PROGRESS",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ]),
  version: z.number(),
  cancellation_reason: z.string().nullable(),
  patient_name: z.string(),
  patient_number: z.string(),
  doctor_name: z.string(),
  institution: z.string(),
  can_manage: z.boolean(),
  can_clinical: z.boolean(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

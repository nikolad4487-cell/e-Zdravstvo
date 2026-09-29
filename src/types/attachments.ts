import { z } from "zod";
export const attachmentCategories = {
  REPORT: "Nalaz",
  DISCHARGE: "Otpusno pismo",
  LAB: "Laboratorijski nalaz",
  RADIOLOGY: "Radiološki nalaz",
  CERTIFICATE: "Potvrda",
  EXCUSE: "Ispričnica",
  OTHER: "Ostalo",
} as const;
export const attachmentSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  title: z.string(),
  category: z.enum([
    "REPORT",
    "DISCHARGE",
    "LAB",
    "RADIOLOGY",
    "CERTIFICATE",
    "EXCUSE",
    "OTHER",
  ]),
  file_name: z.string(),
  content_type: z.string(),
  byte_size: z.number(),
  sha256: z.string(),
  status: z.enum(["AVAILABLE", "ARCHIVED"]),
  created_at: z.string(),
  archived_at: z.string().nullable(),
  archive_reason: z.string().nullable(),
  uploaded_by: z.string(),
  can_archive: z.boolean(),
});
export type Attachment = z.infer<typeof attachmentSchema>;
export const patientDashboardSchema = z.object({
  next_appointment: z
    .object({
      starts_at: z.string(),
      kind: z.string(),
      doctor_name: z.string(),
    })
    .nullable(),
  patient_id: z.string(),
  active_prescriptions: z.number(),
  active_referrals: z.number(),
  attachments: z.number(),
  unread_notifications: z.number(),
  active_therapy: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      strength: z.string(),
      dosage: z.string(),
      frequency: z.string(),
    }),
  ),
  doctors: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      specialty: z.string(),
      institution: z.string(),
      is_primary: z.boolean(),
    }),
  ),
  recent_documents: z.array(
    z.object({
      id: z.string(),
      number: z.string(),
      kind: z.enum(["PRESCRIPTION", "REFERRAL", "SCHOOL_EXCUSE"]),
      issued_at: z.string(),
      status: z.string(),
    }),
  ),
  recent_activity: z.array(
    z.object({
      id: z.string(),
      message: z.string(),
      created_at: z.string(),
      read_at: z.string().nullable(),
    }),
  ),
});
export type PatientDashboard = z.infer<typeof patientDashboardSchema>;

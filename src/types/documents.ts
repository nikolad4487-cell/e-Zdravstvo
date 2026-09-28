import { z } from "zod";
import { excuseTemplateSchema, adminDoctorSchema, clinicSchema } from "./admin";
export const excuseContextSchema = z.object({
  doctor: adminDoctorSchema,
  clinics: z.array(clinicSchema),
  reasons: z.array(
    z.object({ id: z.string(), name: z.string(), code: z.string() }),
  ),
});
export const documentKinds = [
  "PRESCRIPTION",
  "REFERRAL",
  "SCHOOL_EXCUSE",
] as const;
export type DocumentKind = (typeof documentKinds)[number];
export const kindLabels: Record<DocumentKind, string> = {
  PRESCRIPTION: "Recept",
  REFERRAL: "Uputnica",
  SCHOOL_EXCUSE: "Liječnička ispričnica",
};
export const documentStatusLabels: Record<string, string> = {
  ISSUED: "Izdano",
  VALID: "Važeći",
  REVOKED: "Opozvano",
  CANCELLED: "Otkazano",
  EXPIRED: "Isteklo",
  DISPENSED: "Realizirano",
  COMPLETED: "Završeno",
  INVALID: "Potvrda nije valjana",
  BOOKED: "Naručeno",
  IN_PROGRESS: "U obradi",
};
const itemSchema = z.object({
  medication_id: z.string(),
  name: z.string(),
  active_ingredient: z.string(),
  strength: z.string(),
  form: z.string(),
  packaging: z.string(),
  dosage: z.string(),
  quantity: z.number(),
  route: z.string(),
  duration: z.string(),
  notes: z.string(),
});
const detailsSchema = z.object({
  excuse_type: z.enum(["REGULAR", "PE"]).optional(),
  template: excuseTemplateSchema.optional(),
  clinic: z
    .object({
      id: z.string(),
      name: z.string(),
      code: z.string(),
      address: z.string(),
      city: z.string(),
      phone: z.string(),
      email: z.string(),
    })
    .optional(),
  doctor_code: z.string().optional(),
  signer_fingerprint: z.string().optional(),
  diagnosis_code: z.string().nullable().optional(),
  items: z.array(itemSchema).optional(),
  referral_type: z.string().optional(),
  specialty: z.string().optional(),
  reason: z.string().optional(),
  diagnosis: z.string().nullable().optional(),
  priority: z.string().optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  category: z.string().optional(),
  school: z.string().optional(),
  notes: z.string().optional(),
});
export const documentSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  kind: z.enum(documentKinds),
  number: z.string(),
  status: z.string(),
  issued_at: z.string(),
  expires_on: z.string(),
  revocation_reason: z.string().nullable(),
  can_revoke: z.boolean(),
  verification_token: z.string(),
  payload: z.object({
    number: z.string(),
    kind: z.enum(documentKinds),
    issued_at: z.string(),
    expires_on: z.string(),
    patient: z.object({
      first_name: z.string(),
      last_name: z.string(),
      birth_date: z.string(),
      patient_number: z.string(),
    }),
    doctor: z.string(),
    institution: z.string(),
    institution_address: z.string(),
    details: detailsSchema,
    signature_disclaimer: z.string(),
  }),
  signature: z.object({
    signed_at: z.string(),
    signature_hash: z.string(),
    signature_method: z.string(),
    certificate_name: z.string(),
    status: z.string(),
    integrity_valid: z.boolean(),
  }),
});
export const verificationSchema = z.object({
  number: z.string(),
  kind: z.enum(documentKinds),
  issuer: z.string(),
  institution: z.string(),
  issued_at: z.string(),
  expires_on: z.string(),
  status: z.string(),
  signature_method: z.string(),
});
export const notificationSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  document_id: z.string().nullable(),
  message: z.string(),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type ClinicalDocument = z.infer<typeof documentSchema>;
export type Prescription = ClinicalDocument & { kind: "PRESCRIPTION" };
export type Referral = ClinicalDocument & { kind: "REFERRAL" };
export type SchoolExcuse = ClinicalDocument & { kind: "SCHOOL_EXCUSE" };
export type Notification = z.infer<typeof notificationSchema>;
export type DocumentVerification = z.infer<typeof verificationSchema>;

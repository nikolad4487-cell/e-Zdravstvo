import { z } from "zod";
import { USER_ROLES } from "./index";
export const excuseTemplateSchema = z.object({
  id: z.string().nullable(),
  institution_id: z.string(),
  excuse_type: z.enum(["REGULAR", "PE"]),
  version: z.number(),
  title: z.string(),
  body_text: z.string(),
  footer_text: z.string(),
  font_family: z.enum(["SERIF", "SANS"]),
  font_size: z.number(),
  header_align: z.enum(["CENTER", "LEFT"]),
  accent: z.string(),
  show_separator: z.boolean(),
});
export type ExcuseTemplate = z.infer<typeof excuseTemplateSchema>;
export const clinicSchema = z.object({
  id: z.string(),
  institution_id: z.string(),
  name: z.string(),
  code: z.string(),
  address: z.string(),
  city: z.string(),
  phone: z.string(),
  email: z.string(),
  active: z.boolean(),
});
export const adminDoctorSchema = z.object({
  id: z.string(),
  institution_id: z.string(),
  user_id: z.string(),
  display_name: z.string(),
  specialty: z.string(),
  doctor_code: z.string(),
  clinic_id: z.string().nullable(),
  active: z.boolean(),
  signer_fingerprint: z.string(),
});
const catalogSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  active: z.boolean(),
  coding_system: z.string().optional(),
});
export const adminConfigurationSchema = z.object({
  institutions: z.array(
    z.object({ id: z.string(), name: z.string(), code: z.string() }),
  ),
  clinics: z.array(clinicSchema),
  doctors: z.array(adminDoctorSchema),
  templates: z.array(excuseTemplateSchema),
  reasons: z.array(catalogSchema),
  diagnoses: z.array(catalogSchema),
});
export type AdminConfiguration = z.infer<typeof adminConfigurationSchema>;
export const adminUsersSchema = z.array(
  z.object({
    id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string().nullable(),
    is_demo: z.boolean(),
    roles: z.array(
      z.object({
        id: z.string(),
        role: z.enum(USER_ROLES),
        institution_id: z.string().nullable(),
        institution_name: z.string().nullable(),
      }),
    ),
  }),
);
export type AdminUser = z.infer<typeof adminUsersSchema>[number];
export const centralOverviewSchema = z.object({
  institutions: z.number(),
  users: z.number(),
  doctors: z.number(),
  patients: z.number(),
  encounters_today: z.number(),
  prescriptions: z.number(),
  referrals: z.number(),
  audit_today: z.number(),
  active_users_7d: z.number(),
});

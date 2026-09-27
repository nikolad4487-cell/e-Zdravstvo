import { z } from "zod";
const id = z.string();
const optionalText = z.string().nullable();
export const patientSummarySchema = z.object({
  id,
  patient_number: z.string(),
  first_name: z.string(),
  last_name: z.string(),
  birth_date: z.string(),
  sex: z.string(),
  primary_doctor: optionalText,
});
export const patientSchema = patientSummarySchema
  .omit({ primary_doctor: true })
  .extend({
    user_id: optionalText,
    institution_id: id,
    address: optionalText,
    city: optionalText,
    postal_code: optionalText,
    phone: optionalText,
    email: optionalText,
    emergency_contact: optionalText,
    insurance: optionalText,
    created_at: z.string(),
  });
export const doctorSchema = z.object({
  id,
  user_id: id,
  institution_id: id,
  display_name: z.string(),
  specialty: z.string(),
  active: z.boolean(),
});
export const recordSchema = z.object({
  id,
  patient_id: id,
  blood_group: optionalText,
  warnings: z.string(),
});
export const allergySchema = z.object({ id, name: z.string() });
export const patientAllergySchema = z.object({
  id,
  name: z.string(),
  reaction: z.string(),
  severity: z.string(),
});
export const chartDoctorSchema = z.object({
  id,
  display_name: z.string(),
  specialty: z.string(),
  is_primary: z.boolean(),
  institution_id: id,
});
export const baseChartSchema = z.object({
  patient: patientSchema,
  record: recordSchema.nullable(),
  doctors: z.array(chartDoctorSchema),
  allergies: z.array(patientAllergySchema),
  can_write: z.boolean(),
});
export const diagnosisSchema = z.object({
  id,
  code: z.string(),
  name: z.string(),
  coding_system: z.string(),
});
export const medicationSchema = z.object({
  id,
  name: z.string(),
  active_ingredient: z.string(),
  strength: z.string(),
  form: z.string(),
  packaging: z.string(),
  route: z.string(),
});
export const encounterSchema = z.object({
  id,
  patient_id: id,
  doctor_id: id,
  doctor_name: z.string(),
  institution_id: id,
  encountered_at: z.string(),
  kind: z.string(),
  reason: z.string(),
  anamnesis: z.string(),
  symptoms: z.string(),
  objective_status: z.string(),
  systolic: z.number().nullable(),
  diastolic: z.number().nullable(),
  pulse: z.number().nullable(),
  temperature: z.number().nullable(),
  spo2: z.number().nullable(),
  height_cm: z.number().nullable(),
  weight_kg: z.number().nullable(),
  bmi: z.number().nullable(),
  therapy: z.string(),
  recommendations: z.string(),
  follow_up: optionalText,
  notes: z.string(),
  supersedes_id: optionalText,
  superseded_by: optionalText,
  amendment_reason: optionalText,
  created_at: z.string(),
  diagnoses: z.array(
    z.object({
      id,
      code: z.string(),
      name: z.string(),
      is_primary: z.boolean(),
    }),
  ),
});
export const patientDiagnosisSchema = z.object({
  id,
  diagnosis_id: id,
  code: z.string(),
  name: z.string(),
  diagnosed_at: z.string(),
  status: z.string(),
  notes: z.string(),
  doctor_name: z.string(),
});
export const therapySchema = z.object({
  id,
  medication_id: id,
  name: z.string(),
  strength: z.string(),
  dosage: z.string(),
  frequency: z.string(),
  start_date: z.string(),
  end_date: optionalText,
  notes: z.string(),
  status: z.string(),
  doctor_name: z.string(),
});
export const chartSchema = baseChartSchema.extend({
  encounters: z.array(encounterSchema),
  diagnoses: z.array(patientDiagnosisSchema),
  therapy: z.array(therapySchema),
});
export const clinicalContextSchema = z.object({
  doctors: z.array(doctorSchema),
  allergies: z.array(allergySchema),
  diagnoses: z.array(diagnosisSchema),
  medications: z.array(medicationSchema),
});
export const institutionOverviewSchema = z.array(
  z.object({
    id,
    name: z.string(),
    code: z.string(),
    address: optionalText,
    city: optionalText,
    postal_code: optionalText,
    phone: optionalText,
    departments: z.array(z.object({ id, name: z.string(), code: z.string() })),
    staff: z.array(
      z.object({
        user_id: id,
        first_name: z.string(),
        last_name: z.string(),
        active: z.boolean(),
        roles: z.array(z.string()).nullable(),
      }),
    ),
  }),
);
export type Patient = z.infer<typeof patientSchema>;
export type PatientSummary = z.infer<typeof patientSummarySchema>;
export type Doctor = z.infer<typeof doctorSchema>;
export type BaseChart = z.infer<typeof baseChartSchema>;
export type ClinicalContext = z.infer<typeof clinicalContextSchema>;
export type MedicalEncounter = z.infer<typeof encounterSchema>;
export type Diagnosis = z.infer<typeof diagnosisSchema>;
export type Medication = z.infer<typeof medicationSchema>;
export type PatientChart = z.infer<typeof chartSchema>;

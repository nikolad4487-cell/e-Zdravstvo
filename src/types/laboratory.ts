import { z } from "zod";
export const labParameterSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  reference_low: z.number().nullable(),
  reference_high: z.number().nullable(),
  flag: z.enum(["LOW", "NORMAL", "HIGH", "CRITICAL"]).nullable(),
});
export const labResultSchema = z.object({
  id: z.string(),
  sampled_at: z.string(),
  reported_at: z.string(),
  summary: z.string(),
  version: z.number(),
  correction_reason: z.string(),
  superseded_by: z.string().nullable(),
  author: z.string(),
  parameters: z.array(labParameterSchema),
});
export const labOrderSchema = z.object({
  id: z.string(),
  number: z.string(),
  patient_id: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  birth_date: z.string(),
  doctor_name: z.string(),
  laboratory_name: z.string(),
  requested_tests: z.string(),
  clinical_question: z.string(),
  priority: z.enum(["REGULAR", "URGENT"]),
  status: z.enum(["ORDERED", "IN_PROGRESS", "COMPLETED", "CANCELLED"]),
  version: z.number(),
  created_at: z.string(),
  cancellation_reason: z.string().nullable(),
  can_publish: z.boolean(),
  can_cancel: z.boolean(),
  results: z.array(labResultSchema),
});
export type LabOrder = z.infer<typeof labOrderSchema>;
export type LabResult = z.infer<typeof labResultSchema>;
export type LabMode = "CARE" | "PERSONAL" | "LAB";
export const labStatusLabels = {
  ORDERED: "Naručeno",
  IN_PROGRESS: "U obradi",
  COMPLETED: "Završeno",
  CANCELLED: "Otkazano",
};
export const labFlagLabels = {
  LOW: "Sniženo",
  NORMAL: "U referentnom intervalu",
  HIGH: "Povišeno",
  CRITICAL: "Kritično",
};

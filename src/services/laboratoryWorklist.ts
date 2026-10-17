import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const sampleStageLabels = {
  EXPECTED: "Očekuje dolazak",
  ARRIVED: "Pacijent zaprimljen",
  COLLECTED: "Uzorak uzet",
  PROCESSING: "U obradi",
  RECOLLECT: "Ponoviti uzorkovanje",
  COMPLETED: "Nalaz izdan",
  CANCELLED: "Otkazano",
  NO_SHOW: "Nije došao",
  CLOSED: "Termin završen bez zahtjeva",
};
const stageSchema = z.enum([
  "EXPECTED",
  "ARRIVED",
  "COLLECTED",
  "PROCESSING",
  "RECOLLECT",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
  "CLOSED",
]);
export type SampleStage = z.infer<typeof stageSchema>;
const itemSchema = z.object({
  source_kind: z.enum(["BOOKING", "ORDER"]),
  source_id: z.string(),
  order_id: z.string().nullable(),
  booking_id: z.string().nullable(),
  number: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  institution_id: z.string(),
  institution_name: z.string(),
  service_name: z.string(),
  location: z.string(),
  doctor_name: z.string(),
  starts_at: z.string().nullable(),
  priority: z.boolean(),
  version: z.number(),
  stage: stageSchema,
  attempt: z.number(),
  stage_at: z.string().nullable(),
  sample_note: z.string(),
  requested_tests: z.string(),
  specimens: z.array(z.object({ code: z.string(), name: z.string() })),
  sampling_method: z.string().nullable(),
  history: z.array(
    z.object({
      id: z.string(),
      status: stageSchema,
      attempt: z.number(),
      reason: z.string(),
      created_at: z.string(),
      actor: z.string().nullable(),
    }),
  ),
});
export type LaboratoryWorkItem = z.infer<typeof itemSchema>;
export interface WorklistFilters {
  day: string;
  institution: string;
  search: string;
  stage: string;
}
export async function laboratoryWorklist(
  filters: WorklistFilters,
  page: number,
) {
  return z
    .object({
      institutions: z.array(z.object({ id: z.string(), name: z.string() })),
      total: z.number(),
      counts: z.record(z.string(), z.number()),
      items: z.array(itemSchema),
    })
    .parse(
      unwrap(
        await db().rpc("laboratory_worklist", {
          work_day: filters.day,
          institution_filter: filters.institution || null,
          search_term: filters.search.trim(),
          stage_filter: filters.stage || null,
          page_number: page,
        }),
      ),
    );
}
export async function advanceLaboratoryWorkflow(
  item: LaboratoryWorkItem,
  stage: SampleStage,
  reason: string,
) {
  return unwrap(
    await db().rpc("advance_laboratory_workflow", {
      source_kind: item.source_kind,
      source_id: item.source_id,
      expected_version: item.version,
      new_stage: stage,
      reason,
    }),
  );
}

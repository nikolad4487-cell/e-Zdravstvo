import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const careStageLabels = {
  HOSPITALIZED: "Aktivna hospitalizacija",
  WAITING_BOOKING: "Uputnica bez termina",
  WAITING_VISIT: "Čeka dolazak",
  WAITING_RESULT: "Čeka nalaz",
  MISSING_RESULT: "Završen termin bez nalaza",
  NEEDS_REVIEW: "Nalaz čeka pregled liječnika",
  REVIEWED: "Nalaz pregledan",
  FOLLOWUP_DUE: "Dospjela kontrolna obveza",
  FOLLOWUP_PLANNED: "Planirana kontrolna obveza",
  CLOSED: "Zaključeno",
};
const item = z.object({
  critical: z.boolean().optional(),
  can_inpatient_details: z.boolean().nullable().optional(),
  acknowledged: z.boolean().optional(),
  origin: z.object({ kind: z.string(), id: z.string() }).nullable().optional(),
  source_kind: z.string(),
  source_id: z.string(),
  patient_id: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  title: z.string(),
  detail: z.string(),
  event_at: z.string(),
  due_on: z.string().nullable(),
  stage: z.enum([
    "HOSPITALIZED",
    "WAITING_BOOKING",
    "WAITING_VISIT",
    "WAITING_RESULT",
    "MISSING_RESULT",
    "NEEDS_REVIEW",
    "REVIEWED",
    "FOLLOWUP_DUE",
    "FOLLOWUP_PLANNED",
    "CLOSED",
  ]),
  result_kind: z.enum(["LAB_RESULT", "MEDICAL_REPORT"]).nullable(),
  result_id: z.string().nullable(),
  version: z.number(),
  referral_id: z.string().nullable(),
});
export type CareItem = z.infer<typeof item>;
export async function carePathways(
  patient: string | undefined,
  search: string,
  stage: string,
  closed: boolean,
  page: number,
) {
  return z
    .object({
      total: z.number(),
      counts: z.record(z.string(), z.number()),
      items: z.array(item),
    })
    .parse(
      unwrap(
        await db().rpc("care_pathways", {
          patient_filter: patient ?? null,
          search_term: search,
          stage_filter: stage || null,
          include_closed: closed,
          page_number: page,
        }),
      ),
    );
}
export async function reviewCareResult(row: CareItem) {
  return unwrap(
    await db().rpc("review_care_result", {
      result_kind: row.result_kind!,
      result_id: row.result_id!,
    }),
  );
}
export async function createCareFollowup(
  patient: string,
  date: string,
  title: string,
  request: string,
  source: CareItem,
) {
  return unwrap(
    await db().rpc("create_care_followup", {
      patient_id: patient,
      due_on: date,
      title,
      request_id: request,
      source_kind: source.result_kind ?? source.source_kind,
      source_id: source.result_id ?? source.source_id,
    }),
  );
}
export async function resolveCareFollowup(
  row: CareItem,
  status: string,
  resolution: string,
) {
  return unwrap(
    await db().rpc("resolve_care_followup", {
      followup_id: row.source_id,
      expected_version: row.version,
      new_status: status,
      resolution,
    }),
  );
}

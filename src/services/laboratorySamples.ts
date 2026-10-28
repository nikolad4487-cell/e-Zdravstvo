import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
export const sampleLabels = {
  REGISTERED: "Oznaka izrađena",
  ACCEPTED: "Uzorak zaprimljen",
  REJECTED: "Uzorak odbijen",
};
export const laboratorySampleSchema = z.object({
  id: z.string(),
  code: z.string(),
  specimen_code: z.string(),
  specimen_name: z.string(),
  collection_round: z.number(),
  status: z.enum(["REGISTERED", "ACCEPTED", "REJECTED"]),
  reason: z.string(),
  version: z.number(),
  replaced: z.boolean(),
  created_at: z.string(),
  history: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      reason: z.string(),
      created_at: z.string(),
      actor: z.string().nullable().optional(),
    }),
  ),
});
export type LaboratorySample = z.infer<typeof laboratorySampleSchema>;
export const sampleOrderSchema = z.object({
  number: z.string(),
  patient_name: z.string(),
  patient_number: z.string(),
  status: z.string(),
  sample_status: z.string(),
  attempt: z.number(),
});
export type SampleOrder = z.infer<typeof sampleOrderSchema>;
export async function laboratorySamples(order: string, code: string) {
  return z
    .object({
      order: sampleOrderSchema,
      items: z.array(laboratorySampleSchema),
    })
    .parse(
      unwrap(
        await db().rpc("list_laboratory_samples", {
          order_id: order,
          sample_code: code,
        }),
      ),
    );
}
export async function createLaboratorySample(
  order: string,
  specimen: string,
  request: string,
  replacement: string | null,
) {
  return unwrap(
    await db().rpc("create_laboratory_sample", {
      order_id: order,
      specimen_code: specimen,
      request_id: request,
      replaces_sample_id: replacement,
    }),
  );
}
export async function changeLaboratorySample(
  sample: LaboratorySample,
  status: string,
  reason: string,
) {
  return unwrap(
    await db().rpc("change_laboratory_sample", {
      sample_id: sample.id,
      expected_version: sample.version,
      new_status: status,
      reason,
    }),
  );
}

export async function laboratorySampleLabel(id: string) {
  return z
    .object({
      order: sampleOrderSchema,
      items: z.array(laboratorySampleSchema),
    })
    .parse(
      unwrap(await db().rpc("laboratory_sample_label", { sample_id: id })),
    );
}

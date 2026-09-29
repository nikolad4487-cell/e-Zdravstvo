import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import { labOrderSchema, type LabMode } from "../types/laboratory";
import type { Json } from "../lib/database.types";
export async function getLaboratory(
  mode: LabMode,
  patientId?: string,
  page = 0,
) {
  return z
    .array(labOrderSchema)
    .parse(
      unwrap(
        await db().rpc("list_laboratory", {
          mode,
          patient_filter: patientId ?? null,
          page_number: page,
        }),
      ),
    );
}
export async function getLaboratories() {
  return z
    .array(z.object({ id: z.string(), name: z.string() }))
    .parse(unwrap(await db().rpc("laboratory_context", {})));
}
export async function orderLaboratory(
  patientId: string,
  data: Json,
  requestId: string,
) {
  return unwrap(
    await db().rpc("order_laboratory", {
      patient_id: patientId,
      data,
      request_id: requestId,
    }),
  );
}
export async function labStatus(
  id: string,
  version: number,
  status: string,
  reason = "",
) {
  return unwrap(
    await db().rpc("set_lab_order_status", {
      order_id: id,
      expected_version: version,
      new_status: status,
      reason,
    }),
  );
}
export async function publishLabResult(
  id: string,
  previous: string | null,
  data: Json,
) {
  return unwrap(
    await db().rpc("publish_laboratory_result", {
      order_id: id,
      previous_result: previous,
      data,
    }),
  );
}

import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import type { Database } from "../lib/database.types";
const recordSchema = z.object({
  id: z.string(),
  dose_id: z.string(),
  outcome: z.enum(["GIVEN", "NOT_GIVEN"]),
  actual_at: z.string(),
  actual_dose: z.string().nullable(),
  note: z.string(),
  author_name: z.string(),
  created_at: z.string(),
  corrects_record_id: z.string().nullable(),
  superseded_by: z.string().nullable(),
  correction_reason: z.string(),
  can_correct: z.boolean().optional(),
});
export type MedicationRecord = z.infer<typeof recordSchema>;
const doseSchema = z.object({
  id: z.string(),
  scheduled_at: z.string(),
  record: recordSchema.nullable(),
});
export type MedicationDose = z.infer<typeof doseSchema>;
const orderSchema = z.object({
  id: z.string(),
  dose: z.string(),
  route: z.string(),
  instructions: z.string(),
  medication_snapshot: z.object({
    name: z.string(),
    strength: z.string(),
    packaging: z.string(),
    catalog_code: z.string().nullable().optional(),
  }),
  status: z.enum(["ACTIVE", "STOPPED", "DISCHARGED"]),
  version: z.number(),
  author_name: z.string(),
  created_at: z.string(),
  stop_reason: z.string().nullable(),
  stop_author: z.string().nullable(),
  stopped_at: z.string().nullable(),
  doses: z.array(doseSchema),
});
export type MedicationOrder = z.infer<typeof orderSchema>;
export async function inpatientMedications(admission: string, page = 0) {
  return z
    .object({
      can_order: z.boolean(),
      can_record: z.boolean(),
      admission_status: z.enum(["ADMITTED", "DISCHARGED"]),
      total: z.number(),
      orders: z.array(orderSchema),
    })
    .parse(
      unwrap(
        await db().rpc("inpatient_medications", {
          admission_id: admission,
          page_number: page,
        }),
      ),
    );
}
export async function inpatientMedicationHistory(order: string, page = 0) {
  return z
    .object({
      total: z.number(),
      records: z.array(recordSchema.extend({ scheduled_at: z.string() })),
    })
    .parse(
      unwrap(
        await db().rpc("inpatient_medication_history", {
          order_id: order,
          page_number: page,
        }),
      ),
    );
}
type Command =
  | "create_inpatient_medication_order"
  | "stop_inpatient_medication_order"
  | "record_inpatient_medication";
export async function medicationCommand<K extends Command>(
  name: K,
  args: Database["public"]["Functions"][K]["Args"],
) {
  const result = await db().rpc(name, args as never);
  const messages: Record<string, string> = {
    "Medication order is closed":
      "Nalog je zaustavljen ili je pacijent otpušten. Nova primjena nije dopuštena.",
    "Medication unavailable":
      "Lijek više nije dostupan u aktivnom šifrarniku. Ponovite odabir.",
    "Invalid or duplicate dose time":
      "Vremena doza moraju biti različita, nakon prijama i unutar sljedećih godinu dana.",
    "Ambiguous or nonexistent Zagreb time":
      "Odabrano vrijeme nije jednoznačno zbog promjene sata. Odaberite drugo vrijeme.",
    "Invalid administration time":
      "Vrijeme primjene mora biti nakon prijama, u prošlosti i prije zatvaranja naloga/prijama.",
    "Explain dose deviation": "Obrazložite odstupanje od propisane doze.",
    "Invalid record correction":
      "Zapis je izmijenjen ili nije Vaš. Osvježite podatke.",
    "Dose already recorded":
      "Ova doza već ima evidentiran ishod. Osvježite podatke.",
  };
  if (result.error && messages[result.error.message])
    throw Error(messages[result.error.message]);
  return unwrap(result);
}
export function zagrebInput(value = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zagreb",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .format(value)
    .replace(" ", "T");
}

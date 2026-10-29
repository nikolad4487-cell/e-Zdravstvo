import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import type { Database } from "../lib/database.types";
const admissionSchema = z.object({
  id: z.string(),
  patient_id: z.string(),
  doctor_id: z.string(),
  institution_id: z.string(),
  bed_id: z.string(),
  reason: z.string(),
  status: z.enum(["ADMITTED", "DISCHARGED"]),
  admitted_at: z.string(),
  discharged_at: z.string().nullable(),
  discharge_report_id: z.string().nullable(),
  version: z.number(),
});
export const inpatientRowSchema = admissionSchema.extend({
  patient_name: z.string(),
  patient_number: z.string(),
  ward_name: z.string(),
  bed_label: z.string(),
  institution_name: z.string(),
  can_manage: z.boolean(),
});
export type Inpatient = z.infer<typeof inpatientRowSchema>;
const noteSchema = z.object({
  id: z.string(),
  kind: z.enum(["PROGRESS", "NURSING"]),
  content: z.string(),
  corrects_note_id: z.string().nullable(),
  superseded_by: z.string().nullable(),
  correction_reason: z.string(),
  created_at: z.string(),
  author: z.string(),
  can_correct: z.boolean(),
});
export type InpatientNote = z.infer<typeof noteSchema>;
export async function inpatientContext() {
  return z
    .object({
      institutions: z.array(
        z.object({ id: z.string(), name: z.string(), can_manage: z.boolean() }),
      ),
      wards: z.array(
        z.object({
          id: z.string(),
          institution_id: z.string(),
          name: z.string(),
          active: z.boolean(),
        }),
      ),
      beds: z.array(
        z.object({
          id: z.string(),
          ward_id: z.string(),
          institution_id: z.string(),
          label: z.string(),
          active: z.boolean(),
          occupied: z.boolean(),
          ward_name: z.string(),
        }),
      ),
    })
    .parse(unwrap(await db().rpc("inpatient_context", {})));
}
export async function inpatients(
  patient: string | undefined,
  search: string,
  closed: boolean,
  page: number,
) {
  return z
    .object({ total: z.number(), items: z.array(inpatientRowSchema) })
    .parse(
      unwrap(
        await db().rpc("list_inpatients", {
          patient_filter: patient ?? null,
          search_term: search,
          include_discharged: closed,
          page_number: page,
        }),
      ),
    );
}
export async function inpatientDetails(id: string, page: number) {
  return z
    .object({
      admission: admissionSchema,
      can_manage: z.boolean(),
      can_nurse: z.boolean(),
      can_doctor_note: z.boolean(),
      notes_total: z.number(),
      notes: z.array(noteSchema),
      movements: z.array(
        z.object({
          id: z.string(),
          kind: z.string(),
          from_bed: z.string().nullable(),
          to_bed: z.string().nullable(),
          reason: z.string(),
          created_at: z.string(),
          author: z.string(),
        }),
      ),
      discharge_reports: z.array(
        z.object({
          id: z.string(),
          number: z.string(),
          reported_on: z.string(),
        }),
      ),
    })
    .parse(
      unwrap(
        await db().rpc("inpatient_details", {
          admission_id: id,
          notes_page: page,
        }),
      ),
    );
}
type InpatientCommand =
  | "save_inpatient_ward"
  | "save_inpatient_bed"
  | "admit_inpatient"
  | "move_inpatient"
  | "add_inpatient_note"
  | "discharge_inpatient";
export async function inpatientCommand<K extends InpatientCommand>(
  name: K,
  args: Database["public"]["Functions"][K]["Args"],
) {
  const result = await db().rpc(name, args as never);
  if (result.error?.code === "23505")
    throw Error(
      name.includes("ward") || name.includes("bed")
        ? "Naziv već postoji u ovom odjelu ili ustanovi."
        : "Krevet ili pacijent već ima aktivni prijam. Osvježite prikaz.",
    );
  const messages: Record<string, string> = {
    "Occupied ward cannot be disabled":
      "Odjel s aktivnim prijamima nije moguće deaktivirati.",
    "Occupied bed cannot be disabled":
      "Zauzet krevet nije moguće deaktivirati.",
    "Current discharge report for this admission required":
      "Za otpust odaberite aktualno otpusno pismo povezano s ovim prijamom.",
    "Invalid transfer":
      "Premještaj zahtijeva slobodan aktivan krevet iste ustanove i obrazloženje.",
    "Admission is closed":
      "Hospitalizacija je zaključena. Dostupan je ispravak postojeće bilješke.",
  };
  if (result.error && messages[result.error.message])
    throw Error(messages[result.error.message]);
  return unwrap(result);
}

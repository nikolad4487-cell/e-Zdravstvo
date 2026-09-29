import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import { appointmentSchema } from "../types/appointments";
import type { Json } from "../lib/database.types";
export async function getAppointments(
  from: string,
  to: string,
  personal = false,
  patientId?: string,
) {
  return z.array(appointmentSchema).parse(
    unwrap(
      await db().rpc("list_appointments", {
        date_from: from,
        date_to: to,
        personal,
        patient_filter: patientId ?? null,
      }),
    ),
  );
}
export async function getAppointmentDoctors(patientId: string) {
  return z
    .array(
      z.object({ id: z.string(), name: z.string(), institution: z.string() }),
    )
    .parse(
      unwrap(await db().rpc("appointment_doctors", { patient_id: patientId })),
    );
}
export async function saveAppointment(
  id: string | null,
  version: number | null,
  data: Json,
  requestId: string,
) {
  return unwrap(
    await db().rpc("save_appointment", {
      appointment_id: id,
      expected_version: version,
      data,
      request_id: requestId,
    }),
  );
}
export async function setAppointmentStatus(
  id: string,
  version: number,
  status: string,
  reason = "",
) {
  return unwrap(
    await db().rpc("set_appointment_status", {
      appointment_id: id,
      expected_version: version,
      new_status: status,
      reason,
    }),
  );
}

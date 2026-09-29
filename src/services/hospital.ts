import { z } from "zod";
import { db } from "../lib/supabase";
import { unwrap } from "./clinical";
import {
  hospitalContextSchema,
  hospitalSlotSchema,
  hospitalBookingSchema,
  type HospitalMode,
} from "../types/hospital";
export async function hospitalContext(manage = false) {
  return hospitalContextSchema.parse(
    unwrap(await db().rpc("hospital_context", { manage })),
  );
}
export async function hospitalSlots(
  serviceId: string,
  from: string,
  to: string,
  manage = false,
) {
  if (!serviceId) return [];
  return z
    .array(hospitalSlotSchema)
    .parse(
      unwrap(
        await db().rpc("list_hospital_slots", {
          service_id: serviceId,
          date_from: from,
          date_to: to,
          manage,
        }),
      ),
    );
}
export async function hospitalBookings(
  mode: HospitalMode,
  patientId?: string,
  page = 0,
) {
  return z
    .array(hospitalBookingSchema)
    .parse(
      unwrap(
        await db().rpc("list_hospital_bookings", {
          mode,
          patient_filter: patientId ?? null,
          page_number: page,
        }),
      ),
    );
}

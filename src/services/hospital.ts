import { z } from "zod";
export async function nextHospitalBooking() {
  return z
    .object({
      id: z.string(),
      starts_at: z.string(),
      service_name: z.string(),
      institution_name: z.string(),
      location: z.string(),
      priority: z.boolean(),
    })
    .nullable()
    .parse(unwrap(await db().rpc("my_next_hospital_booking", {})));
}
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
  return z.array(hospitalSlotSchema).parse(
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
  return z.array(hospitalBookingSchema).parse(
    unwrap(
      await db().rpc("list_hospital_bookings", {
        mode,
        patient_filter: patientId ?? null,
        page_number: page,
      }),
    ),
  );
}

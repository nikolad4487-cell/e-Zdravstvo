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

export async function hospitalRescheduleHistory(bookingId: string) {
  return z
    .array(
      z.object({
        id: z.string(),
        created_at: z.string(),
        reason: z.string(),
        old_starts_at: z.string(),
        new_starts_at: z.string(),
      }),
    )
    .parse(
      unwrap(
        await db().rpc("hospital_reschedule_history", {
          booking_id: bookingId,
        }),
      ),
    );
}
export async function rescheduleHospital(
  booking: { id: string; version: number },
  slotId: string,
  reason: string,
  requestId: string,
) {
  unwrap(
    await db().rpc("reschedule_hospital_booking", {
      booking_id: booking.id,
      new_slot_id: slotId,
      expected_version: booking.version,
      reason,
      request_id: requestId,
    }),
  );
}

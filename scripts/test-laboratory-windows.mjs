import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, otherDoc, patient } = await workflowFixture();
try {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14 + ((8 - date.getUTCDay()) % 7));
  const day = date.toISOString().slice(0, 10);
  const stamp = async (clock, offset = 0) =>
    (
      await db.query(
        "select (($1::date+$2::int)+$3::time) at time zone 'Europe/Zagreb' t",
        [day, offset, clock],
      )
    ).rows[0].t;
  const dept = await as(5, () =>
    rpc("save_hospital_department", [
      null,
      org,
      "Testni laboratorij",
      15,
      true,
    ]),
  );
  const service = await as(5, () =>
    rpc("create_hospital_laboratory", [
      dept,
      otherDoc,
      "Laboratorij - Uzimanje venske krvi",
      "Laboratorij",
      "Testna lokacija",
      "",
      "VVK",
    ]),
  );
  const context = await as(1, () => rpc("priority_hospital_context", [false]));
  const lab = context.services.find((s) => s.id === service);
  assert.equal(lab.shifts.length, 5);
  assert.ok(lab.shifts.every((s) => s.shift === "FULL_DAY" && s.weekday <= 5));
  assert.equal(lab.laboratory_tests.length, 3);
  const routine = lab.laboratory_tests.find((t) => t.code === "LOCAL-ROUTINE"),
    thyroid = lab.laboratory_tests.find((t) => t.code === "LOCAL-THYROID"),
    suppression = lab.laboratory_tests.find(
      (t) => t.code === "LOCAL-DEX-SUPPRESSION",
    );
  const slots = (tests) =>
    as(1, () =>
      rpc("priority_laboratory_slots", [
        patient,
        service,
        tests.map((t) => t.id),
        day,
        day,
      ]),
    );
  assert.equal((await slots([routine])).length, 10);
  assert.equal((await slots([thyroid])).length, 48);
  assert.equal((await slots([suppression])).length, 24);
  assert.equal((await slots([routine, thyroid, suppression])).length, 6);
  const friday = new Date(day + "T12:00:00Z");
  friday.setUTCDate(friday.getUTCDate() + 4);
  const saturday = new Date(day + "T12:00:00Z");
  saturday.setUTCDate(saturday.getUTCDate() + 5);
  assert.equal(
    (
      await as(1, () =>
        rpc("priority_laboratory_slots", [
          patient,
          service,
          [thyroid.id],
          saturday.toISOString().slice(0, 10),
          saturday.toISOString().slice(0, 10),
        ]),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await as(1, () =>
        rpc("priority_laboratory_slots", [
          patient,
          service,
          [thyroid.id],
          friday.toISOString().slice(0, 10),
          friday.toISOString().slice(0, 10),
        ]),
      )
    ).length,
    48,
  );
  const newRef = {
    referral_code: "A3",
    reason: "Izmišljena testna indikacija",
    expires_on: saturday.toISOString().slice(0, 10),
  };
  const book = (test, clock, key) =>
    as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        clock,
        null,
        newRef,
        "Testna prioritetna narudžba",
        id(key),
        [test.id],
        "VENIPUNCTURE",
      ]),
    );
  await assert.rejects(
    book(routine, await stamp("09:30"), 9501),
    /sampling window/,
  );
  await assert.rejects(
    book(suppression, await stamp("07:45"), 9502),
    /sampling window/,
  );
  await assert.rejects(
    book(suppression, await stamp("14:00"), 9503),
    /sampling window/,
  );
  const booked = await book(routine, await stamp("09:15"), 9504);
  const stored = (
    await as(1, () => rpc("list_hospital_bookings", ["CARE", patient, 0]))
  )[0];
  assert.equal(stored.laboratory_details.sampling_until, "09:30:00");
  const invalidSlot = (
    await db.query(
      "insert into hospital_slots(service_id,starts_at,duration_minutes,priority_only,created_by,clinic_generated) values($1,$2,15,true,$3,true) returning id",
      [service, await stamp("10:00"), id(1)],
    )
  ).rows[0].id;
  await assert.rejects(
    as(1, () =>
      rpc("reschedule_hospital_booking", [
        booked.booking_id,
        invalidSlot,
        1,
        "Izmišljena promjena termina",
        id(9505),
      ]),
    ),
    /sampling window/,
  );
  await book(thyroid, await stamp("18:45"), 9506);
  await book(suppression, await stamp("13:45"), 9507);
  assert.equal((await slots([routine])).length, 9);
  assert.equal((await slots([thyroid])).length, 45);
  // An edit must preserve the historical booking's window; idempotent defaults never overwrite edits.
  await as(2, () =>
    rpc("save_hospital_laboratory_test", [
      service,
      routine.id,
      {
        code: routine.code,
        name: routine.name,
        sampling_from: "07:30",
        sampling_until: "08:30",
      },
    ]),
  );
  await as(2, () => rpc("apply_laboratory_sampling_defaults", [service]));
  assert.equal(
    (await as(1, () => rpc("priority_hospital_context", [false]))).services
      .find((s) => s.id === service)
      .laboratory_tests.find((t) => t.id === routine.id).sampling_until,
    "08:30:00",
  );
  assert.equal(
    (
      await as(1, () => rpc("list_hospital_bookings", ["CARE", patient, 0]))
    ).find((b) => b.id === booked.booking_id).laboratory_details.sampling_until,
    "09:30:00",
  );
  console.log(
    "PASS Mon–Fri full-day laboratory defaults, exact routine/thyroid/suppression windows, intersections, boundary/overlap checks, frozen rescheduling window and idempotent non-destructive defaults.",
  );
} finally {
  await db.close();
}

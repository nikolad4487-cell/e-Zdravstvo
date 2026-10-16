import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, otherDoc, patient } = await workflowFixture();
try {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 14 + ((8 - date.getUTCDay()) % 7));
  const day = date.toISOString().slice(0, 10);
  const stamp = async (time) =>
    (
      await db.query(
        "select ($1::timestamp at time zone 'Europe/Zagreb')::text t",
        [day + "T" + time],
      )
    ).rows[0].t;
  const dept = await as(5, () =>
    rpc("save_hospital_department", [
      null,
      org,
      "Laboratorij – endokrinologija",
      15,
      true,
    ]),
  );
  const service = await as(5, () =>
    rpc("create_priority_hospital_service", [
      dept,
      otherDoc,
      "Laboratorij - Uzimanje venske krvi",
      "Laboratorij – endokrinologija",
      "Laboratorij, prizemlje",
      "Ponijeti važeću uputnicu.",
    ]),
  );
  await as(5, () => rpc("configure_hospital_laboratory", [service, "VVK"]));
  await as(2, () => rpc("set_hospital_clinic_shift", [service, 1, "MORNING"]));
  const hormone = await as(2, () =>
    rpc("save_hospital_laboratory_test", [
      service,
      null,
      {
        code: "LOCAL-TSH",
        name: "Hormoni štitnjače",
        instructions: "Priprema prema pisanoj uputi laboratorija.",
      },
    ]),
  );
  const cortisol = await as(2, () =>
    rpc("save_hospital_laboratory_test", [
      service,
      null,
      {
        code: "LOCAL-CORT",
        name: "Bazalni kortizol – protokol laboratorija",
        required_time: "08:00",
        instructions: "Test prema individualnoj uputi liječnika.",
        steps: [
          {
            day_offset: -1,
            time: "20:00",
            label: "Provjera pripreme",
            instructions: "Slijediti pisanu uputu odgovornog liječnika.",
          },
          {
            day_offset: 0,
            time: "08:00",
            label: "Uzimanje uzorka",
            instructions: "Dolazak u laboratorij.",
          },
        ],
      },
    ]),
  );
  const context = await as(1, () => rpc("priority_hospital_context", [false]));
  assert.equal(
    context.services.find((s) => s.id === service).laboratory_tests.length,
    2,
  );
  const avail = await as(1, () =>
    rpc("priority_laboratory_slots", [patient, service, [cortisol], day, day]),
  );
  assert.equal(avail.length, 1);
  assert.equal(
    new Date(avail[0].starts_at).getTime(),
    new Date(await stamp("08:00")).getTime(),
  );
  const ordinary = await as(1, () =>
    rpc("priority_laboratory_slots", [patient, service, [hormone], day, day]),
  );
  assert.equal(ordinary.length, 26);
  const newRef = {
    referral_code: "A3",
    reason: "Izmišljena testna indikacija",
    expires_on: day,
  };
  const book = (time, key, tests = [cortisol]) =>
    as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        time,
        null,
        newRef,
        "Izmišljeno testno naručivanje",
        id(key),
        tests,
        "VENIPUNCTURE",
      ]),
    );
  await assert.rejects(book(await stamp("08:15"), 9101), /specific time/);
  assert.equal(
    (await db.query("select count(*)::int n from hospital_bookings")).rows[0].n,
    0,
  );
  const good = await book(await stamp("08:00"), 9102);
  assert.deepEqual(await book(await stamp("08:00"), 9102), good);
  const queued = (
    await db.query(
      "select s.payload from private.appointment_email_snapshots s join public.notifications n on n.id=s.notification_id where n.hospital_booking_id=$1",
      [good.booking_id],
    )
  ).rows[0].payload;
  assert.equal(queued.kind, "Laboratorijska usluga");
  assert.equal(queued.pdfDetails.laboratory.tests[0].code, "LOCAL-CORT");
  const listing = await as(1, () =>
    rpc("list_hospital_bookings", ["CARE", patient, 0]),
  );
  const snapshot = listing[0].laboratory_details;
  assert.equal(snapshot.procedure_code, "VVK");
  assert.equal(snapshot.tests[0].code, "LOCAL-CORT");
  assert.equal(snapshot.tests[0].steps.length, 2);
  assert.equal(
    (
      await as(1, () =>
        rpc("priority_laboratory_slots", [
          patient,
          service,
          [cortisol],
          day,
          day,
        ]),
      )
    ).length,
    0,
  );
  await assert.rejects(
    as(1, () =>
      rpc("book_priority_hospital", [
        patient,
        service,
        ordinary[0].starts_at,
        null,
        newRef,
        "Testni prioritet",
        id(9103),
      ]),
    ),
    /Choose laboratory tests/,
  );
  await assert.rejects(
    as(2, () =>
      rpc("save_hospital_laboratory_test", [
        service,
        null,
        {
          code: "BAD",
          name: "Nevaljani korak",
          steps: [{ label: "Test", day_offset: 0, time: "25:00" }],
        },
      ]),
    ),
    /Invalid protocol step/,
  );
  await assert.rejects(
    as(4, () =>
      rpc("priority_laboratory_slots", [
        patient,
        service,
        [cortisol],
        day,
        day,
      ]),
    ),
    /Forbidden/,
  );
  await assert.rejects(
    as(1, () =>
      rpc("save_hospital_laboratory_test", [
        service,
        null,
        { code: "NO", name: "Nedopušteno" },
      ]),
    ),
    /Forbidden/,
  );
  await assert.rejects(
    as(0, () =>
      rpc("priority_laboratory_slots", [
        patient,
        service,
        [cortisol],
        day,
        day,
      ]),
    ),
    /permission denied/,
  );
  await as(2, () =>
    rpc("save_hospital_laboratory_test", [
      service,
      cortisol,
      {
        code: "LOCAL-CORT",
        name: "Promijenjeni naziv",
        required_time: "09:00",
        active: false,
      },
    ]),
  );
  assert.deepEqual(
    (await as(1, () => rpc("list_hospital_bookings", ["CARE", patient, 0])))[0]
      .laboratory_details,
    snapshot,
  );
  const snapshotPdf = (
    await db.query("select private.booking_pdf_details(null,$1) d", [
      good.booking_id,
    ])
  ).rows[0].d;
  assert.equal(snapshotPdf.laboratory.procedure_code, "VVK");
  const slot = (
    await db.query("select slot_id from hospital_bookings where id=$1", [
      good.booking_id,
    ])
  ).rows[0].slot_id;
  // Metadata is immutable and a reschedule must retain the originally booked sampling time.
  await assert.rejects(
    db.query(
      "update hospital_bookings set laboratory_details='{}' where id=$1",
      [good.booking_id],
    ),
    /immutable/,
  );
  const wrongSlot = (
    await db.query(
      "insert into hospital_slots(service_id,starts_at,duration_minutes,priority_only,created_by,clinic_generated) values($1,$2,15,true,$3,true) returning id",
      [service, await stamp("09:00"), id(1)],
    )
  ).rows[0].id;
  await assert.rejects(
    as(1, () =>
      rpc("reschedule_hospital_booking", [
        good.booking_id,
        wrongSlot,
        1,
        "Izmišljeno testno premještanje",
        id(9104),
      ]),
    ),
    /specific time/,
  );
  assert.equal(
    (
      await db.query("select slot_id from hospital_bookings where id=$1", [
        good.booking_id,
      ])
    ).rows[0].slot_id,
    slot,
  );
  console.log(
    "PASS laboratory directory, configurable tests/protocols, fixed Zagreb sampling time, occupied-slot hiding, atomic referral/booking, retries, immutable PDF snapshot, reschedule restrictions and access control.",
  );
} finally {
  await db.close();
}

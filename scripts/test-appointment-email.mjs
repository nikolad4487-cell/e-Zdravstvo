import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, id, org, doc, otherDoc, patient, as, rpc } =
  await workflowFixture();
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  passed++;
}
async function service(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const claim = () => service(() => rpc("claim_notification_emails", [20]));
const finish = (job, success) =>
  service(() =>
    rpc("complete_notification_email", [
      job.id,
      job.lease_id,
      success,
      success ? "test-provider-id" : null,
      60,
    ]),
  );
const date = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const data = (time, kind = "Kontrolni pregled") => ({
  patient_id: patient,
  doctor_id: doc,
  local_time: date + "T" + time,
  duration_minutes: 30,
  kind,
});
await service(() => rpc("configure_notification_delivery", [true]));
await as(3, () => rpc("save_notification_preferences", [true, true]));
await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
  id(3),
]);
await db.query(
  "update institutions set address='Testna ulica 2',city='Zagreb' where id=$1",
  [org],
);
let booking, job;
await test("authorized booking queues one confirmation with only arrival details", async () => {
  booking = await as(1, () =>
    rpc("save_appointment", [null, null, data("09:00"), id(800)]),
  );
  assert.equal(
    await as(1, () =>
      rpc("save_appointment", [null, null, data("09:00"), id(800)]),
    ),
    booking,
  );
  const jobs = await claim();
  assert.equal(jobs.length, 1);
  job = jobs[0];
  assert.equal(job.appointment.eventType, "BOOKED");
  assert.equal(job.appointment.patientName, "Testna Osoba");
  assert.equal(job.appointment.kind, "Kontrolni pregled");
  assert.match(job.appointment.location, /Testna ulica 2/);
  assert.equal(job.email, "fictional3@example.test");
  assert.match(job.appointment.bookingReference, /^PREG-\d{4}-\d{5,}$/);
  assert.deepEqual(await claim(), []);
});
await test("failed delivery is logged and never rolls back a reservation", async () => {
  await finish(job, false);
  assert.equal(
    (await db.query("select status from appointments where id=$1", [booking]))
      .rows[0].status,
    "SCHEDULED",
  );
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "PENDING",
  );
  assert.equal(
    (
      await db.query(
        "select outcome from private.notification_email_attempts where job_id=$1",
        [job.id],
      )
    ).rows[0].outcome,
    "DELIVERY_FAILED",
  );
});
await test("retry keeps the same job and payload; success and duplicate completion are recorded once", async () => {
  await db.query(
    "update private.notification_email_outbox set next_attempt_at=now() where id=$1",
    [job.id],
  );
  const [retry] = await claim();
  assert.equal(retry.id, job.id);
  assert.deepEqual(retry.appointment, job.appointment);
  await finish(retry, true);
  await finish(retry, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_attempts where job_id=$1",
        [job.id],
      )
    ).rows[0].n,
    2,
  );
  assert.deepEqual(await claim(), []);
});
await test("rescheduling supersedes stale pending confirmations and excludes free text diagnoses", async () => {
  await as(1, () =>
    rpc("save_appointment", [
      booking,
      1,
      data("10:00", "Pregled zbog SECRET DIAGNOSIS"),
      id(801),
    ]),
  );
  await as(1, () =>
    rpc("save_appointment", [
      booking,
      2,
      data("11:00", "Pregled zbog SECRET DIAGNOSIS"),
      id(802),
    ]),
  );
  const jobs = await claim();
  assert.equal(jobs.length, 1);
  job = jobs[0];
  assert.equal(job.appointment.eventType, "RESCHEDULED");
  assert.equal(
    job.appointment.bookingReference,
    (
      await db.query(
        "select payload from private.appointment_email_snapshots s join notifications n on n.id=s.notification_id where n.appointment_id=$1 order by s.sequence_id limit 1",
        [booking],
      )
    ).rows[0].payload.bookingReference,
  );
  assert.equal(job.appointment.kind, "Pregled u ordinaciji");
  assert.ok(!JSON.stringify(job).includes("SECRET"));
});
await test("cancellation invalidates an in-flight change and queues a cancellation without its reason", async () => {
  await as(1, () =>
    rpc("set_appointment_status", [
      booking,
      3,
      "CANCELLED",
      "SECRET MEDICAL REASON",
    ]),
  );
  const [cancel] = await claim();
  assert.equal(cancel.appointment.eventType, "CANCELLED");
  assert.equal(
    cancel.appointment.bookingReference,
    job.appointment.bookingReference,
  );
  assert.ok(!JSON.stringify(cancel).includes("SECRET"));
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "CANCELLED",
  );
  await finish(job, true);
  await finish(cancel, true);
});
await test("unverified addresses, opt-out and changed patient ownership prevent delivery", async () => {
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    id(3),
  ]);
  const other = await as(1, () =>
    rpc("save_appointment", [null, null, data("12:00"), id(803)]),
  );
  assert.deepEqual(await claim(), []);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    id(3),
  ]);
  await db.query("update patients set user_id=null where id=$1", [patient]);
  assert.deepEqual(await claim(), []);
  await db.query("update patients set user_id=$1 where id=$2", [
    id(3),
    patient,
  ]);
  await as(3, () => rpc("save_notification_preferences", [false, true]));
  await as(1, () =>
    rpc("save_appointment", [other, 1, data("13:00"), id(804)]),
  );
  assert.deepEqual(await claim(), []);
});
await test("frontend roles cannot claim, finish, insert notifications or read delivery metadata", async () => {
  for (const n of [0, 1, 3, 5])
    await as(n, async () => {
      await assert.rejects(rpc("claim_notification_emails", [20]));
      await assert.rejects(
        rpc("complete_notification_email", [
          job.id,
          job.lease_id,
          true,
          "spoof",
          60,
        ]),
      );
      await assert.rejects(
        db.query("select * from private.booking_email_references"),
      );
      await assert.rejects(
        db.query("select * from private.appointment_email_snapshots"),
      );
      await assert.rejects(
        db.query("select * from private.notification_email_attempts"),
      );
      await assert.rejects(
        db.query(
          "insert into notifications(user_id,message) values($1,'spoof')",
          [id(3)],
        ),
      );
    });
});
await test("uncertain deliveries stop before Resend's idempotency window expires", async () => {
  await as(3, () => rpc("save_notification_preferences", [true, true]));
  await db.query(
    "insert into notifications(user_id,message) values($1,'Test')",
    [id(3)],
  );
  const [uncertain] = await claim();
  await db.query(
    "update private.notification_email_outbox set first_attempt_at=now()-interval '24 hours',locked_until=now()-interval '1 minute' where id=$1",
    [uncertain.id],
  );
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [uncertain.id],
      )
    ).rows[0].status,
    "FAILED",
  );
});
await test("ordinary hospital bookings send confirmation, changed time and cancellation", async () => {
  const svc = await as(5, () =>
    rpc("save_hospital_service", [
      null,
      {
        institution_id: org,
        doctor_id: otherDoc,
        name: "Specijalistički pregled",
        specialty: "Test",
        location: "Ambulanta 2",
        instructions: "SECRET INSTRUCTIONS",
      },
    ]),
  );
  await as(5, () =>
    rpc("publish_hospital_slots", [svc, date + "T14:00", 30, 2, false]),
  );
  const slots = await as(1, () =>
    rpc("list_hospital_slots", [svc, date, date, false]),
  );
  const booked = await as(1, () =>
    rpc("book_hospital_slot", [patient, slots[0].id, null, false, "", id(850)]),
  );
  const [confirmed] = await claim();
  assert.equal(confirmed.confirmation.eventType, "BOOKED");
  assert.equal(confirmed.confirmation.priority, false);
  assert.equal(confirmed.confirmation.patientName, "Testna Osoba");
  assert.ok(!JSON.stringify(confirmed).includes("SECRET"));
  await finish(confirmed, true);
  await as(1, () =>
    rpc("reschedule_hospital_booking", [
      booked,
      slots[1].id,
      1,
      "SECRET RESCHEDULE REASON",
      id(851),
    ]),
  );
  const [changed] = await claim();
  assert.equal(changed.confirmation.eventType, "RESCHEDULED");
  assert.equal(
    changed.confirmation.bookingReference,
    confirmed.confirmation.bookingReference,
  );
  assert.notEqual(
    changed.confirmation.startsAt,
    confirmed.confirmation.startsAt,
  );
  assert.ok(!JSON.stringify(changed).includes("SECRET"));
  await finish(changed, true);
  await as(1, () =>
    rpc("change_hospital_booking", [
      booked,
      2,
      "CANCELLED",
      "SECRET CANCELLATION",
    ]),
  );
  const [cancelled] = await claim();
  assert.equal(cancelled.confirmation.eventType, "CANCELLED");
  assert.equal(
    cancelled.confirmation.bookingReference,
    confirmed.confirmation.bookingReference,
  );
  assert.ok(!JSON.stringify(cancelled).includes("SECRET"));
  await finish(cancelled, true);
});
await test("five failed attempts exhaust retries without duplicate attempt logs", async () => {
  await db.query(
    "insert into notifications(user_id,message) values($1,'Test retry limit')",
    [id(3)],
  );
  let last;
  for (let i = 1; i <= 5; i++) {
    const [queued] = await claim();
    last = queued;
    await finish(queued, false);
    await finish(queued, false);
    await db.query(
      "update private.notification_email_outbox set next_attempt_at=now() where id=$1",
      [queued.id],
    );
  }
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [last.id],
      )
    ).rows[0].status,
    "FAILED",
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_attempts where job_id=$1",
        [last.id],
      )
    ).rows[0].n,
    5,
  );
});
await test("unauthorized scheduling cannot create an email", async () => {
  const before = (
    await db.query(
      "select count(*)::int n from private.notification_email_outbox",
    )
  ).rows[0].n;
  for (const n of [0, 3, 4, 5])
    await as(n, () =>
      assert.rejects(
        rpc("save_appointment", [null, null, data("15:00"), id(870 + n)]),
      ),
    );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_outbox",
      )
    ).rows[0].n,
    before,
  );
});

await db.query(
  "update patients set user_id=null,email='contact@example.test' where id=$1",
  [patient],
);
let contactBooking, contactJob;
await test("accountless clinic booking uses the chart address and deduplicates requests", async () => {
  contactBooking = await as(1, () =>
    rpc("save_appointment", [null, null, data("16:00"), id(900)]),
  );
  assert.equal(
    await as(1, () =>
      rpc("save_appointment", [null, null, data("16:00"), id(900)]),
    ),
    contactBooking,
  );
  const jobs = await claim();
  assert.equal(jobs.length, 1);
  contactJob = jobs[0];
  assert.equal(contactJob.email, "contact@example.test");
  assert.match(contactJob.appointment.bookingReference, /^PREG-\d{4}-\d{5,}$/);
  assert.equal(contactJob.portalAccess, false);
  assert.equal(contactJob.appointment.eventType, "BOOKED");
  assert.deepEqual(await claim(), []);
  await finish(contactJob, false);
  assert.equal(
    (
      await db.query("select status from appointments where id=$1", [
        contactBooking,
      ])
    ).rows[0].status,
    "SCHEDULED",
  );
  await db.query(
    "update private.notification_email_outbox set next_attempt_at=now() where id=$1",
    [contactJob.id],
  );
  const [retry] = await claim();
  assert.equal(retry.id, contactJob.id);
  assert.equal(retry.email, contactJob.email);
  await finish(retry, true);
});
await test("accountless clinic changes and cancellation supersede old events and omit medical reasons", async () => {
  await as(1, () =>
    rpc("save_appointment", [contactBooking, 1, data("17:00"), id(901)]),
  );
  const [changed] = await claim();
  assert.equal(changed.appointment.eventType, "RESCHEDULED");
  await as(1, () =>
    rpc("set_appointment_status", [
      contactBooking,
      2,
      "CANCELLED",
      "SECRET contact cancellation",
    ]),
  );
  const [cancelled] = await claim();
  assert.equal(cancelled.appointment.eventType, "CANCELLED");
  assert.ok(!JSON.stringify(cancelled).includes("SECRET"));
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [changed.id],
      )
    ).rows[0].status,
    "CANCELLED",
  );
  await finish(cancelled, true);
});
let contactHospital, contactService, contactSlots;
await test("accountless PRIORITY booking queues a chart-address confirmation and reports PENDING", async () => {
  const dep = await as(5, () =>
    rpc("save_hospital_department", [
      null,
      org,
      "Testni kontaktni odjel",
      30,
      true,
    ]),
  );
  contactService = await as(5, () =>
    rpc("create_priority_hospital_service", [
      dep,
      otherDoc,
      "Specijalistički pregled",
      "Testni kontaktni odjel",
      "Ambulanta 3",
      "SECRET instructions",
    ]),
  );
  const weekday = (
    await db.query("select extract(isodow from $1::date)::int n", [date])
  ).rows[0].n;
  await as(2, () =>
    rpc("set_hospital_clinic_shift", [contactService, weekday, "MORNING"]),
  );
  contactSlots = await as(1, () =>
    rpc("priority_hospital_slots", [patient, contactService, date, date]),
  );
  const args = [
    patient,
    contactService,
    contactSlots[0].starts_at,
    null,
    {
      reason: "SECRET referral reason",
      expires_on: date,
      notes: "SECRET notes",
    },
    "SECRET priority reason",
    id(910),
  ];
  const result = await as(1, () => rpc("book_priority_hospital", args));
  contactHospital = result.booking_id;
  assert.deepEqual(
    await as(1, () => rpc("book_priority_hospital", args)),
    result,
  );
  assert.equal(
    await as(1, () => rpc("hospital_booking_email_status", [contactHospital])),
    "PENDING",
  );
  const [job] = await claim();
  assert.equal(job.email, "contact@example.test");
  assert.equal(job.confirmation.priority, true);
  assert.equal(job.confirmation.eventType, "BOOKED");
  assert.ok(!JSON.stringify(job).includes("SECRET"));
  await finish(job, true);
  assert.equal(
    await as(1, () => rpc("hospital_booking_email_status", [contactHospital])),
    "SENT",
  );
});
await test("accountless hospital rescheduling and cancellation send only the latest state", async () => {
  await as(5, () =>
    rpc("publish_hospital_slots", [
      contactService,
      date + "T08:00",
      30,
      1,
      true,
    ]),
  );
  const slots = await as(1, () =>
    rpc("list_hospital_slots", [contactService, date, date, false]),
  );
  await as(1, () =>
    rpc("reschedule_hospital_booking", [
      contactHospital,
      slots[0].id,
      1,
      "SECRET change reason",
      id(911),
    ]),
  );
  const [changed] = await claim();
  assert.equal(changed.confirmation.eventType, "RESCHEDULED");
  await as(1, () =>
    rpc("change_hospital_booking", [
      contactHospital,
      2,
      "CANCELLED",
      "SECRET cancel reason",
    ]),
  );
  const [cancelled] = await claim();
  assert.equal(cancelled.confirmation.eventType, "CANCELLED");
  assert.ok(!JSON.stringify(cancelled).includes("SECRET"));
  await finish(cancelled, true);
});
await test("a changed contact address cancels pending delivery without retargeting it", async () => {
  await as(1, () =>
    rpc("save_appointment", [null, null, data("18:00"), id(920)]),
  );
  const [job] = await claim();
  await finish(job, false);
  await db.query(
    "update patients set email='changed@example.test' where id=$1",
    [patient],
  );
  await db.query(
    "update private.notification_email_outbox set next_attempt_at=now() where id=$1",
    [job.id],
  );
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "CANCELLED",
  );
});
await test("missing and malformed contact addresses preserve appointments without queueing mail", async () => {
  for (const [n, email] of [
    null,
    "not-an-email",
    "a@example.test\nBcc: x@example.test",
  ].entries()) {
    await db.query("update patients set email=$1 where id=$2", [
      email,
      patient,
    ]);
    const before = (
      await db.query(
        "select count(*)::int n from private.notification_email_outbox",
      )
    ).rows[0].n;
    const appointment = await as(1, () =>
      rpc("save_appointment", [
        null,
        null,
        data(String(19 + n) + ":00"),
        id(930 + n),
      ]),
    );
    assert.ok(appointment);
    assert.equal(
      (
        await db.query(
          "select count(*)::int n from private.notification_email_outbox",
        )
      ).rows[0].n,
      before,
    );
    assert.equal(
      await as(1, () =>
        rpc("hospital_booking_email_status", [contactHospital]),
      ),
      "NO_EMAIL",
    );
  }
});
await test("contact retries also stop within the provider idempotency window", async () => {
  await db.query(
    "update patients set email='contact@example.test' where id=$1",
    [patient],
  );
  const nextDate = new Date(Date.now() + 15 * 86400000)
    .toISOString()
    .slice(0, 10);
  await as(1, () =>
    rpc("save_appointment", [
      null,
      null,
      { ...data("08:00"), local_time: nextDate + "T08:00" },
      id(950),
    ]),
  );
  const [job] = await claim();
  await db.query(
    "update private.notification_email_outbox set first_attempt_at=now()-interval '24 hours',locked_until=now()-interval '1 minute' where id=$1",
    [job.id],
  );
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "FAILED",
  );
});
await test("linking an account invalidates pending contact mail instead of sending twice", async () => {
  const nextDate = new Date(Date.now() + 15 * 86400000)
    .toISOString()
    .slice(0, 10);
  const booked = await as(1, () =>
    rpc("save_appointment", [
      null,
      null,
      { ...data("09:00"), local_time: nextDate + "T09:00" },
      id(951),
    ]),
  );
  const before = (
    await db.query(
      "select count(*)::int n from private.notification_email_outbox",
    )
  ).rows[0].n;
  await db.query(
    "select private.queue_contact_appointment_email($1,null,'BOOKED')",
    [booked],
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_outbox",
      )
    ).rows[0].n,
    before,
  );
  const [job] = await claim();
  await db.query("update patients set user_id=$1 where id=$2", [
    id(3),
    patient,
  ]);
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "CANCELLED",
  );
});
await test("account preferences and verified login remain authoritative when a chart email exists", async () => {
  await db.query(
    "update patients set user_id=$1,email='contact@example.test' where id=$2",
    [id(3), patient],
  );
  await as(3, () => rpc("save_notification_preferences", [false, true]));
  await as(1, () =>
    rpc("save_appointment", [null, null, data("22:00"), id(940)]),
  );
  assert.deepEqual(await claim(), []);
  await as(3, () => rpc("save_notification_preferences", [true, true]));
  await db.query("update auth.users set email_confirmed_at=null where id=$1", [
    id(3),
  ]);
  await as(1, () =>
    rpc("save_appointment", [null, null, data("23:00"), id(941)]),
  );
  assert.deepEqual(await claim(), []);
});
await test("frontend cannot create contact events, read addresses or invoke the private queue", async () => {
  for (const n of [0, 1, 3, 5])
    await as(n, async () => {
      await assert.rejects(
        db.query("select * from private.contact_appointment_email_events"),
      );
      await assert.rejects(
        db.query(
          "select private.queue_contact_appointment_email(null,$1,'BOOKED')",
          [contactHospital],
        ),
      );
      if (n !== 1 && n !== 3)
        await assert.rejects(
          rpc("hospital_booking_email_status", [contactHospital]),
        );
    });
});

await db.close();
console.log(`${passed} appointment email checks passed.`);

import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, id, org, doc, otherDoc, patient, secondPatient, as, rpc } =
  await workflowFixture();
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  passed++;
}
const future = new Date(Date.now() + 14 * 86400000);
future.setUTCDate(future.getUTCDate() + ((8 - future.getUTCDay()) % 7));
const monday = future.toISOString().slice(0, 10);
const shift = (day, n) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const stamp = async (day, time) =>
  (
    await db.query(
      "select ($1::timestamp at time zone 'Europe/Zagreb')::text value",
      [day + "T" + time],
    )
  ).rows[0].value;
const dept15 = await as(5, () =>
  rpc("save_hospital_department", [null, org, "Kardiologija", 15, true]),
);
const dept30 = await as(5, () =>
  rpc("save_hospital_department", [null, org, "Ortopedija", 30, true]),
);
const service15 = await as(5, () =>
  rpc("create_priority_hospital_service", [
    dept15,
    otherDoc,
    "Pregled kardiologa",
    "Kardiologija",
    "Ambulanta 1",
    "Ponijeti uputnicu",
  ]),
);
const service30 = await as(5, () =>
  rpc("create_priority_hospital_service", [
    dept30,
    otherDoc,
    "Pregled ortopeda",
    "Ortopedija",
    "Ambulanta 2",
    "",
  ]),
);
for (const s of [service15, service30]) {
  await as(2, () => rpc("set_hospital_clinic_shift", [s, 1, "MORNING"]));
  await as(2, () => rpc("set_hospital_clinic_shift", [s, 2, "AFTERNOON"]));
}
const available = (s, day = monday, pid = patient) =>
  as(1, () => rpc("priority_hospital_slots", [pid, s, day, day]));
const createRef = async (
  pid = patient,
  specialty = "Kardiologija",
  expires = shift(monday, 90),
  request = 990,
) =>
  as(1, () =>
    rpc("issue_document", [
      pid,
      "REFERRAL",
      {
        referral_type: "SPECIALIST",
        specialty,
        reason: "Izmišljena provjera",
        priority: "REGULAR",
        expires_on: expires,
        notes: "",
      },
      id(request),
    ]),
  );
const newRef = {
  reason: "Izmišljena indikacija",
  expires_on: shift(monday, 90),
  notes: "",
};
const reason = "Izmišljeni prioritetni pregled";
const book = (
  starts,
  request,
  ref = null,
  pid = patient,
  service = service15,
  data = newRef,
) =>
  as(1, () =>
    rpc("book_priority_hospital", [
      pid,
      service,
      starts,
      ref,
      ref ? null : data,
      reason,
      id(request),
    ]),
  );
await test("only an administrator can create departments and assign institutional specialists", async () => {
  for (const n of [0, 1, 2, 3, 4, 6])
    await as(n, () =>
      assert.rejects(
        rpc("save_hospital_department", [null, org, "Zabranjeno", 15, true]),
      ),
    );
  await as(1, () =>
    assert.rejects(
      rpc("set_hospital_clinic_shift", [service15, 1, "AFTERNOON"]),
    ),
  );
  await as(2, () =>
    assert.rejects(rpc("set_hospital_clinic_shift", [service15, 1, "INVALID"])),
  );
  await as(5, () =>
    assert.rejects(
      rpc("save_hospital_department", [null, org, "Nevaljano", 20, true]),
    ),
  );
  await db.query(
    "insert into institutions(id,name,code) values($1,'Druga bolnica','PRIORITYOTHER')",
    [id(60)],
  );
  const other = await as(5, () =>
    rpc("save_hospital_department", [null, id(60), "Drugi odjel", 30, true]),
  );
  await as(5, () =>
    assert.rejects(rpc("assign_hospital_department", [service15, other])),
  );
  const context = await as(1, () => rpc("priority_hospital_context", [false]));
  assert.equal(
    context.services.find((s) => s.id === service15).department_id,
    dept15,
  );
  assert.equal(
    (await as(2, () => rpc("priority_hospital_context", [true]))).services
      .length,
    2,
  );
  await as(0, () => assert.rejects(rpc("priority_hospital_context", [false])));
});
await test("morning and afternoon slots follow the specialist weekday with 15/30 minute boundaries", async () => {
  for (const [s, morning, afternoon, lastMorning, lastAfternoon] of [
    [service15, 26, 22, "13:15", "18:45"],
    [service30, 13, 11, "13:00", "18:30"],
  ]) {
    const rows = await available(s);
    assert.equal(rows.length, morning);
    assert.equal(
      new Date(rows[0].starts_at).getTime(),
      new Date(await stamp(monday, "07:00")).getTime(),
    );
    assert.equal(
      new Date(rows.at(-1).starts_at).getTime(),
      new Date(await stamp(monday, lastMorning)).getTime(),
    );
    const afternoonRows = await available(s, shift(monday, 1));
    assert.equal(afternoonRows.length, afternoon);
    assert.equal(
      new Date(afternoonRows[0].starts_at).getTime(),
      new Date(await stamp(shift(monday, 1), "13:30")).getTime(),
    );
    assert.equal(
      new Date(afternoonRows.at(-1).starts_at).getTime(),
      new Date(await stamp(shift(monday, 1), lastAfternoon)).getTime(),
    );
    assert.deepEqual(await available(s, shift(monday, 2)), []);
  }
  assert.equal(
    (await db.query("select count(*)::integer n from hospital_slots")).rows[0]
      .n,
    0,
  );
});
let booked;
const first = await stamp(monday, "07:00");
await test("new referral and priority booking are created atomically and retries do not duplicate either", async () => {
  booked = await book(first, 100);
  const again = await book(first, 100);
  assert.deepEqual(again, booked);
  const row = (
    await db.query("select * from hospital_bookings where id=$1", [
      booked.booking_id,
    ])
  ).rows[0];
  assert.equal(row.priority, true);
  assert.equal(row.patient_id, patient);
  assert.equal(row.referral_id, booked.referral_id);
  assert.equal(
    (
      await db.query("select count(*)::integer n from documents where id=$1", [
        booked.referral_id,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(book(await stamp(monday, "07:15"), 100));
});
await test("occupied times are hidden for every department sharing a specialist and cannot be booked twice", async () => {
  assert.equal((await available(service15)).length, 25);
  assert.equal((await available(service30)).length, 12);
  assert.ok(
    (await available(service15)).every(
      (s) => new Date(s.starts_at).getTime() !== new Date(first).getTime(),
    ),
  );
  const before = (await db.query("select count(*)::integer n from documents"))
    .rows[0].n;
  await assert.rejects(book(first, 101, null, secondPatient));
  assert.equal(
    (await db.query("select count(*)::integer n from documents")).rows[0].n,
    before,
  );
});
await test("out-of-shift, misaligned and invalid referrals roll back slots, documents and bookings", async () => {
  for (const [time, data] of [
    ["06:45", newRef],
    ["07:05", newRef],
    ["13:30", newRef],
    ["08:00", { ...newRef, expires_on: shift(monday, -1) }],
    ["08:00", { ...newRef, reason: "x" }],
  ]) {
    const before = (
      await db.query(
        "select (select count(*) from hospital_slots)::integer slots,(select count(*) from documents)::integer documents,(select count(*) from hospital_bookings)::integer bookings",
      )
    ).rows[0];
    await assert.rejects(
      book(await stamp(monday, time), 110, null, patient, service15, data),
    );
    assert.deepEqual(
      (
        await db.query(
          "select (select count(*) from hospital_slots)::integer slots,(select count(*) from documents)::integer documents,(select count(*) from hospital_bookings)::integer bookings",
        )
      ).rows[0],
      before,
    );
  }
});
await test("existing referrals must match patient, specialty, expiry and be unused", async () => {
  const ref = await createRef(patient, "Kardiologija", shift(monday, 90), 991);
  const wrong = await createRef(patient, "Ortopedija", shift(monday, 90), 992);
  const other = await createRef(
    secondPatient,
    "Kardiologija",
    shift(monday, 90),
    993,
  );
  const short = await createRef(
    patient,
    "Kardiologija",
    new Date().toISOString().slice(0, 10),
    994,
  );
  const starts = await stamp(monday, "09:00");
  for (const r of [wrong, other, short])
    await assert.rejects(book(starts, 120, r));
  const rows = await as(1, () =>
    rpc("priority_hospital_referrals", [patient, service15, starts, "", 0]),
  );
  assert.deepEqual(
    rows.map((r) => r.id),
    [ref],
  );
  const result = await book(starts, 121, ref);
  assert.equal(result.referral_id, ref);
  await assert.rejects(book(await stamp(monday, "09:15"), 122, ref));
  assert.deepEqual(
    await as(1, () =>
      rpc("priority_hospital_referrals", [patient, service15, starts, "", 0]),
    ),
    [],
  );
});
await test("patient, nurse, unrelated clinician and administrators cannot make clinical reservations", async () => {
  const starts = await stamp(monday, "10:00");
  for (const n of [0, 2, 3, 4, 5, 6])
    await as(n, () =>
      assert.rejects(
        rpc("book_priority_hospital", [
          patient,
          service15,
          starts,
          null,
          newRef,
          reason,
          id(130 + n),
        ]),
      ),
    );
  for (const n of [0, 2, 3, 5, 6])
    await as(n, () =>
      assert.rejects(
        rpc("priority_hospital_slots", [patient, service15, monday, monday]),
      ),
    );
  await as(3, () => rpc("set_my_care_access", [id(1), false]));
  await assert.rejects(book(starts, 139));
  await assert.rejects(available(service15));
  await as(3, () => rpc("set_my_care_access", [id(1), true]));
});
await test("all primary care specialties use their existing treating-doctor authorization", async () => {
  for (const specialty of [
    "Obiteljska medicina",
    "Stomatologija",
    "Ginekologija",
    "Pedijatrija",
  ]) {
    await db.query("update doctors set specialty=$1 where id=$2", [
      specialty,
      doc,
    ]);
    assert.ok((await available(service15)).length > 0);
  }
});
await test("clinic appointments, absences and general working hours remove otherwise valid times", async () => {
  const appointment = await as(2, () =>
    rpc("save_appointment", [
      null,
      null,
      {
        patient_id: secondPatient,
        doctor_id: otherDoc,
        local_time: monday + "T11:00",
        duration_minutes: 30,
        kind: "Izmišljeni pregled",
      },
      id(150),
    ]),
  );
  assert.ok(
    (await available(service15)).every(
      (s) =>
        !["11:00", "11:15"].includes(
          new Date(s.starts_at).toLocaleTimeString("hr-HR", {
            timeZone: "Europe/Zagreb",
            hour: "2-digit",
            minute: "2-digit",
          }),
        ),
    ),
  );
  await assert.rejects(book(await stamp(monday, "11:15"), 151));
  const absence = await as(2, () =>
    rpc("record_doctor_absence", [
      otherDoc,
      monday + "T12:00",
      monday + "T13:00",
      null,
      "Izmišljena odsutnost",
    ]),
  );
  const absenceStart = new Date(await stamp(monday, "12:00")).getTime(),
    absenceEnd = new Date(await stamp(monday, "13:00")).getTime();
  assert.ok(
    (await available(service15)).every(
      (s) =>
        new Date(s.starts_at).getTime() < absenceStart ||
        new Date(s.starts_at).getTime() >= absenceEnd,
    ),
  );
  await as(2, () => rpc("cancel_doctor_absence", [absence]));
  await as(2, () =>
    rpc("set_doctor_hours", [otherDoc, 1, "08:00", "13:30", true]),
  );
  assert.equal(
    new Date((await available(service15))[0].starts_at).getTime(),
    new Date(await stamp(monday, "08:00")).getTime(),
  );
  await as(2, () =>
    rpc("set_doctor_hours", [otherDoc, 1, "07:00", "13:30", true]),
  );
  assert.ok(appointment);
});
await test("changed shifts and paused departments preserve existing bookings while removing availability", async () => {
  await as(2, () => rpc("set_hospital_clinic_shift", [service15, 1, null]));
  assert.deepEqual(await available(service15), []);
  assert.equal(
    (
      await db.query("select status from hospital_bookings where id=$1", [
        booked.booking_id,
      ])
    ).rows[0].status,
    "BOOKED",
  );
  await as(2, () =>
    rpc("set_hospital_clinic_shift", [service15, 1, "MORNING"]),
  );
  await as(5, () =>
    rpc("save_hospital_department", [dept15, org, "Kardiologija", 15, false]),
  );
  assert.deepEqual(await available(service15), []);
  await as(5, () =>
    rpc("save_hospital_department", [dept15, org, "Kardiologija", 15, true]),
  );
});
await test("email confirmation status is honest when sender configuration or patient consent is absent", async () => {
  assert.equal(
    await as(1, () =>
      rpc("hospital_booking_email_status", [booked.booking_id]),
    ),
    "UNAVAILABLE",
  );
  await as(4, () =>
    assert.rejects(rpc("hospital_booking_email_status", [booked.booking_id])),
  );
  await as(5, () =>
    assert.rejects(rpc("hospital_booking_email_status", [booked.booking_id])),
  );
  const unlinked = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Bez",
        last_name: "Računa",
        birth_date: "1990-01-01",
        sex: "UNKNOWN",
      },
      doc,
    ]),
  );
  const withoutAccount = await book(
    await stamp(monday, "10:30"),
    159,
    null,
    unlinked,
  );
  assert.equal(
    await as(1, () =>
      rpc("hospital_booking_email_status", [withoutAccount.booking_id]),
    ),
    "UNAVAILABLE",
  );
  await as(4, () =>
    assert.rejects(
      rpc("hospital_booking_email_status", [withoutAccount.booking_id]),
    ),
  );
});
await test("configured email confirmation contains schedule details and cancellation invalidates queued confirmation", async () => {
  await db.exec("set role service_role");
  await rpc("configure_notification_delivery", [true]);
  await db.exec("reset role");
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    id(3),
  ]);
  await as(3, () => rpc("save_notification_preferences", [true, true]));
  const confirmation = await book(await stamp(monday, "10:00"), 160);
  assert.equal(
    await as(1, () =>
      rpc("hospital_booking_email_status", [confirmation.booking_id]),
    ),
    "PENDING",
  );
  await db.exec("set role service_role");
  const jobs = await rpc("claim_notification_emails", [20]);
  await db.exec("reset role");
  const job = jobs.find((j) => j.confirmation);
  assert.ok(job);
  assert.equal(job.confirmation.department, "Kardiologija");
  assert.equal(job.confirmation.specialist, "dr. Drugi");
  assert.deepEqual(
    Object.keys(job.confirmation).sort(),
    [
      "eventType",
      "bookingReference",
      "patientName",
      "kind",
      "priority",
      "portalPath",
      "startsAt",
      "durationMinutes",
      "hospital",
      "department",
      "specialist",
      "location",
    ].sort(),
  );
  await as(1, () =>
    rpc("change_hospital_booking", [
      confirmation.booking_id,
      1,
      "CANCELLED",
      "Izmišljeno otkazivanje",
    ]),
  );
  await db.exec("set role service_role");
  const remaining = await rpc("claim_notification_emails", [20]);
  await db.exec("reset role");
  assert.ok(remaining.some((j) => j.confirmation?.eventType === "CANCELLED"));
  assert.ok(
    remaining.every(
      (j) => !j.confirmation || j.confirmation.eventType === "CANCELLED",
    ),
  );
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
await test("validation and direct table access cannot bypass the clinical APIs", async () => {
  for (const args of [
    [patient, service15, null, monday],
    [patient, service15, monday, shift(monday, 32)],
    [patient, service15, monday, shift(monday, -1)],
  ])
    await as(1, () => assert.rejects(rpc("priority_hospital_slots", args)));
  for (const table of ["hospital_departments", "hospital_clinic_shifts"])
    for (const n of [0, 1, 3, 5])
      await as(n, () =>
        assert.rejects(db.query("select * from public." + table)),
      );
});
console.log(`${passed} priority hospital checks passed.`);
await db.close();

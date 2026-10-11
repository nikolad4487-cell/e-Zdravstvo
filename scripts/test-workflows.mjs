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
const day = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
const appointment = (pid, did, time, request) =>
  rpc("save_appointment", [
    null,
    null,
    {
      patient_id: pid,
      doctor_id: did,
      local_time: day + "T" + time,
      duration_minutes: 30,
      kind: "Izmišljeni test",
    },
    id(request),
  ]);
const service = await as(5, () =>
  rpc("save_hospital_service", [
    null,
    {
      institution_id: org,
      doctor_id: otherDoc,
      name: "Izmišljeni pregled",
      specialty: "Test",
      location: "Testna ambulanta",
    },
  ]),
);
await as(5, () =>
  rpc("publish_hospital_slots", [service, day + "T09:00", 30, 6, false]),
);
const slots = await as(1, () =>
  rpc("list_hospital_slots", [service, day, day, false]),
);
const book = (pid, slot, request) =>
  rpc("book_hospital_slot", [pid, slot, null, false, "", id(request)]);
let clinic, hospital;
await test("hospital booking rejects a conflicting clinic appointment for the patient", async () => {
  clinic = await as(1, () => appointment(patient, doc, "09:00", 100));
  await as(1, () =>
    assert.rejects(book(patient, slots[0].id, 101), (e) => e.code === "23P01"),
  );
  assert.equal(
    (await db.query("select count(*)::int n from hospital_bookings")).rows[0].n,
    0,
  );
});
await test("clinic appointment rejects a hospital booking for the same patient", async () => {
  hospital = await as(1, () => book(patient, slots[2].id, 102));
  await as(1, () =>
    assert.rejects(
      appointment(patient, doc, "10:00", 103),
      (e) => e.code === "23P01",
    ),
  );
});
await test("doctor conflicts are checked across portals for different patients", async () => {
  await as(2, () =>
    assert.rejects(
      appointment(secondPatient, otherDoc, "10:00", 104),
      (e) => e.code === "23P01",
    ),
  );
  await as(2, () => appointment(secondPatient, otherDoc, "11:00", 105));
  await as(1, () =>
    assert.rejects(book(patient, slots[4].id, 106), (e) => e.code === "23P01"),
  );
});
await test("failed hospital reschedule preserves the original booking and version", async () => {
  await as(1, () =>
    assert.rejects(
      rpc("reschedule_hospital_booking", [
        hospital,
        slots[0].id,
        1,
        "Dogovoreni test",
        id(107),
      ]),
      (e) => e.code === "23P01",
    ),
  );
  const result = (
    await db.query(
      "select slot_id,version from hospital_bookings where id=$1",
      [hospital],
    )
  ).rows[0];
  assert.equal(result.slot_id, slots[2].id);
  assert.equal(result.version, 1);
});
await test("adjacent appointments are permitted and cancelled appointments release capacity", async () => {
  await as(1, () => appointment(patient, doc, "10:30", 108));
  await as(1, () =>
    rpc("set_appointment_status", [
      clinic,
      1,
      "CANCELLED",
      "Testno otkazivanje",
    ]),
  );
  await as(1, () => book(patient, slots[0].id, 109));
});
await test("new search endpoints deny anonymous users and reject invalid pagination", async () => {
  await as(0, () => assert.rejects(rpc("search_patients_page", ["", 0])));
  await as(0, () => assert.rejects(rpc("search_documents", [])));
  await as(1, () => assert.rejects(rpc("search_patients_page", ["", -1])));
  await as(1, () =>
    assert.rejects(
      rpc("search_documents", [null, null, "", null, null, null, -1, null]),
    ),
  );
});
await test("patient pagination reaches records beyond the first page without duplicates", async () => {
  for (let n = 0; n < 52; n++)
    await as(1, () =>
      rpc("create_patient", [
        {
          first_name: "Paginacija",
          last_name: "Test " + String(n).padStart(2, "0"),
          birth_date: "2000-01-01",
          sex: "UNKNOWN",
        },
        doc,
      ]),
    );
  const first = await as(1, () =>
    rpc("search_patients_page", ["Paginacija", 0]),
  );
  const second = await as(1, () =>
    rpc("search_patients_page", ["Paginacija", 1]),
  );
  assert.equal(first.length, 50);
  assert.equal(second.length, 2);
  assert.equal(new Set([...first, ...second].map((p) => p.id)).size, 52);
  assert.equal(
    (await as(3, () => rpc("search_patients_page", ["Paginacija", 0]))).length,
    0,
  );
});
const expires = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
let oldest, number;
await test("document search reaches an older record beyond the previous 100-document limit", async () => {
  for (let n = 0; n < 105; n++) {
    const did = await as(1, () =>
      rpc("issue_document", [
        patient,
        "REFERRAL",
        {
          expires_on: expires,
          referral_type: "SPECIALIST",
          specialty: "Testna specijalnost",
          reason: "Izmišljeni test",
          priority: "REGULAR",
          notes: "",
        },
        id(1000 + n),
      ]),
    );
    if (n === 0) oldest = did;
  }
  number = (await as(1, () => rpc("get_document", [oldest, "VIEW"]))).number;
  const result = await as(1, () =>
    rpc("search_documents", [null, null, number, null, null, null, 0, null]),
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].id, oldest);
  const pages = [];
  for (let page = 0; page < 3; page++)
    pages.push(
      ...(await as(3, () =>
        rpc("search_documents", [
          null,
          "REFERRAL",
          "",
          null,
          null,
          null,
          page,
          null,
        ]),
      )),
    );
  assert.equal(pages.length, 105);
  assert.equal(new Set(pages.map((d) => d.id)).size, 105);
});
await test("document filters preserve isolation and reflect revocation immediately", async () => {
  assert.deepEqual(
    await as(4, () =>
      rpc("search_documents", [null, null, number, null, null, null, 0, null]),
    ),
    [],
  );
  await as(4, () =>
    assert.rejects(
      rpc("search_documents", [patient, null, "", null, null, null, 0, null]),
    ),
  );
  await as(1, () =>
    rpc("revoke_document", [oldest, "Izmišljeni test opoziva"]),
  );
  assert.equal(
    (
      await as(3, () =>
        rpc("search_documents", [
          null,
          "REFERRAL",
          number,
          "CANCELLED",
          null,
          null,
          0,
          org,
        ]),
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await as(3, () =>
        rpc("search_documents", [
          null,
          null,
          number,
          "ISSUED",
          null,
          null,
          0,
          null,
        ]),
      )
    ).length,
    0,
  );
  await as(1, () =>
    assert.rejects(
      rpc("search_documents", [
        null,
        null,
        "",
        null,
        "2026-02-01",
        "2026-01-01",
        0,
        null,
      ]),
    ),
  );
});
await test("staff schedule is scoped to the doctor or administrator", async () => {
  assert.equal((await as(1, () => rpc("doctor_schedule", []))).length, 1);
  assert.equal((await as(5, () => rpc("doctor_schedule", []))).length, 2);
  for (const n of [0, 3, 4, 6])
    await as(n, () => assert.rejects(rpc("doctor_schedule", [])));
  await as(2, () =>
    assert.rejects(rpc("set_doctor_hours", [doc, 1, "08:00", "16:00", true])),
  );
});
const weekday = new Date(day + "T12:00:00Z").getUTCDay() || 7;
await test("working hours reject out-of-hours appointments and permit full-duration coverage", async () => {
  await as(1, () =>
    rpc("set_doctor_hours", [doc, weekday, "08:00", "16:00", true]),
  );
  await as(1, () =>
    assert.rejects(
      appointment(patient, doc, "15:45", 210),
      (e) => e.code === "23P01",
    ),
  );
  await as(1, () => appointment(patient, doc, "15:00", 211));
  await as(1, () =>
    rpc("set_doctor_hours", [doc, weekday, "08:00", "16:00", false]),
  );
});
let absence;
await test("absence preserves existing bookings and blocks new clinic and hospital bookings", async () => {
  await as(2, () =>
    assert.rejects(
      rpc("record_doctor_absence", [
        otherDoc,
        day + "T10:00",
        day + "T10:30",
        null,
        "Planirana odsutnost",
      ]),
      (e) => e.code === "23P01",
    ),
  );
  absence = await as(5, () =>
    rpc("record_doctor_absence", [
      otherDoc,
      day + "T12:00",
      day + "T14:00",
      doc,
      "Planirana odsutnost",
    ]),
  );
  await as(2, () =>
    assert.rejects(
      appointment(secondPatient, otherDoc, "12:00", 212),
      (e) => e.code === "23P01",
    ),
  );
  await as(5, () =>
    rpc("publish_hospital_slots", [service, day + "T12:00", 30, 1, false]),
  );
  const available = await as(1, () =>
    rpc("list_hospital_slots", [service, day, day, false]),
  );
  const slot = available.find(
    (s) =>
      new Date(s.starts_at).getTime() > new Date(slots[5].starts_at).getTime(),
  );
  await as(1, () =>
    assert.rejects(book(patient, slot.id, 213), (e) => e.code === "23P01"),
  );
  assert.equal(
    (
      await db.query(
        "select (starts_at at time zone 'Europe/Zagreb')::text time from doctor_absences where id=$1",
        [absence],
      )
    ).rows[0].time,
    day + " 12:00:00",
  );
  await as(1, () => assert.rejects(rpc("cancel_doctor_absence", [absence])));
  await as(2, () => rpc("cancel_doctor_absence", [absence]));
  await as(2, () => appointment(secondPatient, otherDoc, "12:00", 214));
});
await test("message read receipts remove unread task counts without exposing another patient", async () => {
  await as(1, () => rpc("set_messaging_enabled", [doc, true]));
  await as(3, () =>
    rpc("send_patient_message", [
      patient,
      doc,
      "Izmišljena testna poruka",
      id(220),
    ]),
  );
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).unread_messages,
    1,
  );
  const messages = await as(1, () =>
    rpc("read_messages", [patient, doc, null]),
  );
  await as(4, () =>
    assert.rejects(
      rpc("mark_thread_read", [patient, doc, messages.at(-1).created_at]),
    ),
  );
  await as(1, () =>
    rpc("mark_thread_read", [patient, doc, messages.at(-1).created_at]),
  );
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).unread_messages,
    0,
  );
  for (const n of [0, 3, 5, 6])
    await as(n, () => assert.rejects(rpc("doctor_task_overview", [])));
});
await db.query(
  "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
  [id(6), org],
);
const lab = await as(1, () =>
  rpc("order_laboratory", [
    patient,
    {
      laboratory_institution_id: org,
      requested_tests: "Testni parametar",
      clinical_question: "",
      priority: "REGULAR",
    },
    id(230),
  ]),
);
await as(6, () => rpc("set_lab_order_status", [lab, 1, "IN_PROGRESS", ""]));
const criticalData = {
  sampled_at: new Date().toISOString(),
  summary: "Izmišljeni nalaz",
  parameters: [
    {
      code: "TST",
      name: "Testni parametar",
      value: 1,
      unit: "test",
      critical: true,
    },
  ],
};
const result = await as(6, () =>
  rpc("publish_laboratory_result", [lab, null, criticalData]),
);
await test("critical-result acknowledgement is clinician-only and immutable", async () => {
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).critical_results,
    1,
  );
  for (const n of [0, 2, 3, 5, 6])
    await as(n, () =>
      assert.rejects(rpc("acknowledge_laboratory_result", [result])),
    );
  await as(1, () => rpc("acknowledge_laboratory_result", [result]));
  await as(1, () => rpc("acknowledge_laboratory_result", [result]));
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).critical_results,
    0,
  );
  assert.equal(
    (await as(3, () => rpc("laboratory_acknowledgement", [result]))).name,
    "dr. Test",
  );
  await as(4, () =>
    assert.rejects(rpc("laboratory_acknowledgement", [result])),
  );
  await assert.rejects(
    db.query("delete from laboratory_acknowledgements where result_id=$1", [
      result,
    ]),
  );
  const correction = await as(6, () =>
    rpc("publish_laboratory_result", [
      lab,
      result,
      { ...criticalData, correction_reason: "Ispravak testnog nalaza" },
    ]),
  );
  assert.notEqual(correction, result);
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).critical_results,
    1,
  );
});
let request;
await test("patient appointment requests are scoped, idempotent and do not reserve a slot", async () => {
  const before = (await db.query("select count(*)::int n from appointments"))
    .rows[0].n;
  const args = [doc, day, "ANY", "Testna napomena", id(240)];
  request = await as(3, () => rpc("request_clinic_appointment", args));
  assert.equal(
    await as(3, () => rpc("request_clinic_appointment", args)),
    request,
  );
  await as(3, () =>
    assert.rejects(
      rpc("request_clinic_appointment", [doc, day, "MORNING", "", id(241)]),
    ),
  );
  await as(3, () =>
    assert.rejects(
      rpc("request_clinic_appointment", [otherDoc, day, "ANY", "", id(242)]),
    ),
  );
  assert.equal(
    (await as(4, () => rpc("clinic_appointment_requests", [true, 0]))).length,
    0,
  );
  assert.equal(
    (await db.query("select count(*)::int n from appointments")).rows[0].n,
    before,
  );
  assert.equal(
    (await as(1, () => rpc("doctor_task_overview", []))).clinic_requests,
    1,
  );
});
await test("approval is atomic, binds the correct patient and obeys schedule conflicts", async () => {
  for (const n of [0, 2, 3, 4, 5, 6])
    await as(n, () =>
      assert.rejects(
        rpc("resolve_clinic_request", [
          request,
          1,
          true,
          "Testni odgovor",
          { local_time: day + "T14:00", duration_minutes: 30, kind: "Test" },
        ]),
      ),
    );
  await as(1, () =>
    assert.rejects(
      rpc("resolve_clinic_request", [
        request,
        1,
        true,
        "Testni odgovor",
        { local_time: day + "T10:00", duration_minutes: 30, kind: "Test" },
      ]),
      (e) => e.code === "23P01",
    ),
  );
  assert.equal(
    (await as(3, () => rpc("clinic_appointment_requests", [true, 0])))[0]
      .status,
    "PENDING",
  );
  const aid = await as(1, () =>
    rpc("resolve_clinic_request", [
      request,
      1,
      true,
      "Dogovoreni termin",
      {
        local_time: day + "T14:00",
        duration_minutes: 30,
        kind: "Test",
        patient_id: secondPatient,
        doctor_id: otherDoc,
      },
    ]),
  );
  const a = (
    await db.query(
      "select patient_id,doctor_id from appointments where id=$1",
      [aid],
    )
  ).rows[0];
  assert.equal(a.patient_id, patient);
  assert.equal(a.doctor_id, doc);
  await as(1, () =>
    assert.rejects(
      rpc("resolve_clinic_request", [
        request,
        1,
        false,
        "Ponovljeni odgovor",
        null,
      ]),
      (e) => e.code === "40001",
    ),
  );
  assert.equal(
    (await as(3, () => rpc("clinic_appointment_requests", [true, 0])))[0]
      .status,
    "APPROVED",
  );
});
async function serviceRole(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
await test("email preferences are opt-in and delivery configuration is service-only", async () => {
  assert.deepEqual(await as(3, () => rpc("notification_preferences", [])), {
    email_enabled: false,
    appointment_reminders: true,
    email_available: false,
  });
  await as(3, () =>
    assert.rejects(rpc("save_notification_preferences", [true, true])),
  );
  for (const n of [0, 1, 3, 5, 6])
    await as(n, () =>
      assert.rejects(rpc("configure_notification_delivery", [true])),
    );
  await serviceRole(() => rpc("configure_notification_delivery", [true]));
  await as(3, () => rpc("save_notification_preferences", [true, true]));
  assert.equal(
    (await as(4, () => rpc("notification_preferences", []))).email_enabled,
    false,
  );
});
await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
  id(3),
]);
await db.query(
  "insert into notifications(user_id,message) values($1,'Izmišljena privatna poruka')",
  [id(3)],
);
let job;
await test("email jobs use leases, respect permissions and reject stale completion", async () => {
  for (const n of [0, 1, 3, 5])
    await as(n, () => assert.rejects(rpc("claim_notification_emails", [20])));
  const jobs = await serviceRole(() => rpc("claim_notification_emails", [20]));
  assert.equal(jobs.length, 1);
  job = jobs[0];
  assert.equal(job.email, "fictional3@example.test");
  assert.equal("message" in job, false);
  assert.deepEqual(
    await serviceRole(() => rpc("claim_notification_emails", [20])),
    [],
  );
  await serviceRole(() =>
    rpc("complete_notification_email", [
      job.id,
      id(999),
      true,
      "provider-test",
      60,
    ]),
  );
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "SENDING",
  );
  await serviceRole(() =>
    rpc("complete_notification_email", [
      job.id,
      job.lease_id,
      true,
      "provider-test",
      60,
    ]),
  );
  assert.equal(
    (
      await db.query(
        "select status from private.notification_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "SENT",
  );
});
await test("opting out cancels queued emails before delivery", async () => {
  await db.query(
    "insert into notifications(user_id,message) values($1,'Izmišljeni drugi događaj')",
    [id(3)],
  );
  await as(3, () => rpc("save_notification_preferences", [false, true]));
  assert.deepEqual(
    await serviceRole(() => rpc("claim_notification_emails", [20])),
    [],
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_outbox where status='CANCELLED'",
      )
    ).rows[0].n,
    1,
  );
});
await test("appointment reminders are idempotent and honor the patient preference", async () => {
  const future = new Date(Date.now() + 12 * 3600000);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/Zagreb",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(future)
      .map((p) => [p.type, p.value]),
  );
  const local = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  await as(2, () =>
    rpc("save_appointment", [
      null,
      null,
      {
        patient_id: secondPatient,
        doctor_id: otherDoc,
        local_time: local,
        duration_minutes: 30,
        kind: "Izmišljeni podsjetnik",
      },
      id(250),
    ]),
  );
  await as(4, () => rpc("save_notification_preferences", [false, false]));
  assert.equal(
    await serviceRole(() => rpc("generate_appointment_reminders", [])),
    0,
  );
  await as(4, () => rpc("save_notification_preferences", [false, true]));
  assert.equal(
    await serviceRole(() => rpc("generate_appointment_reminders", [])),
    1,
  );
  assert.equal(
    await serviceRole(() => rpc("generate_appointment_reminders", [])),
    0,
  );
});

await test("laboratory trends exclude superseded results and enforce patient scope", async () => {
  const catalog = await as(3, () => rpc("laboratory_trend_catalog", [null]));
  assert.equal(catalog.filter((p) => p.code === "TST").length, 1);
  const points = await as(3, () =>
    rpc("laboratory_trend_points", [
      null,
      "TST",
      "test",
      "2000-01-01",
      "2099-01-01",
      0,
    ]),
  );
  assert.equal(points.length, 1);
  assert.notEqual(points[0].result_id, result);
  assert.equal(
    (
      await as(3, () =>
        rpc("laboratory_trend_points", [
          null,
          "TST",
          "different",
          "2000-01-01",
          "2099-01-01",
          0,
        ]),
      )
    ).length,
    0,
  );
  await as(4, () => assert.rejects(rpc("laboratory_trend_catalog", [patient])));
  await as(3, () =>
    assert.rejects(
      rpc("laboratory_trend_points", [
        null,
        "TST",
        "test",
        "2099-01-01",
        "2000-01-01",
        0,
      ]),
    ),
  );
});
let child, guardian;
await test("guardian access requires verified admin assignment and expires before adulthood", async () => {
  child = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Testno",
        last_name: "Dijete",
        birth_date: "2015-01-01",
        sex: "UNKNOWN",
      },
      doc,
    ]),
  );
  for (const n of [0, 1, 3, 4, 6])
    await as(n, () =>
      assert.rejects(
        rpc("grant_guardian_access", [
          child,
          id(4),
          "PARENT",
          "TEST-VERIFICATION",
          "2030-12-31",
        ]),
      ),
    );
  await as(5, () =>
    assert.rejects(
      rpc("grant_guardian_access", [
        child,
        id(4),
        "PARENT",
        "TEST-VERIFICATION",
        "2035-01-01",
      ]),
    ),
  );
  await as(5, () =>
    assert.rejects(
      rpc("grant_guardian_access", [
        patient,
        id(4),
        "PARENT",
        "TEST-VERIFICATION",
        "2027-01-01",
      ]),
    ),
  );
  await as(4, () => assert.rejects(rpc("get_patient_chart", [child])));
  await as(5, () =>
    rpc("grant_guardian_access", [
      child,
      id(4),
      "PARENT",
      "TEST-VERIFICATION",
      "2030-12-31",
    ]),
  );
  guardian = (await as(5, () => rpc("admin_patient_guardians", [child])))[0].id;
  assert.equal(
    (await as(4, () => rpc("my_guardian_patients", [0])))[0].id,
    child,
  );
  assert.equal((await as(3, () => rpc("my_guardian_patients", [0]))).length, 0);
  assert.equal(
    (await as(4, () => rpc("guardian_patient_record", [child]))).can_write,
    false,
  );
  await as(4, () =>
    assert.rejects(rpc("update_patient_record", [child, "A+", "Unauthorized"])),
  );
  await as(5, () => assert.rejects(rpc("get_patient_chart", [child])));
});
await test("revoking guardian access immediately removes chart and export access", async () => {
  assert.equal(
    (await as(4, () => rpc("export_patient_record", [child]))).patient.id,
    child,
  );
  await as(5, () =>
    rpc("revoke_guardian_access", [guardian, "Testni opoziv ovlasti"]),
  );
  assert.equal((await as(4, () => rpc("my_guardian_patients", [0]))).length, 0);
  await as(4, () => assert.rejects(rpc("guardian_patient_record", [child])));
  await as(4, () => assert.rejects(rpc("export_patient_record", [child])));
  await as(5, () => assert.rejects(rpc("export_patient_record", [patient])));
});
await db.query(
  "insert into user_roles(user_id,role,institution_id) values($1,'PHARMACIST',$2)",
  [id(6), org],
);
await db.query(
  "insert into medications(id,name,active_ingredient,strength,form,packaging,route) values($1,'Izmišljeni testni lijek','Test','Test','Test','Test','Test')",
  [id(269)],
);
const rx = {
  expires_on: day,
  items: [
    {
      medication_id: id(269),
      dosage: "Test",
      quantity: 4,
      route: "Test",
      duration: "Test",
      notes: "",
    },
  ],
  notes: "",
};
const prescription = await as(1, () =>
  rpc("issue_document", [patient, "PRESCRIPTION", rx, id(270)]),
);
const pdoc = await as(3, () => rpc("get_document", [prescription, "VIEW"]));
const dispense = (items, request) =>
  rpc("dispense_prescription_items", [
    prescription,
    pdoc.payload.patient.patient_number,
    org,
    items,
    id(request),
  ]);
let event;
await test("partial dispensing enforces exact patient, role, quantities and idempotent requests", async () => {
  for (const n of [0, 1, 3, 4, 5])
    await as(n, () =>
      assert.rejects(dispense([{ index: 0, quantity: 1 }], 271)),
    );
  await as(6, () =>
    assert.rejects(
      rpc("dispense_prescription_items", [
        prescription,
        "WRONG",
        org,
        [{ index: 0, quantity: 1 }],
        id(271),
      ]),
    ),
  );
  await as(6, () => assert.rejects(dispense([{ index: 0, quantity: 5 }], 271)));
  await as(6, () =>
    assert.rejects(
      dispense(
        [
          { index: 0, quantity: 1 },
          { index: 0, quantity: 1 },
        ],
        271,
      ),
    ),
  );
  event = await as(6, () => dispense([{ index: 0, quantity: 1 }], 271));
  assert.equal(
    await as(6, () => dispense([{ index: 0, quantity: 1 }], 271)),
    event,
  );
  await as(6, () => assert.rejects(dispense([{ index: 0, quantity: 2 }], 271)));
  const result = await as(6, () =>
    rpc("pharmacy_lookup", [pdoc.number, pdoc.payload.patient.patient_number]),
  );
  assert.equal(result.status, "ISSUED");
  assert.equal(result.items[0].remaining, 3);
  assert.equal(result.dispensing_events.length, 1);
});
await test("final dispensing closes the prescription without exceeding quantity and is immutable", async () => {
  await as(6, () => assert.rejects(dispense([{ index: 0, quantity: 4 }], 272)));
  await as(6, () =>
    rpc("dispense_prescription", [
      prescription,
      pdoc.payload.patient.patient_number,
      org,
    ]),
  );
  const rows = await as(3, () =>
    rpc("search_my_medications", [false, 0, "Izmišljeni testni lijek"]),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "DISPENSED");
  assert.equal(rows[0].items[0].dispensed, 4);
  assert.equal(rows[0].items[0].remaining, 0);
  assert.equal(rows[0].dispensing_events.length, 2);
  assert.equal(
    await as(6, () => dispense([{ index: 0, quantity: 1 }], 271)),
    event,
  );
  await as(6, () => assert.rejects(dispense([{ index: 0, quantity: 1 }], 273)));
  await assert.rejects(
    db.query("delete from prescription_dispensing_events where id=$1", [event]),
  );
  assert.equal(
    (
      await as(4, () =>
        rpc("search_my_medications", [false, 0, "Izmišljeni testni lijek"]),
      )
    ).length,
    0,
  );
});
await test("expired and adult guardian assignments deny reads without relying on UI", async () => {
  await as(5, () =>
    rpc("grant_guardian_access", [
      child,
      id(4),
      "PARENT",
      "TEST-VERIFICATION",
      "2030-12-31",
    ]),
  );
  await db.query(
    "update patient_guardians set expires_at=now()-interval '1 second' where id=$1",
    [guardian],
  );
  await as(4, () => assert.rejects(rpc("get_patient_chart", [child])));
  await as(5, () =>
    rpc("grant_guardian_access", [
      child,
      id(4),
      "PARENT",
      "TEST-VERIFICATION",
      "2030-12-31",
    ]),
  );
  await db.query("update patients set birth_date='2000-01-01' where id=$1", [
    child,
  ]);
  await as(4, () => assert.rejects(rpc("get_patient_chart", [child])));
  assert.equal((await as(4, () => rpc("my_guardian_patients", [0]))).length, 0);
});
await test("new sensitive tables are inaccessible directly to browser and anonymous roles", async () => {
  for (const table of [
    "doctor_working_hours",
    "doctor_absences",
    "message_reads",
    "laboratory_acknowledgements",
    "notification_preferences",
    "clinic_appointment_requests",
    "patient_guardians",
    "prescription_dispensing_events",
  ]) {
    for (const n of [0, 1, 3, 5])
      await as(n, () =>
        assert.rejects(
          db.query("select * from public." + table),
          (e) => e.code === "42501",
        ),
      );
  }
});
await test("public readiness exposes only the schema version without clinical access", async () => {
  assert.equal(await as(0, () => rpc("application_schema_version")), 20261007);
  await as(0, () => assert.rejects(rpc("get_patient_chart", [patient])));
});
const attachments = [];
await test("attachment search reaches old files beyond 100 and paginates equal timestamps", async () => {
  for (let n = 0; n < 105; n++) {
    if (n === 1) await db.exec("begin");
    const aid = await as(3, () =>
      rpc("reserve_attachment", [
        patient,
        {
          title:
            n === 0 ? "Povijesni jedinstveni nalaz" : "Testni dokument " + n,
          category: n === 0 ? "RADIOLOGY" : "REPORT",
          file_name: "test-" + n + ".pdf",
          content_type: "application/pdf",
          byte_size: 8,
          sha256: "a".repeat(64),
        },
        id(1000 + n),
      ]),
    );
    attachments.push(aid);
    await db.query(
      "insert into storage.objects(bucket_id,name,metadata) values('medical-documents',$1,$2)",
      ["uploads/" + aid, { size: 8, mimetype: "application/pdf" }],
    );
    await as(3, () => rpc("finish_attachment", [aid]));
  }
  await db.exec("commit");
  const args = [patient, false, "", null, null, null];
  const pages = [];
  for (let n = 0; n < 3; n++)
    pages.push(...(await as(3, () => rpc("search_attachments", [...args, n]))));
  assert.equal(pages.length, 105);
  assert.equal(pages.at(-1).id, attachments[0]);
  assert.equal(new Set(pages.slice(0, 104).map((a) => a.created_at)).size, 1);
  assert.equal(new Set(pages.map((a) => a.id)).size, 105);
  const oldest = await as(3, () =>
    rpc("search_attachments", [
      patient,
      false,
      "Povijesni jedinstveni",
      null,
      null,
      null,
      0,
    ]),
  );
  assert.equal(oldest[0].id, attachments[0]);
  assert.equal(oldest.length, 1);
  assert.equal(
    (
      await as(1, () =>
        rpc("search_attachments", [
          patient,
          false,
          "",
          "RADIOLOGY",
          null,
          null,
          0,
        ]),
      )
    ).length,
    1,
  );
});
await test("attachment filters enforce scope, archival visibility and valid bounds", async () => {
  for (const n of [0, 2, 4, 5, 6])
    await as(n, () =>
      assert.rejects(
        rpc("search_attachments", [patient, false, "", null, null, null, 0]),
      ),
    );
  await as(3, () =>
    rpc("archive_attachment", [attachments[0], "Testno arhiviranje"]),
  );
  assert.equal(
    (
      await as(3, () =>
        rpc("search_attachments", [
          patient,
          false,
          "Povijesni",
          null,
          null,
          null,
          0,
        ]),
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await as(3, () =>
        rpc("search_attachments", [
          patient,
          true,
          "Povijesni",
          null,
          null,
          null,
          0,
        ]),
      )
    )[0].status,
    "ARCHIVED",
  );
  for (const args of [
    [patient, false, "", null, null, null, -1],
    [patient, false, "", "INVALID", null, null, 0],
    [patient, false, "", null, "2026-10-07", "2026-10-01", 0],
  ])
    await as(3, () => assert.rejects(rpc("search_attachments", args)));
});
console.log(`${passed} new workflow checks passed.`);
await db.close();

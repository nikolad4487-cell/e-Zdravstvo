import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, doc, patient, otherDoc } =
  await workflowFixture();
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
try {
  const today = (
    await db.query("select (now() at time zone 'Europe/Zagreb')::date::text d")
  ).rows[0].d;
  const list = (closed = false, search = "", page = 0) =>
    as(1, () => rpc("care_pathways", [null, search, null, closed, page]));
  const data = {
    report_type: "SPECIALIST",
    reported_on: today,
    content: "Izmišljeni specijalistički nalaz",
    recommendations: "Kontrola prema liječniku.",
  };
  const report = await as(1, () =>
    rpc("publish_medical_report", [patient, null, null, data, id(12001)]),
  );
  await check(
    "care pathway and mutation endpoints reject anonymous, patient, nurse and administrator roles",
    async () => {
      for (const n of [0, 3, 4, 5, 6]) {
        await assert.rejects(
          as(n, () => rpc("care_pathways")),
          /Forbidden|permission denied/,
        );
        await assert.rejects(
          as(n, () => rpc("review_care_result", ["MEDICAL_REPORT", report])),
          /Forbidden|permission denied/,
        );
      }
    },
  );
  await check(
    "unreviewed report is visible only to an active treating doctor",
    async () => {
      const entries = await list();
      assert.ok(
        entries.items.some(
          (r) => r.result_id === report && r.stage === "NEEDS_REVIEW",
        ),
      );
      assert.equal(
        (await as(2, () => rpc("care_pathways"))).items.some(
          (r) => r.patient_id === patient,
        ),
        false,
      );
      await assert.rejects(
        as(2, () => rpc("care_pathways", [patient])),
        /Forbidden/,
      );
    },
  );
  let review;
  await check(
    "review is explicit, idempotent and removes only the reviewed version from open work",
    async () => {
      review = await as(1, () =>
        rpc("review_care_result", ["MEDICAL_REPORT", report]),
      );
      assert.equal(
        await as(1, () =>
          rpc("review_care_result", ["MEDICAL_REPORT", report]),
        ),
        review,
      );
      assert.ok(!(await list()).items.some((r) => r.result_id === report));
      assert.ok(
        (await list(true)).items.some(
          (r) => r.result_id === report && r.stage === "REVIEWED",
        ),
      );
      const correction = await as(1, () =>
        rpc("publish_medical_report", [
          patient,
          null,
          report,
          { ...data, correction_reason: "Ispravak izmišljenog nalaza" },
          id(12002),
        ]),
      );
      assert.ok(
        (await list()).items.some(
          (r) => r.result_id === correction && r.stage === "NEEDS_REVIEW",
        ),
      );
      await assert.rejects(
        as(1, () => rpc("review_care_result", ["MEDICAL_REPORT", report])),
        /Forbidden/,
      );
    },
  );
  await check(
    "follow-up source is bound to the same patient and retained in the pathway",
    async () => {
      const sourceFollowup = await as(1, () =>
        rpc("create_care_followup", [
          patient,
          today,
          "Kontrola s izvorom",
          id(12005),
          "MEDICAL_REPORT",
          report,
        ]),
      );
      const sourceRow = (await list()).items.find(
        (r) => r.source_id === sourceFollowup,
      );
      assert.deepEqual(sourceRow.origin, {
        kind: "MEDICAL_REPORT",
        id: report,
      });
      await assert.rejects(
        as(1, () =>
          rpc("create_care_followup", [
            patient,
            today,
            "Nedostupan izvor",
            id(12006),
            "MEDICAL_REPORT",
            id(99999),
          ]),
        ),
        /Forbidden/,
      );
    },
  );
  let followup;
  await check(
    "follow-up creation validates dates and retry input",
    async () => {
      followup = await as(1, () =>
        rpc("create_care_followup", [
          patient,
          today,
          "Provjeriti izmišljeni nalaz",
          id(12003),
        ]),
      );
      assert.equal(
        await as(1, () =>
          rpc("create_care_followup", [
            patient,
            today,
            "Provjeriti izmišljeni nalaz",
            id(12003),
          ]),
        ),
        followup,
      );
      await assert.rejects(
        as(1, () =>
          rpc("create_care_followup", [
            patient,
            today,
            "Promijenjeni sadržaj",
            id(12003),
          ]),
        ),
        /Request changed/,
      );
      await assert.rejects(
        as(1, () =>
          rpc("create_care_followup", [
            patient,
            "1999-01-01",
            "Stari datum",
            id(12004),
          ]),
        ),
        /Invalid follow-up/,
      );
      assert.ok(
        (await list()).items.some(
          (r) => r.source_id === followup && r.stage === "FOLLOWUP_DUE",
        ),
      );
    },
  );
  await check(
    "follow-up completion enforces author scope, version and a reason",
    async () => {
      await assert.rejects(
        as(2, () =>
          rpc("resolve_care_followup", [followup, 1, "DONE", "Testni razlog"]),
        ),
        /Forbidden/,
      );
      await assert.rejects(
        as(1, () =>
          rpc("resolve_care_followup", [followup, 2, "DONE", "Testni razlog"]),
        ),
        /changed/,
      );
      await assert.rejects(
        as(1, () => rpc("resolve_care_followup", [followup, 1, "DONE", ""])),
        /Invalid/,
      );
      await as(1, () =>
        rpc("resolve_care_followup", [
          followup,
          1,
          "DONE",
          "Pregledan testni nalaz",
        ]),
      );
      assert.ok(!(await list()).items.some((r) => r.source_id === followup));
      assert.ok(
        (await list(true)).items.some(
          (r) => r.source_id === followup && r.stage === "CLOSED",
        ),
      );
    },
  );
  await check(
    "filtering and pagination include records beyond the first 50",
    async () => {
      for (let n = 0; n < 52; n++)
        await as(1, () =>
          rpc("create_care_followup", [
            patient,
            today,
            "Straničenje test " + n,
            id(12100 + n),
          ]),
        );
      const first = await list(false, "Straničenje"),
        second = await list(false, "Straničenje", 1);
      assert.equal(first.total, 52);
      assert.equal(first.items.length, 50);
      assert.equal(second.items.length, 2);
      assert.equal(
        new Set([...first.items, ...second.items].map((r) => r.source_id)).size,
        52,
      );
    },
  );
  await db.query(
    "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
    [id(6), org],
  );
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
      "Laboratorij",
      "Laboratorij",
      "Prizemlje",
      "",
      "",
    ]),
  );
  const lab = (
    await as(1, () => rpc("priority_hospital_context", [false]))
  ).services.find((s) => s.id === service);
  const day = (await db.query("select ($1::date+14)::text d", [today])).rows[0]
      .d,
    to = (await db.query("select ($1::date+21)::text d", [today])).rows[0].d;
  const tests = [
    lab.laboratory_tests.find((t) => t.code === "LOCAL-ROUTINE").id,
  ];
  const slot = (
    await as(1, () =>
      rpc("priority_laboratory_slots", [patient, service, tests, day, to]),
    )
  )[0];
  const booking = (
    await as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        slot.starts_at,
        null,
        {
          referral_code: "A3",
          reason: "Izmišljena testna indikacija",
          expires_on: to,
        },
        "Izmišljeni prioritet",
        id(12200),
        tests,
        "VENIPUNCTURE",
      ]),
    )
  ).booking_id;
  await db.query(
    "update hospital_slots set starts_at=($1::date+time '08:00') at time zone 'Europe/Zagreb' where id=(select slot_id from hospital_bookings where id=$2)",
    [today, booking],
  );
  let entry = () => as(6, () => rpc("laboratory_worklist", [today]));
  await as(6, () =>
    rpc("advance_laboratory_workflow", ["BOOKING", booking, 1, "ARRIVED", ""]),
  );
  let order;
  for (const stage of ["COLLECTED", "PROCESSING"]) {
    const row = (await entry()).items.find((r) => r.source_id === booking);
    order = row.order_id;
    await as(6, () =>
      rpc("advance_laboratory_workflow", [
        "BOOKING",
        booking,
        row.version,
        stage,
        "",
      ]),
    );
  }
  await check(
    "issuing a linked lab result closes the appointment and enters clinician review once",
    async () => {
      const version = (
        await db.query("select version from laboratory_orders where id=$1", [
          order,
        ])
      ).rows[0].version;
      const result = await as(6, () =>
        rpc("publish_laboratory_result", [
          order,
          null,
          {
            expected_order_version: version,
            sampled_at: new Date().toISOString(),
            parameters: [
              {
                code: "TEST",
                name: "Test",
                value: "3",
                unit: "",
                critical: true,
              },
            ],
          },
        ]),
      );
      assert.equal(
        (
          await db.query("select status from hospital_bookings where id=$1", [
            booking,
          ])
        ).rows[0].status,
        "COMPLETED",
      );
      const row = (await list(false, "Laboratorij")).items.filter(
        (r) => r.source_id === booking,
      );
      assert.equal(row.length, 1);
      assert.equal(row[0].stage, "NEEDS_REVIEW");
      assert.equal(row[0].result_id, result);
      for (const n of [1, 2]) {
        const extra = await as(2, () =>
          rpc("publish_medical_report", [
            patient,
            booking,
            null,
            data,
            id(12300 + n),
          ]),
        );
        assert.ok(
          (await list(false, "EZ-NAL")).items.some(
            (r) => r.result_id === extra && r.stage === "NEEDS_REVIEW",
          ),
        );
      }
      assert.equal(
        (await list(false, "Laboratorij")).items.filter(
          (r) => r.source_id === booking,
        ).length,
        1,
      );
      await assert.rejects(
        as(1, () => rpc("review_care_result", ["LAB_RESULT", result])),
        /kritičnog nalaza/,
      );
      await as(1, () => rpc("acknowledge_laboratory_result", [result]));
      await as(1, () => rpc("review_care_result", ["LAB_RESULT", result]));
      assert.ok(!(await list()).items.some((r) => r.source_id === booking));
    },
  );
  await check(
    "review records are immutable and revoked care immediately removes access",
    async () => {
      await assert.rejects(
        db.query(
          "update care_result_reviews set reviewed_at=now() where id=$1",
          [review],
        ),
        /immutable/,
      );
      await assert.rejects(
        as(1, () => db.query("select * from care_result_reviews")),
        /permission denied/,
      );
      await db.query(
        "update institution_users set active=false where user_id=$1 and institution_id=$2",
        [id(1), org],
      );
      await assert.rejects(
        as(1, () => rpc("care_pathways", [patient])),
        /Forbidden/,
      );
    },
  );
  console.log(`${checks} care pathway checks passed`);
} finally {
  await db.close();
}

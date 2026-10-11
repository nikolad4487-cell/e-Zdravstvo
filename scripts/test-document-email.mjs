import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, id, org, patient, as, rpc } = await workflowFixture();
let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log("PASS " + name);
}
async function service(fn) {
  await db.exec("set role service_role");
  try {
    return await fn();
  } finally {
    await db.exec("reset role");
  }
}
const claim = () => service(() => rpc("claim_document_emails", [3]));
const finish = (job, ok) =>
  service(() =>
    rpc("complete_document_email", [
      job.id,
      job.lease_id,
      ok,
      ok ? "fictional-provider-id" : null,
      60,
    ]),
  );
const count = async () =>
  (await db.query("select count(*)::int n from private.document_email_outbox"))
    .rows[0].n;
const wakeCount = async () =>
  (await db.query("select count(*)::int n from private.test_document_dispatch"))
    .rows[0].n;
await db.exec(`create schema net;create schema vault;
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 insert into vault.decrypted_secrets values('fixture-token',repeat('x',32));
 create table private.test_document_dispatch(id bigint generated always as identity,body jsonb);
 create function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin insert into private.test_document_dispatch(body) values(body);return 1;end $$;`);
await service(() => rpc("configure_notification_delivery", [true]));
await service(() =>
  rpc("configure_notification_dispatch", [
    "https://fictional.supabase.co/functions/v1/notifications-dispatch",
    "fixture-token",
  ]),
);
await db.query(
  "update patients set user_id=null,email='fictional@example.test' where id=$1",
  [patient],
);
const today = new Date().toISOString().slice(0, 10),
  future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const refData = {
  referral_type: "SPECIALIST",
  specialty: "Kardiologija",
  reason: "PRIVATE REFERRAL",
  priority: "REGULAR",
  notes: "Privatna napomena",
  expires_on: future,
};
let ref, excuse, report, labResult, job;
await test("issued referrals and excuses queue one signed immutable PDF each and wake immediately", async () => {
  ref = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4001)]),
  );
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4001)]),
  );
  excuse = await as(1, () =>
    rpc("issue_document", [
      patient,
      "SCHOOL_EXCUSE",
      {
        date_from: today,
        date_to: today,
        category: "Bolest",
        school: "Testna škola",
        notes: "Izmišljeni tekst",
        expires_on: future,
      },
      id(4002),
    ]),
  );
  assert.equal(await count(), 2);
  assert.equal(await wakeCount(), 2);
  const jobs = await claim();
  assert.equal(jobs.length, 2);
  const referral = jobs.find((j) => j.document.kind === "REFERRAL");
  assert.ok(JSON.stringify(referral.document).includes("PRIVATE REFERRAL"));
  assert.ok(
    referral.document.sections.some(
      (s) =>
        s.label === "Oznaka potpisa" && s.text.includes("HMAC_SHA256_INTERNAL"),
    ),
  );
  const immutable = JSON.stringify(referral.document);
  await db.query("update patients set first_name='Promijenjeno' where id=$1", [
    patient,
  ]);
  assert.equal(
    JSON.stringify(
      (
        await db.query(
          "select payload from private.document_email_outbox where id=$1",
          [referral.id],
        )
      ).rows[0].payload,
    ),
    immutable,
  );
  job = referral;
  await finish(referral, false);
  await finish(
    jobs.find((j) => j.document.kind === "SCHOOL_EXCUSE"),
    true,
  );
});
await test("failed sending preserves issued documents and retries with the same job and PDF snapshot", async () => {
  assert.equal(
    (await db.query("select status from documents where id=$1", [ref])).rows[0]
      .status,
    "ISSUED",
  );
  await db.query(
    "update private.document_email_outbox set next_attempt_at=now() where id=$1",
    [job.id],
  );
  const [retry] = await claim();
  assert.equal(retry.id, job.id);
  assert.deepEqual(retry.document, job.document);
  await finish(job, true);
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where id=$1",
        [job.id],
      )
    ).rows[0].status,
    "SENDING",
  );
  await finish(retry, true);
  await finish(retry, true);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.document_email_attempts where job_id=$1",
        [job.id],
      )
    ).rows[0].n,
    2,
  );
  assert.deepEqual(await claim(), []);
});
const reportData = {
  report_type: "SPECIALIST",
  reported_on: today,
  diagnosis: "PRIVATE DIAGNOSIS",
  content: "PRIVATE REPORT TEXT",
  conclusion: "PRIVATE CONCLUSION",
  recommendations: "PRIVATE RECOMMENDATION",
};
await test("published medical reports are complete, idempotent, and corrected versions supersede waiting mail", async () => {
  report = await as(1, () =>
    rpc("publish_medical_report", [patient, null, null, reportData, id(4003)]),
  );
  await as(1, () =>
    rpc("publish_medical_report", [patient, null, null, reportData, id(4003)]),
  );
  const newer = await as(1, () =>
    rpc("publish_medical_report", [
      patient,
      null,
      report,
      {
        ...reportData,
        content: "CORRECTED REPORT",
        correction_reason: "Testni ispravak",
      },
      id(4004),
    ]),
  );
  const jobs = await claim();
  assert.equal(jobs.length, 1);
  assert.ok(jobs[0].document.number.endsWith("-v2"));
  assert.ok(JSON.stringify(jobs[0].document).includes("CORRECTED REPORT"));
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where medical_report_id=$1",
        [report],
      )
    ).rows[0].status,
    "CANCELLED",
  );
  report = newer;
  await finish(jobs[0], true);
});
await test("laboratory PDF snapshot is taken after all result parameters are published", async () => {
  await db.query(
    "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
    [id(6), org],
  );
  const lab = await as(1, () =>
    rpc("order_laboratory", [
      patient,
      {
        laboratory_institution_id: org,
        requested_tests: "Izmišljeni test",
        clinical_question: "",
        priority: "REGULAR",
      },
      id(4005),
    ]),
  );
  await as(6, () => rpc("set_lab_order_status", [lab, 1, "IN_PROGRESS", ""]));
  labResult = await as(6, () =>
    rpc("publish_laboratory_result", [
      lab,
      null,
      {
        sampled_at: new Date().toISOString(),
        summary: "PRIVATE LAB COMMENT",
        parameters: [
          {
            code: "ABC",
            name: "Testni parametar",
            value: 42,
            unit: "test",
            reference_low: 1,
            reference_high: 50,
          },
        ],
      },
    ]),
  );
  const [j] = await claim();
  assert.equal(j.document.kind, "LAB_RESULT");
  assert.ok(
    j.document.sections.some(
      (s) => s.label === "ABC / Testni parametar" && s.text.includes("42 test"),
    ),
  );
  assert.ok(JSON.stringify(j.document).includes("PRIVATE LAB COMMENT"));
  await finish(j, true);
});
await test("revocation and changed chart addresses cancel waiting attachments without retargeting", async () => {
  const d = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4006)]),
  );
  await as(1, () => rpc("revoke_document", [d, "Testni opoziv"]));
  assert.deepEqual(await claim(), []);
  const d2 = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4007)]),
  );
  await db.query(
    "update patients set email='changed@example.test' where id=$1",
    [patient],
  );
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where document_id=$1",
        [d2],
      )
    ).rows[0].status,
    "CANCELLED",
  );
});
await test("patient account preferences and verified login email govern delivery and avoid extra generic mails", async () => {
  await db.query("update patients set user_id=$1 where id=$2", [
    id(3),
    patient,
  ]);
  const before = await count();
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4008)]),
  );
  assert.equal(await count(), before);
  await as(3, () => rpc("save_notification_preferences", [true, true]));
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4009)]),
  );
  assert.equal(await count(), before);
  await db.query("update auth.users set email_confirmed_at=now() where id=$1", [
    id(3),
  ]);
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4010)]),
  );
  await as(1, () =>
    rpc("publish_medical_report", [patient, null, null, reportData, id(4011)]),
  );
  const jobs = await claim();
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].email, "fictional3@example.test");
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from private.notification_email_outbox",
      )
    ).rows[0].n,
    0,
  );
  await as(3, () => rpc("save_notification_preferences", [false, true]));
  assert.deepEqual(await claim(), []);
});
await test("unauthorized users cannot publish, choose recipients, access snapshots, claim or complete jobs", async () => {
  for (const n of [0, 3, 4, 5])
    await as(n, async () => {
      await assert.rejects(
        rpc("issue_document", [patient, "REFERRAL", refData, id(4100 + n)]),
      );
      await assert.rejects(
        rpc("publish_medical_report", [
          patient,
          null,
          null,
          reportData,
          id(4200 + n),
        ]),
      );
      await assert.rejects(rpc("claim_document_emails", [1]));
      await assert.rejects(
        rpc("complete_document_email", [
          job.id,
          job.lease_id,
          true,
          "spoof",
          60,
        ]),
      );
      await assert.rejects(
        db.query("select * from private.document_email_outbox"),
      );
      await assert.rejects(
        db.query("select private.email_document_section($1,$2)", [
          "spoof",
          "spoof",
        ]),
      );
    });
});
await test("rolled-back issuance creates neither document nor dispatch request", async () => {
  await db.query(
    "update patients set user_id=null,email='fictional@example.test' where id=$1",
    [patient],
  );
  const before = await count(),
    wakes = await wakeCount();
  await db.exec("begin");
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4012)]),
  );
  await db.exec("set constraints all immediate");
  assert.equal(await count(), before + 1);
  assert.equal(await wakeCount(), wakes + 1);
  await db.exec("rollback");
  assert.equal(await count(), before);
  assert.equal(await wakeCount(), wakes);
});
await test("document retries stop after five attempts and before the provider idempotency window expires", async () => {
  const d = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4013)]),
  );
  for (let n = 1; n <= 5; n++) {
    await db.query(
      "update private.document_email_outbox set next_attempt_at=now() where document_id=$1",
      [d],
    );
    const [j] = await claim();
    assert.ok(j);
    await finish(j, false);
  }
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where document_id=$1",
        [d],
      )
    ).rows[0].status,
    "FAILED",
  );
  const d2 = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4014)]),
  );
  const [j] = await claim();
  await finish(j, false);
  await db.query(
    "update private.document_email_outbox set first_attempt_at=now()-interval '24 hours',next_attempt_at=now() where document_id=$1",
    [d2],
  );
  assert.deepEqual(await claim(), []);
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where document_id=$1",
        [d2],
      )
    ).rows[0].status,
    "FAILED",
  );
});
await test("failure to wake the worker never rolls back issuance and leaves the PDF queued", async () => {
  await db.exec(
    `create or replace function net.http_post(url text,body jsonb default '{}',params jsonb default '{}',headers jsonb default '{}',timeout_milliseconds integer default 1000) returns bigint language plpgsql as $$begin raise exception 'Simulated queue failure';end $$;`,
  );
  const d = await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", refData, id(4015)]),
  );
  assert.equal(
    (await db.query("select status from documents where id=$1", [d])).rows[0]
      .status,
    "ISSUED",
  );
  assert.equal(
    (
      await db.query(
        "select status from private.document_email_outbox where document_id=$1",
        [d],
      )
    ).rows[0].status,
    "PENDING",
  );
});
await db.close();
console.log(`${passed} document email checks passed.`);

import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, patient } = await workflowFixture();
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
const local = (value) =>
  new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Zagreb",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(value)
    .replace(" ", "T");
try {
  const ward = await as(5, () =>
    rpc("save_inpatient_ward", [
      null,
      org,
      "Izmišljeni odjel za terapiju",
      true,
    ]),
  );
  const bed = await as(5, () =>
    rpc("save_inpatient_bed", [null, ward, "Izmišljeni krevet", true]),
  );
  const episode = await as(1, () =>
    rpc("admit_inpatient", [
      patient,
      bed,
      "Izmišljeni bolnički prijam",
      id(15001),
    ]),
  );
  await db
    .query(
      "update inpatient_admissions set admitted_at=now()-interval '1 day' where id=$1",
      [episode],
    )
    .catch(async () => {
      // Identity is immutable even for owner: seed the test clock through the fixture only.
      await db.exec(
        "alter table inpatient_admissions disable trigger preserve_admission",
      );
      await db.query(
        "update inpatient_admissions set admitted_at=now()-interval '1 day' where id=$1",
        [episode],
      );
      await db.exec(
        "alter table inpatient_admissions enable trigger preserve_admission",
      );
    });
  const medicine = id(15002);
  await db.query(
    "insert into medications(id,name,active_ingredient,strength,form,packaging,route) values($1,'Izmišljeni testni lijek','Test','Test','Test','Test','Test')",
    [medicine],
  );
  const times = [
    local(new Date(Date.now() - 3600000)),
    local(new Date(Date.now() + 3600000)),
  ];
  const create = (n = 1, key = 15003, slots = times) =>
    as(n, () =>
      rpc("create_inpatient_medication_order", [
        episode,
        medicine,
        "Testna doza",
        "Testni put",
        "Izmišljena uputa",
        slots,
        id(key),
      ]),
    );
  const order = await create();
  let board = await as(1, () => rpc("inpatient_medications", [episode]));
  const dose = board.orders[0].doses[0].id;
  const actual = local(new Date(Date.now() - 1800000));
  const record = (
    n = 6,
    key = 15004,
    outcome = "GIVEN",
    amount = "Testna doza",
    confirmed = true,
    note = "",
    previous = null,
    reason = "",
  ) =>
    as(n, () =>
      rpc("record_inpatient_medication", [
        dose,
        outcome,
        actual,
        amount,
        confirmed,
        note,
        id(key),
        previous,
        reason,
      ]),
    );
  await check(
    "physician orders retain medication snapshot and reject changed idempotency payloads",
    async () => {
      assert.equal(await create(), order);
      assert.equal(board.orders.length, 1);
      assert.equal(
        board.orders[0].medication_snapshot.name,
        "Izmišljeni testni lijek",
      );
      await assert.rejects(create(1, 15003, [times[0]]), /Request changed/);
      await db.query(
        "update medications set name='Izmijenjeni katalog' where id=$1",
        [medicine],
      );
      assert.equal(
        (await as(1, () => rpc("inpatient_medications", [episode]))).orders[0]
          .medication_snapshot.name,
        "Izmišljeni testni lijek",
      );
    },
  );
  await check(
    "unrelated clinicians, patients, administrators and unassigned nurses have no clinical access",
    async () => {
      for (const n of [0, 2, 3, 4, 5, 6]) {
        await assert.rejects(
          as(n, () => rpc("inpatient_medications", [episode])),
          /Forbidden|permission denied/,
        );
        await assert.rejects(
          create(n, 15100 + n),
          /Forbidden|permission denied/,
        );
        await assert.rejects(
          record(n, 15200 + n),
          /Forbidden|permission denied/,
        );
      }
    },
  );
  await db.query(
    "insert into patient_staff(patient_id,user_id,institution_id,created_by) values($1,$2,$3,$4)",
    [patient, id(6), org, id(5)],
  );
  await check(
    "explicitly assigned nurses may record but cannot order or stop medication",
    async () => {
      const b = await as(6, () => rpc("inpatient_medications", [episode]));
      assert.equal(b.can_record, true);
      assert.equal(b.can_order, false);
      await assert.rejects(create(6), /Forbidden/);
      await assert.rejects(
        as(6, () =>
          rpc("stop_inpatient_medication_order", [
            order,
            1,
            "Izmišljeno zaustavljanje",
          ]),
        ),
        /Forbidden/,
      );
    },
  );
  await check(
    "rejects duplicate/invalid dose slots, inactive medicines and DST ambiguity",
    async () => {
      await assert.rejects(
        create(1, 15301, [times[0], times[0]]),
        /Invalid or duplicate/,
      );
      await assert.rejects(create(1, 15302, []), /between 1 and 48/);
      for (const value of ["2027-03-28T02:30", "2026-10-25T02:30"])
        await assert.rejects(
          db.query("select private.medication_local_time($1)", [value]),
          /Ambiguous or nonexistent/,
        );
      await db.query("update medications set active=false where id=$1", [
        medicine,
      ]);
      await assert.rejects(create(1, 15303), /Medication unavailable/);
      await db.query("update medications set active=true where id=$1", [
        medicine,
      ]);
    },
  );
  await check(
    "patient confirmation, valid times and explanations for deviation/nonadministration are required",
    async () => {
      await assert.rejects(
        record(6, 15401, "GIVEN", "Testna doza", false),
        /check constraint/,
      );
      await assert.rejects(
        record(6, 15405, "GIVEN", null, true, "Izmišljena napomena"),
        /check constraint/,
      );
      await assert.rejects(
        record(6, 15402, "GIVEN", "Druga doza"),
        /Explain dose deviation/,
      );
      await assert.rejects(
        record(6, 15403, "NOT_GIVEN", null, false),
        /check constraint/,
      );
      await assert.rejects(
        as(6, () =>
          rpc("record_inpatient_medication", [
            dose,
            "GIVEN",
            times[1],
            "Testna doza",
            true,
            "",
            id(15404),
          ]),
        ),
        /Invalid administration time/,
      );
    },
  );
  const first = await record();
  await check(
    "one current record per dose, stable retry and no changed payload retry",
    async () => {
      assert.equal(await record(), first);
      await assert.rejects(
        record(6, 15004, "NOT_GIVEN", null, false, "Pacijent je odbio"),
        /Request changed/,
      );
      await assert.rejects(record(6, 15501), /Dose already recorded/);
      await assert.rejects(
        db.query(
          "update inpatient_medication_records set note='Prepisan zapis' where id=$1",
          [first],
        ),
        /immutable/,
      );
      await assert.rejects(
        as(6, () => db.query("select * from inpatient_medication_records")),
        /permission denied/,
      );
    },
  );
  await check(
    "linked correction preserves original author, reason and full history",
    async () => {
      await assert.rejects(
        record(
          1,
          15601,
          "NOT_GIVEN",
          null,
          false,
          "Pacijent je odbio",
          first,
          "Ispravak netočnog zapisa",
        ),
        /Invalid record correction/,
      );
      const corrected = await record(
        6,
        15602,
        "NOT_GIVEN",
        null,
        false,
        "Pacijent je odbio",
        first,
        "Ispravak netočnog zapisa",
      );
      const history = await as(6, () =>
        rpc("inpatient_medication_history", [order]),
      );
      assert.equal(history.total, 2);
      assert.equal(
        history.records.find((x) => x.id === first).superseded_by,
        corrected,
      );
      assert.equal(
        (await as(6, () => rpc("inpatient_medications", [episode]))).orders[0]
          .doses[0].record.id,
        corrected,
      );
      await assert.rejects(
        record(
          6,
          15603,
          "GIVEN",
          "Testna doza",
          true,
          "",
          first,
          "Zastarjela verzija",
        ),
        /Invalid record correction/,
      );
    },
  );
  await check(
    "stopping preserves history, supports retry and blocks new administration",
    async () => {
      await as(1, () =>
        rpc("stop_inpatient_medication_order", [
          order,
          1,
          "Izmišljeni razlog zaustavljanja",
        ]),
      );
      await as(1, () =>
        rpc("stop_inpatient_medication_order", [
          order,
          1,
          "Izmišljeni razlog zaustavljanja",
        ]),
      );
      const secondDose = (
        await as(1, () => rpc("inpatient_medications", [episode]))
      ).orders[0].doses[1].id;
      await assert.rejects(
        as(6, () =>
          rpc("record_inpatient_medication", [
            secondDose,
            "NOT_GIVEN",
            actual,
            null,
            false,
            "Nije primijenjeno",
            id(15701),
          ]),
        ),
        /Medication order is closed/,
      );
      assert.equal(
        (await as(6, () => rpc("inpatient_medication_history", [order]))).total,
        2,
      );
    },
  );
  await check(
    "closed-order corrections retain older history across pages",
    async () => {
      let previous = (
        await as(6, () => rpc("inpatient_medications", [episode]))
      ).orders[0].doses[0].record.id;
      for (let n = 0; n < 51; n++)
        previous = await record(
          6,
          16000 + n,
          "NOT_GIVEN",
          null,
          false,
          "Izmišljeni razlog neprimjene",
          previous,
          "Izmišljeni ispravak zapisa " + n,
        );
      const firstPage = await as(6, () =>
        rpc("inpatient_medication_history", [order, 0]),
      );
      const lastPage = await as(6, () =>
        rpc("inpatient_medication_history", [order, 1]),
      );
      assert.equal(firstPage.total, 53);
      assert.equal(firstPage.records.length, 50);
      assert.equal(lastPage.records.length, 3);
      assert.equal(
        new Set([...firstPage.records, ...lastPage.records].map((x) => x.id))
          .size,
        53,
      );
      assert.equal(
        (await as(6, () => rpc("inpatient_medications", [episode]))).orders[0]
          .doses[0].record.id,
        previous,
      );
    },
  );
  const secondOrder = await create(1, 15800);
  await check(
    "order pages include older orders without duplicates",
    async () => {
      for (let n = 0; n < 19; n++) await create(1, 17000 + n);
      const first = await as(1, () =>
        rpc("inpatient_medications", [episode, 0]),
      );
      const last = await as(1, () =>
        rpc("inpatient_medications", [episode, 1]),
      );
      assert.equal(first.total, 21);
      assert.equal(first.orders.length, 20);
      assert.equal(last.orders.length, 1);
      assert.equal(
        new Set([...first.orders, ...last.orders].map((x) => x.id)).size,
        21,
      );
    },
  );
  await check(
    "hospital discharge atomically closes active orders and prevents new ones",
    async () => {
      const report = await as(1, () =>
        rpc("publish_medical_report", [
          patient,
          null,
          null,
          {
            report_type: "DISCHARGE",
            reported_on: local(new Date()).slice(0, 10),
            diagnosis: "Izmišljena dijagnoza",
            content: "Izmišljeni sadržaj otpusnog pisma",
            findings: "Izmišljeni nalaz",
            recommendations: "Izmišljena preporuka",
            admission_id: episode,
          },
          id(15801),
        ]),
      );
      await as(1, () => rpc("discharge_inpatient", [episode, 1, report]));
      const b = await as(6, () => rpc("inpatient_medications", [episode]));
      assert.equal(
        b.orders.find((x) => x.id === secondOrder).status,
        "DISCHARGED",
      );
      await assert.rejects(create(1, 15802), /Admission is closed/);
      assert.equal(await create(1, 15800), secondOrder);
    },
  );
  await check(
    "revocation immediately removes history and correction access",
    async () => {
      await db.query(
        "update patient_staff set revoked_at=now() where patient_id=$1 and user_id=$2",
        [patient, id(6)],
      );
      await assert.rejects(
        as(6, () => rpc("inpatient_medication_history", [order])),
        /Forbidden/,
      );
      const current = (
        await db.query(
          "select id from inpatient_medication_records where dose_id=$1 and superseded_by is null",
          [dose],
        )
      ).rows[0].id;
      await assert.rejects(
        record(
          6,
          15901,
          "GIVEN",
          "Testna doza",
          true,
          "",
          current,
          "Ispravak nakon opoziva",
        ),
        /Forbidden/,
      );
    },
  );
  console.log(checks + " inpatient medication checks passed");
} finally {
  await db.close();
}

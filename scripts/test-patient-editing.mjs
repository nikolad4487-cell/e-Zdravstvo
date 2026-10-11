import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, id, patient, doc, org, as, rpc } = await workflowFixture();
const fields = [
  "first_name",
  "last_name",
  "birth_date",
  "sex",
  "address",
  "city",
  "postal_code",
  "phone",
  "email",
  "insurance",
  "emergency_contact",
];
const row = async () =>
  (await db.query("select * from patients where id=$1", [patient])).rows[0];
const editable = (p) =>
  Object.fromEntries(
    fields.map((k) => [
      k,
      p[k] instanceof Date ? p[k].toISOString().slice(0, 10) : p[k],
    ]),
  );
const current = async () => editable(await row());
const form = (p) => Object.fromEntries(fields.map((k) => [k, p[k] ?? ""]));
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  passed++;
}
await test("treating doctor edits patient demographics and contacts; account and clinical records are preserved", async () => {
  const previous = await row();
  const data = {
    ...form(previous),
    first_name: "  Ana  ",
    last_name: "  Test  ",
    birth_date: "1995-06-15",
    sex: "F",
    address: "Ulica 1",
    city: "Zagreb",
    postal_code: "10000",
    phone: "099000000",
    email: "fictional@example.test",
    insurance: "Test",
    emergency_contact: "Kontakt",
  };
  await as(1, () =>
    rpc("update_patient_details", [patient, data, editable(previous)]),
  );
  const saved = await row();
  assert.equal(saved.first_name, "Ana");
  assert.equal(saved.last_name, "Test");
  assert.equal(saved.email, "fictional@example.test");
  assert.equal(saved.insurance, "Test");
  assert.equal(saved.patient_number, previous.patient_number);
  assert.equal(saved.user_id, previous.user_id);
  assert.equal(saved.institution_id, previous.institution_id);
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from medical_records where patient_id=$1",
        [patient],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await as(1, () => rpc("get_patient_chart", [patient]))).patient.first_name,
    "Ana",
  );
  const audit = (
    await db.query(
      "select user_id from audit_logs where action='PATIENT_DETAILS_UPDATED' and entity_id=$1",
      [patient],
    )
  ).rows;
  assert.equal(audit.length, 1);
  assert.equal(audit[0].user_id, id(1));
});
await test("anonymous, patient, unrelated doctor, nurse and administrator cannot edit demographics", async () => {
  const before = await current();
  for (const n of [0, 2, 3, 4, 5, 6])
    await as(n, () =>
      assert.rejects(
        rpc("update_patient_details", [
          patient,
          { ...form(before), first_name: "Forbidden" },
          before,
        ]),
        (e) => e.code === "42501",
      ),
    );
  assert.deepEqual(await current(), before);
});
await test("invalid fields, dates, email, overlong text and protected identifiers are rejected atomically", async () => {
  const before = await current();
  const cases = [
    { first_name: " " },
    { birth_date: "2100-01-01" },
    { birth_date: "1899-01-01" },
    { birth_date: "2000-02-30" },
    { birth_date: "not-a-date" },
    { sex: "INVALID" },
    { email: "invalid" },
    { city: "x".repeat(151) },
    { first_name: "x".repeat(101) },
    { user_id: id(4) },
    { id: id(999) },
    { institution_id: id(999) },
    { patient_number: "FORGED" },
    { first_name: null },
  ];
  for (const change of cases) {
    await as(1, () =>
      assert.rejects(
        rpc("update_patient_details", [
          patient,
          { ...form(before), ...change },
          before,
        ]),
      ),
    );
    assert.deepEqual(await current(), before);
  }
  await as(1, () =>
    assert.rejects(rpc("update_patient_details", [patient, {}, before])),
  );
  await as(1, () =>
    assert.rejects(rpc("update_patient_details", [patient, null, before])),
  );
});
await test("stale snapshots reject overwriting edits made by doctor or patient", async () => {
  const before = await current();
  await as(1, () =>
    rpc("update_patient_details", [
      patient,
      { ...form(before), phone: "111" },
      before,
    ]),
  );
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [
        patient,
        { ...form(before), phone: "222" },
        before,
      ]),
      (e) => e.code === "40001",
    ),
  );
  const newer = await current();
  await as(3, () =>
    rpc("save_patient_contacts", [{ ...form(newer), phone: "333" }]),
  );
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [
        patient,
        { ...form(newer), city: "Split" },
        newer,
      ]),
      (e) => e.code === "40001",
    ),
  );
  assert.equal((await current()).phone, "333");
  const latest = await current();
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [patient, form(latest), null]),
      (e) => e.code === "40001",
    ),
  );
});
await test("optional contact data can be cleared without modifying identity links", async () => {
  const before = await current();
  const data = {
    ...form(before),
    phone: " ",
    email: "",
    insurance: "",
    emergency_contact: "",
  };
  await as(1, () => rpc("update_patient_details", [patient, data, before]));
  const saved = await row();
  for (const key of ["phone", "email", "insurance", "emergency_contact"])
    assert.equal(saved[key], null);
  assert.equal(saved.user_id, id(3));
});
await test("revoked patient consent prevents editing immediately", async () => {
  await as(3, () => rpc("set_my_care_access", [id(1), false]));
  const before = await current();
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [patient, form(before), before]),
      (e) => e.code === "42501",
    ),
  );
  assert.deepEqual(await current(), before);
  await as(3, () => rpc("set_my_care_access", [id(1), true]));
});
await test("suspended doctor membership, revoked care link and archived patient prevent editing", async () => {
  const before = await current();
  await db.query(
    "update institution_users set active=false where user_id=$1 and institution_id=$2",
    [id(1), org],
  );
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [patient, form(before), before]),
      (e) => e.code === "42501",
    ),
  );
  await db.query(
    "update institution_users set active=true where user_id=$1 and institution_id=$2",
    [id(1), org],
  );
  await db.query(
    "update patient_doctors set revoked_at=now() where patient_id=$1 and doctor_id=$2",
    [patient, doc],
  );
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [patient, form(before), before]),
      (e) => e.code === "42501",
    ),
  );
  await db.query(
    "update patient_doctors set revoked_at=null where patient_id=$1 and doctor_id=$2",
    [patient, doc],
  );
  await db.query("update patients set archived_at=now() where id=$1", [
    patient,
  ]);
  await as(1, () =>
    assert.rejects(
      rpc("update_patient_details", [patient, form(before), before]),
      (e) => e.code === "42501",
    ),
  );
});
await test("browser roles still cannot directly update the patients table", async () => {
  for (const n of [0, 1, 3, 5])
    await as(n, () =>
      assert.rejects(
        db.query("update patients set first_name='Bypass' where id=$1", [
          patient,
        ]),
      ),
    );
});
await db.close();
console.log(`${passed} patient editing checks passed.`);

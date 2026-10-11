import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
import {
  medicalCatalogData,
  diagnosisImportSql,
  listImportSql,
  codesImportSql,
} from "./lib/medical-catalog-import.mjs";
const { db, as, rpc, id, patient } = await workflowFixture();
const data = await medicalCatalogData();
await db.exec(
  "insert into public.medical_code_sources(id,file_name,file_sha256,revision,expected_count)values('HZJZ-MKB','fixture','fixture','supplied',39848)",
);
for (let i = 0; i < data.lists.length; i += 20)
  await db.exec(listImportSql(data.lists.slice(i, i + 20)));
const codes = data.lists.flatMap((l) =>
  l.entries.map((e) => ({ ...e, list_id: l.id })),
);
for (let i = 0; i < codes.length; i += 500)
  await db.exec(codesImportSql(codes.slice(i, i + 500)));
for (let i = 0; i < data.diagnoses.length; i += 2000)
  await db.exec(diagnosisImportSql(data.diagnoses.slice(i, i + 2000)));
assert.equal(
  (
    await db.query(
      "select count(*)::int n from diagnoses where catalog_source='HZJZ-MKB'",
    )
  ).rows[0].n,
  39848,
);
assert.equal(new Set(data.diagnoses.map((r) => r.code)).size, 39848);
console.log(
  "PASS all 39,848 unique source diagnoses, hierarchy and marked codes are imported",
);
const diagnosis = await as(1, () => rpc("search_diagnosis_codes", ["E669", 0]));
assert.equal(diagnosis[0].code, "E66.9");
const starred = data.diagnoses.find((d) => d.code.includes("*"));
const stars = await as(1, () =>
  rpc("search_diagnosis_codes", [starred.code, 0]),
);
assert.equal(stars[0].code, starred.code);
const sugar = await as(1, () => rpc("search_diagnosis_codes", ["secerna", 0]));
assert.ok(sugar.length > 0);
assert.ok(sugar.some((d) => /Šećerna|šećerna/.test(d.name)));
const first = await as(1, () => rpc("search_diagnosis_codes", ["", 0])),
  second = await as(1, () => rpc("search_diagnosis_codes", ["", 1]));
assert.equal(first.length, 50);
assert.equal(second.length, 50);
assert.ok(!second.some((d) => first.some((f) => f.id === d.id)));
console.log(
  "PASS code aliases, Croatian accent search, star preservation and pagination",
);
const official = await as(1, () =>
  rpc("search_medical_codes", ["2.2.5", "", 0]),
);
assert.equal(official.length, 14);
assert.ok(official.some((c) => c.code === "D1"));
assert.equal(
  (await as(1, () => rpc("search_medical_codes", ["2.2.42", "", 0]))).length,
  2,
);
assert.equal(codes.length, data.manifest.cezih.entries);
assert.equal(data.lists.length, 200);
console.log(
  "PASS CEZIH source counts and separate referral / SKZZ / PZZ code systems",
);
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const selected = diagnosis[0];
const request = id(7100),
  input = {
    referral_code: "A1",
    referral_code_name: "FORGED",
    examination_code: "2",
    examination_name: "FORGED",
    visit_code: "01",
    visit_name: "FORGED",
    specialty: "Kardiologija",
    reason: "Izmišljeni razlog",
    diagnosis_id: selected.id,
    priority: "REGULAR",
    expires_on: future,
  };
const doc = await as(1, () =>
  rpc("issue_document", [patient, "REFERRAL", input, request]),
);
const stored = (
  await db.query("select payload from documents where id=$1", [doc])
).rows[0].payload;
assert.equal(stored.details.referral_code, "A1");
assert.equal(stored.details.referral_code_name, "Konzilijarni pregled");
assert.equal(stored.details.examination_name, "Složeni pregled");
assert.equal(stored.details.visit_name, "Prvi pregled");
assert.ok(stored.details.diagnosis.includes("E66.9"));
assert.equal(
  await as(1, () =>
    rpc("issue_document", [patient, "REFERRAL", input, request]),
  ),
  doc,
);
console.log(
  "PASS signed referral snapshots validate codes, ignore forged names and preserve idempotency",
);
for (const changes of [
  { referral_code: "FAKE" },
  { examination_code: "3" },
  { visit_code: "SK001" },
])
  await assert.rejects(
    as(1, () =>
      rpc("issue_document", [
        patient,
        "REFERRAL",
        { ...input, ...changes },
        crypto.randomUUID(),
      ]),
    ),
  );
await assert.rejects(
  as(2, () =>
    rpc("issue_document", [patient, "REFERRAL", input, crypto.randomUUID()]),
  ),
);
await db.exec("set role anon");
await assert.rejects(rpc("search_diagnosis_codes", ["", 0]));
await assert.rejects(db.query("select * from medical_codes"));
await db.exec("reset role");
await assert.rejects(
  as(1, () =>
    db.query(
      "insert into medical_codes(list_id,code,name,description)values('2.2.5','FAKE','x','x')",
    ),
  ),
);
console.log(
  "PASS invalid codes and unauthorized issuance / source mutations are rejected",
);
await db.close();

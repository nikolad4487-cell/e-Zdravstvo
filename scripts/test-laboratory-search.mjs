import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";

// Disposable in-memory database; no production patient data or credentials.
const { db, id, org, doc, patient, secondPatient, as, rpc } =
  await workflowFixture();
let passed = 0;
async function test(name, fn) {
  await fn();
  console.log("PASS " + name);
  passed++;
}
const search = (mode, filters = {}) =>
  rpc("search_laboratory", [
    mode,
    filters.patient ?? null,
    filters.page ?? 0,
    filters.term ?? "",
    filters.status ?? null,
    filters.priority ?? null,
    filters.from ?? null,
    filters.to ?? null,
  ]);
await db.query(
  "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
  [id(6), org],
);
const otherOrg = id(30);
await db.query(
  "insert into institutions(id,name,code) values($1,'Drugi laboratorij','OTHERLAB')",
  [otherOrg],
);
async function order(
  n,
  pid,
  institution,
  createdAt,
  tests,
  status = "ORDERED",
  priority = "REGULAR",
) {
  await db.query(
    `insert into laboratory_orders(id,patient_id,doctor_id,laboratory_institution_id,requested_tests,status,priority,request_id,created_by,created_at)
    values($1,$2,$3,$4,$5,$6,$7,$1,$8,$9)`,
    [id(n), pid, doc, institution, tests, status, priority, id(1), createdAt],
  );
}
for (let n = 0; n < 105; n++)
  await order(
    1000 + n,
    patient,
    org,
    n === 0 ? "2025-01-10T10:00:00Z" : "2026-01-10T10:00:00Z",
    n === 0 ? "Stara pretraga 100% _ GLUKOZA" : "Povijesna pretraga",
    n % 2 ? "IN_PROGRESS" : "ORDERED",
    n % 3 ? "REGULAR" : "URGENT",
  );
await order(
  2000,
  secondPatient,
  org,
  "2026-01-11T10:00:00Z",
  "Samo drugi pacijent",
);
await order(
  2001,
  secondPatient,
  otherOrg,
  "2026-01-12T10:00:00Z",
  "Privatno u drugom laboratoriju",
);

await test("search reaches old orders beyond the first 100 and treats wildcard characters literally", async () => {
  for (const term of ["glukoza", "100%", "_", "  GLUKOZA  "]) {
    const rows = await as(3, () => search("PERSONAL", { term }));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, id(1000));
  }
  assert.equal(
    (await as(3, () => search("PERSONAL", { term: "absent" }))).length,
    0,
  );
});
await test("equal timestamps retain deterministic ordering across all pages", async () => {
  const pages = [];
  for (let page = 0; page < 3; page++)
    pages.push(await as(3, () => search("PERSONAL", { page })));
  assert.deepEqual(
    pages.map((p) => p.length),
    [50, 50, 5],
  );
  const ids = pages.flat().map((o) => o.id);
  assert.equal(new Set(ids).size, 105);
  assert.deepEqual(ids, [
    ...Array.from({ length: 104 }, (_, i) => id(1001 + i)),
    id(1000),
  ]);
  assert.deepEqual(await as(3, () => search("PERSONAL", { page: 3 })), []);
});
await test("patient name, number, doctor and laboratory are searchable within the authorized scope", async () => {
  const first = (await as(3, () => search("PERSONAL")))[0];
  for (const term of [
    "Testna Osoba",
    first.patient_number,
    first.doctor_name,
    first.laboratory_name,
  ])
    assert.equal(
      (await as(3, () => search("PERSONAL", { term, page: 2 }))).length,
      5,
    );
  assert.equal(
    (await as(3, () => search("PERSONAL", { term: "Druga Osoba" }))).length,
    0,
  );
});
await test("status and priority filters combine before pagination", async () => {
  const rows = await as(3, () =>
    search("PERSONAL", { status: "IN_PROGRESS", priority: "URGENT" }),
  );
  assert.equal(rows.length, 17);
  assert.ok(
    rows.every((o) => o.status === "IN_PROGRESS" && o.priority === "URGENT"),
  );
  assert.equal(
    (await as(3, () => search("PERSONAL", { status: "COMPLETED" }))).length,
    0,
  );
});
await test("date filters include the full Zagreb day through spring and autumn daylight saving changes", async () => {
  for (const [date, prefix, boundaries] of [
    [
      "2026-03-29",
      3000,
      [
        "2026-03-28T22:59:59Z",
        "2026-03-28T23:00:00Z",
        "2026-03-29T21:59:59Z",
        "2026-03-29T22:00:00Z",
      ],
    ],
    [
      "2026-10-25",
      3010,
      [
        "2026-10-24T21:59:59Z",
        "2026-10-24T22:00:00Z",
        "2026-10-25T22:59:59Z",
        "2026-10-25T23:00:00Z",
      ],
    ],
  ]) {
    for (let i = 0; i < 4; i++)
      await order(prefix + i, patient, org, boundaries[i], "Vremenska granica");
    const rows = await as(3, () =>
      search("PERSONAL", { from: date, to: date }),
    );
    assert.deepEqual(
      rows.map((o) => o.id),
      [id(prefix + 2), id(prefix + 1)],
    );
  }
  assert.equal(
    (await as(3, () => search("PERSONAL", { to: "2025-01-10" }))).length,
    1,
  );
});
await test("result corrections and parameters remain in order history with the existing action permissions", async () => {
  for (let version = 1; version <= 2; version++) {
    await db.query(
      `insert into laboratory_results(id,order_id,sampled_at,version,summary,created_by)
      values($1,$2,'2025-01-10T10:00:00Z',$3,'Testni nalaz',$4)`,
      [id(4000 + version), id(1000), version, id(6)],
    );
    await db.query(
      "insert into laboratory_parameters(result_id,code,name,value,unit,flag) values($1,'GLU','Glukoza',$2,'mmol/L','NORMAL')",
      [id(4000 + version), version + 4],
    );
  }
  await db.query("update laboratory_results set superseded_by=$1 where id=$2", [
    id(4002),
    id(4001),
  ]);
  const personal = (
    await as(3, () => search("PERSONAL", { term: "GLUKOZA" }))
  )[0];
  assert.deepEqual(
    personal.results.map((r) => r.version),
    [2, 1],
  );
  assert.equal(personal.results[1].superseded_by, id(4002));
  assert.equal(personal.results[0].parameters[0].value, 6);
  assert.equal(personal.can_publish, false);
  assert.equal(personal.can_cancel, false);
  assert.equal(
    (await as(6, () => search("LAB", { term: "GLUKOZA" })))[0].can_publish,
    true,
  );
  assert.equal(
    (await as(1, () => search("CARE", { term: "GLUKOZA" })))[0].can_cancel,
    true,
  );
  assert.equal(
    (await as(3, () => rpc("list_laboratory", ["PERSONAL", null, 0]))).length,
    50,
  );
});
await test("patient, clinician and administrator search cannot expose unauthorized orders", async () => {
  for (const filters of [
    { patient: secondPatient },
    { term: "Samo drugi" },
    { term: "Privatno" },
  ])
    assert.deepEqual(await as(3, () => search("PERSONAL", filters)), []);
  assert.deepEqual(await as(2, () => search("CARE", { patient })), []);
  assert.deepEqual(await as(5, () => search("CARE")), []);
  assert.equal(
    (await as(2, () => search("CARE", { patient: secondPatient }))).length,
    2,
  );
});
await test("blocking care access immediately removes clinician search results", async () => {
  await as(3, () => rpc("set_my_care_access", [id(1), false]));
  assert.deepEqual(await as(1, () => search("CARE", { patient })), []);
  assert.equal(
    (await as(3, () => search("PERSONAL", { term: "GLUKOZA" }))).length,
    1,
  );
  await as(3, () => rpc("set_my_care_access", [id(1), true]));
  assert.equal(
    (await as(1, () => search("CARE", { patient, term: "GLUKOZA" }))).length,
    1,
  );
});
await test("verified guardians retain read-only laboratory access until revocation", async () => {
  const child = await as(1, () =>
    rpc("create_patient", [
      {
        first_name: "Testno",
        last_name: "Dijete",
        sex: "UNKNOWN",
        birth_date: new Date(Date.now() - 3650 * 86400000)
          .toISOString()
          .slice(0, 10),
      },
      doc,
    ]),
  );
  await order(5000, child, org, "2026-01-10T10:00:00Z", "Skrbnička pretraga");
  assert.deepEqual(await as(4, () => search("CARE", { patient: child })), []);
  await as(5, () =>
    rpc("grant_guardian_access", [
      child,
      id(4),
      "PARENT",
      "TEST-VERIFICATION",
      new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    ]),
  );
  const rows = await as(4, () => search("CARE", { patient: child }));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].can_publish, false);
  assert.equal(rows[0].can_cancel, false);
  const assignment = (
    await as(5, () => rpc("admin_patient_guardians", [child]))
  )[0];
  await as(5, () =>
    rpc("revoke_guardian_access", [assignment.id, "Testni opoziv ovlasti"]),
  );
  assert.deepEqual(await as(4, () => search("CARE", { patient: child })), []);
});
await test("laboratory search is restricted to active institution membership", async () => {
  assert.equal(
    (await as(6, () => search("LAB", { patient: secondPatient }))).length,
    1,
  );
  assert.deepEqual(await as(6, () => search("LAB", { term: "Privatno" })), []);
  await db.query("update institution_users set active=false where user_id=$1", [
    id(6),
  ]);
  assert.deepEqual(await as(6, () => search("LAB")), []);
  await db.query("update institution_users set active=true where user_id=$1", [
    id(6),
  ]);
});
await test("archiving a patient removes personal search access", async () => {
  await db.query("update patients set archived_at=now() where id=$1", [
    patient,
  ]);
  assert.deepEqual(await as(3, () => search("PERSONAL")), []);
  await db.query("update patients set archived_at=null where id=$1", [patient]);
});
await test("invalid filters and anonymous calls are rejected", async () => {
  for (const args of [
    ["PERSONAL", null, -1],
    ["PERSONAL", null, 10001],
    ["PERSONAL", null, null],
    ["PERSONAL", null, 0, null],
    ["PERSONAL", null, 0, "x".repeat(201)],
    ["PERSONAL", null, 0, "", "INVALID"],
    ["PERSONAL", null, 0, "", null, "INVALID"],
    ["PERSONAL", null, 0, "", null, null, "2026-10-11", "2026-10-10"],
    ["INVALID"],
    [null],
  ])
    await as(3, () => assert.rejects(rpc("search_laboratory", args)));
  await as(0, () => assert.rejects(search("PERSONAL")));
  await as(6, () => assert.rejects(search("PERSONAL")));
});
console.log(`${passed} laboratory search checks passed.`);
await db.close();

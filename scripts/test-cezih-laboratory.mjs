import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
import {
  medicalCatalogData,
  listImportSql,
  codesImportSql,
} from "./lib/medical-catalog-import.mjs";
const { db, as, rpc, id, org, otherDoc, patient } = await workflowFixture();
try {
  const data = await medicalCatalogData();
  const lists = data.lists.filter((l) =>
    ["2.2.18", "2.2.30", "2.2.31", "2.2.5"].includes(l.id),
  );
  await db.exec(listImportSql(lists));
  await db.exec(
    codesImportSql(
      lists.flatMap((l) => l.entries.map((e) => ({ ...e, list_id: l.id }))),
    ),
  );
  const dept = await as(5, () =>
    rpc("save_hospital_department", [null, org, "Laboratorij", 15, true]),
  );
  const service = await as(5, () =>
    rpc("create_hospital_laboratory", [
      dept,
      otherDoc,
      "Laboratorijske pretrage i predaja uzoraka",
      "Laboratorij",
      "Testna lokacija",
      "",
      "",
    ]),
  );
  let lab = (
    await as(2, () => rpc("priority_hospital_context", [true]))
  ).services.find((s) => s.id === service);
  assert.equal(
    lab.laboratory_tests.filter((t) => t.catalog_list === "2.2.30").length,
    43,
  );
  assert.equal(
    lab.laboratory_tests.filter((t) => t.catalog_list === "2.2.30" && t.active)
      .length,
    40,
  );
  const tsh = lab.laboratory_tests.find((t) => t.code === "35510-10");
  assert.equal(tsh.sampling_until, "19:00:00");
  assert.ok(
    !lab.laboratory_tests.find((t) => t.code === "LOCAL-THYROID").active,
  );
  assert.equal(
    await as(2, () => rpc("apply_cezih_laboratory_catalog", [service])),
    0,
  );
  await as(2, () =>
    rpc("save_hospital_laboratory_test", [
      service,
      tsh.id,
      {
        code: "FORGED",
        name: "FORGED",
        sampling_from: "07:00",
        sampling_until: "19:00",
        active: true,
      },
    ]),
  );
  lab = (
    await as(1, () => rpc("priority_hospital_context", [false]))
  ).services.find((s) => s.id === service);
  assert.equal(
    lab.laboratory_tests.find((t) => t.id === tsh.id).code,
    "35510-10",
  );
  assert.equal(
    lab.laboratory_tests.find((t) => t.id === tsh.id).name,
    "S - TSH",
  );
  await assert.rejects(
    as(1, () => rpc("apply_cezih_laboratory_catalog", [service])),
    /Forbidden/,
  );
  await db.query(
    "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
    [id(6), org],
  );
  const order = await as(1, () =>
    rpc("order_laboratory", [
      patient,
      {
        laboratory_institution_id: org,
        requested_tests: "FORGED",
        priority: "REGULAR",
        catalog_order_codes: ["35510-10", "28090-10"],
        specimen_codes: ["00", "07"],
      },
      id(9700),
    ]),
  );
  const stored = (
    await as(1, () => rpc("list_laboratory", ["CARE", patient, 0]))
  )[0];
  assert.ok(stored.requested_tests.includes("35510-10 · S - TSH"));
  assert.ok(!stored.requested_tests.includes("FORGED"));
  assert.equal(stored.catalog_details.specimens[0].code, "00");
  await assert.rejects(
    as(1, () =>
      rpc("order_laboratory", [
        patient,
        {
          laboratory_institution_id: org,
          priority: "REGULAR",
          catalog_order_codes: ["VKK"],
        },
        id(9701),
      ]),
    ),
    /Unknown laboratory catalog/,
  );
  await as(6, () => rpc("set_lab_order_status", [order, 1, "IN_PROGRESS", ""]));
  await db.exec("set role service_role");
  await rpc("configure_notification_delivery", [true]);
  await db.exec("reset role");
  await db.query(
    "update patients set user_id=null,email='fictional@example.test' where id=$1",
    [patient],
  );
  const result = await as(6, () =>
    rpc("publish_laboratory_result", [
      order,
      null,
      {
        sampled_at: new Date().toISOString(),
        parameters: [
          {
            code: "1-2170010",
            catalog_list: "2.2.31",
            name: "FORGED",
            unit: "FORGED",
            value: "2.4",
          },
          {
            code: "1-2159010",
            catalog_list: "2.2.31",
            name: "FORGED",
            value_kind: "TEXT",
            text_value: "Izmišljeni tekst napomene",
          },
        ],
      },
    ]),
  );
  const params = (
    await db.query(
      "select code,name,value,text_value,unit from laboratory_parameters where result_id=$1 order by code",
      [result],
    )
  ).rows;
  assert.equal(params[1].name, "S - TSH");
  assert.equal(params[1].unit, "mIU/L");
  assert.equal(params[0].value, null);
  assert.equal(params[0].text_value, "Izmišljeni tekst napomene");
  const attachment = (
    await db.query(
      "select payload from private.document_email_outbox where laboratory_result_id=$1",
      [result],
    )
  ).rows[0].payload;
  assert.equal(
    attachment.layout.laboratoryRows.find((r) => r.code === "1-2159010").value,
    "Izmišljeni tekst napomene",
  );
  const trend = await as(1, () => rpc("laboratory_trend_catalog", [patient]));
  assert.ok(!trend.some((t) => t.code === "1-2159010"));
  assert.ok(trend.some((t) => t.code === "1-2170010"));
  await assert.rejects(
    as(1, () =>
      rpc("publish_laboratory_result", [
        order,
        result,
        {
          sampled_at: new Date().toISOString(),
          correction_reason: "Testna izmjena",
          parameters: [],
        },
      ]),
    ),
    /Forbidden/,
  );
  const future = new Date();
  future.setUTCDate(future.getUTCDate() + 14 + ((8 - future.getUTCDay()) % 7));
  const day = future.toISOString().slice(0, 10);
  const slots = await as(1, () =>
    rpc("priority_laboratory_slots", [patient, service, [tsh.id], day, day]),
  );
  assert.equal(slots.length, 48);
  const booking = await as(1, () =>
    rpc("book_priority_laboratory", [
      patient,
      service,
      slots[0].starts_at,
      null,
      { referral_code: "A3", reason: "Testna indikacija", expires_on: day },
      "Testni prioritet",
      id(9702),
      [tsh.id],
      "VENIPUNCTURE",
      ["01"],
    ]),
  );
  const snapshot = (
    await as(1, () => rpc("list_hospital_bookings", ["CARE", patient, 0]))
  )[0].laboratory_details;
  assert.equal(snapshot.tests[0].catalog_list, "2.2.30");
  assert.equal(snapshot.specimens[0].code, "01");
  assert.equal(snapshot.procedure_code, "");
  assert.deepEqual(
    await as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        slots[0].starts_at,
        null,
        { referral_code: "A3", reason: "Testna indikacija", expires_on: day },
        "Testni prioritet",
        id(9702),
        [tsh.id],
        "VENIPUNCTURE",
        ["01"],
      ]),
    ),
    booking,
  );
  await assert.rejects(
    as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        slots[1].starts_at,
        null,
        { referral_code: "A3", reason: "Testna indikacija", expires_on: day },
        "Testni prioritet",
        id(9703),
        [tsh.id],
        "VENIPUNCTURE",
        ["INVALID"],
      ]),
    ),
    /Unknown laboratory catalog/,
  );
  console.log(
    "PASS 43 order codes (40 initially bookable), 113 result codes, 11 specimens, authoritative names/units, qualitative findings, numeric trends, booking snapshots, retries and access control.",
  );
} finally {
  await db.close();
}

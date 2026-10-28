import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
import {
  medicalCatalogData,
  listImportSql,
  codesImportSql,
} from "./lib/medical-catalog-import.mjs";
const { db, as, rpc, id, org, patient } = await workflowFixture();
try {
  const lists = (await medicalCatalogData()).lists.filter(
    (l) => l.id === "2.2.18",
  );
  await db.exec(listImportSql(lists));
  await db.exec(
    codesImportSql(
      lists.flatMap((l) => l.entries.map((e) => ({ ...e, list_id: l.id }))),
    ),
  );
  await db.query(
    "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
    [id(6), org],
  );
  const makeOrder = (n) =>
    as(1, () =>
      rpc("order_laboratory", [
        patient,
        {
          laboratory_institution_id: org,
          requested_tests: "Izmišljene pretrage",
          priority: "REGULAR",
        },
        id(n),
      ]),
    );
  const order = await makeOrder(13001),
    other = await makeOrder(13002);
  const list = (o = order, code = "") =>
    as(6, () => rpc("list_laboratory_samples", [o, code]));
  const create = (code, key, replacement = null) =>
    as(6, () =>
      rpc("create_laboratory_sample", [order, code, id(key), replacement]),
    );
  const change = (sample, version, status, reason = "") =>
    as(6, () =>
      rpc("change_laboratory_sample", [sample, version, status, reason]),
    );
  const advance = async (stage) => {
    const o = (
      await db.query("select version from laboratory_orders where id=$1", [
        order,
      ])
    ).rows[0];
    return as(6, () =>
      rpc("advance_laboratory_workflow", [
        "ORDER",
        order,
        o.version,
        stage,
        "Neispravan testni uzorak",
      ]),
    );
  };
  for (const n of [0, 1, 2, 3, 5]) {
    await assert.rejects(
      as(n, () => rpc("list_laboratory_samples", [order])),
      /Forbidden|permission denied/,
    );
    await assert.rejects(
      as(n, () =>
        rpc("create_laboratory_sample", [order, "00", id(13100 + n)]),
      ),
      /Forbidden|permission denied/,
    );
  }
  console.log("PASS sample endpoints enforce clinical laboratory roles");
  await assert.rejects(create("00", 13003), /zaprimite pacijenta/);
  await advance("ARRIVED");
  await assert.rejects(create("FORGED", 13003), /šifrarnika/);
  const first = await create("00", 13003);
  assert.equal(await create("00", 13003), first);
  await assert.rejects(create("07", 13003), /Request changed/);
  const second = await create("07", 13004);
  const rows = (await list()).items;
  assert.equal(rows.length, 2);
  assert.equal(rows.find((s) => s.id === first).specimen_name, "Kapilarna krv");
  assert.notEqual(rows[0].code, rows[1].code);
  console.log(
    "PASS canonical specimen types and idempotent unique sample labels",
  );
  const code = rows.find((s) => s.id === first).code;
  assert.equal(
    (await list(order, " " + code.toLowerCase() + " ")).items.length,
    1,
  );
  assert.equal((await list(other, code)).items.length, 0);
  assert.equal(
    (await as(6, () => rpc("laboratory_sample_label", [first]))).items[0].code,
    code,
  );
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from audit_logs where action='LAB_SAMPLE_LABEL_DOWNLOADED' and entity_id=$1",
        [first],
      )
    ).rows[0].n,
    1,
  );
  console.log(
    "PASS scanning is restricted to the current request and label downloads are audited",
  );
  await advance("COLLECTED");
  await assert.rejects(advance("PROCESSING"), /moraju biti zaprimljeni/);
  await change(first, 1, "ACCEPTED");
  await assert.rejects(
    change(first, 1, "REJECTED", "Neispravan testni uzorak"),
    /Sample changed/,
  );
  await assert.rejects(
    change(first, 2, "REJECTED", ""),
    /missing rejection reason/,
  );
  await change(first, 2, "REJECTED", "Neispravan testni uzorak");
  const replacement = await create("00", 13005, first);
  assert.equal(await create("00", 13005, first), replacement);
  await assert.rejects(create("07", 13006, first), /Invalid replacement/);
  await change(replacement, 1, "ACCEPTED");
  await change(second, 1, "ACCEPTED");
  await advance("PROCESSING");
  const old = (await list()).items.find((s) => s.id === first);
  assert.equal(old.status, "REJECTED");
  assert.equal(old.replaced, true);
  assert.equal(old.history.length, 3);
  await assert.rejects(
    as(6, () => rpc("laboratory_sample_label", [first])),
    /ponovnu uporabu/,
  );
  console.log(
    "PASS receipt, rejection reasons, replacement history and processing guard",
  );
  await assert.rejects(
    change(second, 2, "REJECTED", "Neispravan uzorak"),
    /u obradi/,
  );
  await advance("RECOLLECT");
  await advance("COLLECTED");
  await assert.rejects(advance("PROCESSING"), /moraju biti zaprimljeni/);
  const repeat = await create("00", 13007);
  assert.equal(
    (await list()).items.find((s) => s.id === repeat).collection_round,
    2,
  );
  await assert.rejects(advance("PROCESSING"), /moraju biti zaprimljeni/);
  await change(repeat, 1, "ACCEPTED");
  await advance("PROCESSING");
  const version = (
    await db.query("select version from laboratory_orders where id=$1", [order])
  ).rows[0].version;
  await as(6, () =>
    rpc("publish_laboratory_result", [
      order,
      null,
      {
        expected_order_version: version,
        sampled_at: new Date().toISOString(),
        parameters: [{ code: "TEST", name: "Test", value: "1", unit: "" }],
      },
    ]),
  );
  await assert.rejects(create("00", 13008), /zaključen/);
  console.log(
    "PASS recollection uses a new round and completed work is locked",
  );
  await assert.rejects(
    as(6, () => db.query("select * from laboratory_samples")),
    /permission denied/,
  );
  await assert.rejects(
    db.query(
      "update laboratory_sample_label_events set reason='forged' where sample_id=$1",
      [first],
    ),
    /immutable/,
  );
  console.log(
    "PASS sample history is immutable and browser table access denied",
  );
} finally {
  await db.close();
}

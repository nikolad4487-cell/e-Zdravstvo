import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
const { db, as, rpc, id, org, patient, otherDoc } = await workflowFixture();
let checks = 0;
async function check(name, fn) {
  await fn();
  checks++;
  console.log("PASS " + name);
}
try {
  await db.query(
    "insert into user_roles(user_id,role,institution_id) values($1,'LAB_TECHNICIAN',$2)",
    [id(6), org],
  );
  const dept = await as(5, () =>
    rpc("save_hospital_department", [null, org, "Laboratorij", 15, true]),
  );
  const service = await as(5, () =>
    rpc("create_hospital_laboratory", [
      dept,
      otherDoc,
      "Testni laboratorij",
      "Laboratorij",
      "Prizemlje",
      "",
      "",
    ]),
  );
  const lab = (
    await as(1, () => rpc("priority_hospital_context", [false]))
  ).services.find((s) => s.id === service);
  const test = lab.laboratory_tests.find((t) => t.code === "LOCAL-ROUTINE");
  const day = (
    await db.query(
      "select ((now() at time zone 'Europe/Zagreb')::date+14)::text d",
    )
  ).rows[0].d;
  // Select the next available weekday from the fictional service.
  const to = (await db.query("select ($1::date+7)::text d", [day])).rows[0].d;
  const slots = await as(1, () =>
    rpc("priority_laboratory_slots", [patient, service, [test.id], day, to]),
  );
  const expires = slots[0].starts_at.slice(0, 10);
  const booking = (
    await as(1, () =>
      rpc("book_priority_laboratory", [
        patient,
        service,
        slots[0].starts_at,
        null,
        {
          referral_code: "A3",
          reason: "Izmišljena testna indikacija",
          expires_on: expires,
        },
        "Izmišljeno prioritetno naručivanje",
        id(8001),
        [test.id],
        "VENIPUNCTURE",
      ]),
    )
  ).booking_id;
  const future = (
    await db.query(
      "select (starts_at at time zone 'Europe/Zagreb')::date::text as work_day from hospital_slots where id=(select slot_id from hospital_bookings where id=$1)",
      [booking],
    )
  ).rows[0].work_day;
  const list = (day, stage = null, search = "", page = 0) =>
    as(6, () => rpc("laboratory_worklist", [day, null, search, stage, page]));
  let item = (await list(future)).items[0];
  const advance = (stage, reason = "", entry = item) =>
    as(6, () =>
      rpc("advance_laboratory_workflow", [
        entry.source_kind,
        entry.source_id,
        entry.version,
        stage,
        reason,
      ]),
    );
  await check(
    "only laboratory staff can read or change the worklist",
    async () => {
      for (const user of [0, 1, 2, 3, 4, 5]) {
        await assert.rejects(
          as(user, () => rpc("laboratory_worklist", [future])),
          /Forbidden|permission denied/,
        );
        await assert.rejects(
          as(user, () =>
            rpc("advance_laboratory_workflow", [
              "BOOKING",
              booking,
              item.version,
              "ARRIVED",
              "",
            ]),
          ),
          /Forbidden|permission denied/,
        );
      }
    },
  );
  await check(
    "future arrival and skipped sample collection are rejected",
    async () => {
      await assert.rejects(advance("ARRIVED"), /before the booked day/);
    },
  );
  // Move the fictional slot to today to exercise arrival without altering production data.
  await db.query(
    "update hospital_slots set starts_at=((now() at time zone 'Europe/Zagreb')::date+time '08:00') at time zone 'Europe/Zagreb' where id=(select slot_id from hospital_bookings where id=$1)",
    [booking],
  );
  const today = (
    await db.query("select (now() at time zone 'Europe/Zagreb')::date::text d")
  ).rows[0].d;
  item = (await list(today)).items[0];
  const refresh = async () =>
    (item = (await list(today)).items.find((i) => i.source_id === booking));
  await check(
    "list filters by appointment day, search and stage before pagination",
    async () => {
      assert.equal((await list(future)).total, 0);
      assert.equal((await list(today)).total, 1);
      assert.deepEqual(
        (await list(today)).institutions.map((i) => i.id),
        [org],
      );
      assert.equal((await list(today, "PROCESSING")).total, 0);
      assert.equal((await list(today, null, "absent")).total, 0);
      assert.equal((await list(today, null, "Testna")).total, 1);
      assert.equal(item.order_id, null);
      assert.equal(item.stage, "EXPECTED");
      await assert.rejects(advance("COLLECTED"), /Receive the patient/);
    },
  );
  let order;
  await check(
    "arrival atomically creates one linked request with booking test snapshots",
    async () => {
      const previous = item;
      order = await advance("ARRIVED");
      await assert.rejects(
        advance("ARRIVED", "", previous),
        /changed|transition/,
      );
      await refresh();
      assert.equal(item.stage, "ARRIVED");
      assert.equal(item.order_id, order);
      assert.equal(item.history.length, 1);
      assert.equal(
        (
          await db.query(
            "select count(*)::int n from laboratory_orders where hospital_booking_id=$1",
            [booking],
          )
        ).rows[0].n,
        1,
      );
      const stored = (
        await db.query("select * from laboratory_orders where id=$1", [order])
      ).rows[0];
      assert.equal(
        stored.doctor_id,
        (
          await db.query(
            "select referring_doctor_id from hospital_bookings where id=$1",
            [booking],
          )
        ).rows[0].referring_doctor_id,
      );
      assert.equal(stored.catalog_details.orders[0].code, test.code);
      assert.ok(stored.requested_tests.includes(test.name));
      assert.equal(
        (
          await db.query("select status from hospital_bookings where id=$1", [
            booking,
          ])
        ).rows[0].status,
        "ARRIVED",
      );
    },
  );
  await check("same institution membership is required", async () => {
    const other = id(8800);
    await db.query(
      "insert into institutions(id,name,code) values($1,'Drugi testni laboratorij','OTHERLAB')",
      [other],
    );
    await db.query(
      "insert into institution_users(institution_id,user_id) values($1,$2)",
      [other, id(6)],
    );
    await db.query(
      "update user_roles set institution_id=$1 where user_id=$2 and role='LAB_TECHNICIAN'",
      [other, id(6)],
    );
    assert.equal((await list(today)).total, 0);
    await assert.rejects(advance("COLLECTED"), /Forbidden/);
    await db.query(
      "update user_roles set institution_id=$1 where user_id=$2 and role='LAB_TECHNICIAN'",
      [org, id(6)],
    );
  });
  await check(
    "legacy status RPC cannot bypass collection for a tracked patient",
    async () => {
      await assert.rejects(
        as(6, () =>
          rpc("set_lab_order_status", [order, item.version, "IN_PROGRESS", ""]),
        ),
        /Collect the sample/,
      );
      await assert.rejects(
        advance("PROCESSING"),
        /Invalid specimen transition/,
      );
    },
  );
  await check(
    "collection records time and protects optimistic concurrency",
    async () => {
      const old = item;
      await advance("COLLECTED");
      await refresh();
      assert.equal(item.attempt, 1);
      assert.equal(item.stage, "COLLECTED");
      assert.ok(
        (
          await db.query(
            "select sample_collected_at from laboratory_orders where id=$1",
            [order],
          )
        ).rows[0].sample_collected_at,
      );
      await assert.rejects(advance("PROCESSING", "", old), /Work item changed/);
    },
  );
  await check(
    "recollection requires a reason and preserves the previous attempt",
    async () => {
      await assert.rejects(
        advance("RECOLLECT", ""),
        /missing recollection reason/,
      );
      await advance("PROCESSING");
      await refresh();
      assert.equal(item.stage, "PROCESSING");
      await advance("RECOLLECT", "Neispravan testni uzorak");
      await refresh();
      assert.equal(item.stage, "RECOLLECT");
      assert.equal(item.attempt, 1);
      const data = {
        expected_order_version: item.version,
        sampled_at: new Date().toISOString(),
        summary: "Test",
        parameters: [
          {
            code: "TEST",
            name: "Test",
            value: "2",
            unit: "",
            reference_low: "",
            reference_high: "",
          },
        ],
      };
      await assert.rejects(
        as(6, () => rpc("publish_laboratory_result", [order, null, data])),
        /must be in progress/,
      );
      await advance("COLLECTED");
      await refresh();
      assert.equal(item.attempt, 2);
      await advance("PROCESSING");
      await refresh();
      assert.ok(
        item.history.some((e) => e.reason === "Neispravan testni uzorak"),
      );
    },
  );
  await check(
    "publication finishes the sample workflow through the existing result transaction",
    async () => {
      await assert.rejects(
        as(6, () =>
          rpc("publish_laboratory_result", [
            order,
            null,
            { expected_order_version: item.version - 1 },
          ]),
        ),
        /Order changed/,
      );
      await as(6, () =>
        rpc("publish_laboratory_result", [
          order,
          null,
          {
            expected_order_version: item.version,
            sampled_at: new Date().toISOString(),
            summary: "Izmišljeni nalaz",
            parameters: [
              {
                code: "TEST",
                name: "Test",
                value: "2",
                unit: "",
                reference_low: "",
                reference_high: "",
              },
            ],
          },
        ]),
      );
      await refresh();
      assert.equal(item.stage, "COMPLETED");
      assert.equal(item.history[0].status, "COMPLETED");
      await assert.rejects(
        advance("RECOLLECT", "Novi testni uzorak"),
        /Booking is closed/,
      );
      const patientOrders = await as(3, () =>
        rpc("search_laboratory", [
          "PERSONAL",
          null,
          0,
          "",
          null,
          null,
          null,
          null,
        ]),
      );
      assert.ok(
        patientOrders.some((o) => o.id === order && o.results.length === 1),
      );
    },
  );
  await check(
    "legacy requests remain visible without duplicating linked bookings",
    async () => {
      const request = await as(1, () =>
        rpc("order_laboratory", [
          patient,
          {
            laboratory_institution_id: org,
            requested_tests: "Dodatna testna pretraga",
            priority: "REGULAR",
          },
          id(8002),
        ]),
      );
      const all = await list(today);
      assert.equal(all.total, 2);
      assert.equal(all.items.filter((i) => i.source_id === booking).length, 1);
      assert.equal(all.items.filter((i) => i.source_id === request).length, 1);
      const entry = all.items.find((i) => i.source_id === request);
      await advance("ARRIVED", "", entry);
      await assert.rejects(
        as(6, () =>
          rpc("advance_laboratory_workflow", [
            "ORDER",
            order,
            item.version,
            "COLLECTED",
            "",
          ]),
        ),
        /Forbidden/,
      );
    },
  );
  await check(
    "pagination covers all matching rows and counts the full day",
    async () => {
      await db.query(
        `insert into laboratory_orders(patient_id,doctor_id,laboratory_institution_id,requested_tests,priority,request_id,created_by,created_at,sample_status)
      select $1,$2,$3,case when n<=2 then 'Ciljana pretraga' else 'Straničenje' end,'REGULAR',gen_random_uuid(),$4,'1999-01-01T12:00:00Z',case when n<=2 then 'ARRIVED' else 'EXPECTED' end from generate_series(1,52)n`,
        [patient, otherDoc, org, id(6)],
      );
      const first = await list("1999-01-01"),
        second = await list("1999-01-01", null, "", 1);
      assert.equal(first.total, 52);
      assert.equal(first.items.length, 50);
      assert.equal(second.items.length, 2);
      assert.equal(
        new Set([...first.items, ...second.items].map((i) => i.source_id)).size,
        52,
      );
      const filtered = await list("1999-01-01", "ARRIVED", "Ciljana");
      assert.equal(filtered.total, 2);
      assert.equal(filtered.items.length, 2);
      assert.equal(filtered.counts.ARRIVED, 2);
    },
  );
  await check("inactive membership removes clinical access", async () => {
    await db.query(
      "update institution_users set active=false where institution_id=$1 and user_id=$2",
      [org, id(6)],
    );
    await assert.rejects(list(today), /Forbidden/);
    await db.query(
      "update institution_users set active=true where institution_id=$1 and user_id=$2",
      [org, id(6)],
    );
  });
  await check(
    "filters, append-only history and grants are enforced",
    async () => {
      await assert.rejects(
        as(6, () => rpc("laboratory_worklist", [today, null, "", "FORGED", 0])),
        /Invalid worklist/,
      );
      await assert.rejects(
        as(6, () => rpc("laboratory_worklist", [today, null, "", null, -1])),
        /Invalid worklist/,
      );
      await assert.rejects(
        db.query(
          "update laboratory_sample_events set reason='forged' where order_id=$1",
          [order],
        ),
        /immutable/,
      );
      await assert.rejects(
        as(6, () => db.query("select * from laboratory_sample_events")),
        /permission denied/,
      );
    },
  );
  console.log(`${checks} laboratory worklist integration checks passed`);
} finally {
  await db.close();
}

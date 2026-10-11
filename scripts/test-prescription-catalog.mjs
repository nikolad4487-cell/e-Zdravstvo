import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
import {
  hzzoCatalogData,
  hzzoSourceSql,
  hzzoListSql,
  hzzoCodeSql,
} from "./lib/hzzo-catalog-import.mjs";
const { db, as, rpc, id, patient } = await workflowFixture();
const all = await hzzoCatalogData();
const lists = all.lists.filter((l) => /^HZZO:(OLL|DLL):/.test(l.id));
const sources = all.sources.filter((s) =>
  lists.some((l) => l.source_id === s.source_id),
);
await db.exec(hzzoSourceSql(sources));
await db.exec(hzzoListSql(lists));
const rows = lists.flatMap((l) =>
  l.entries.map((e) => ({ ...e, list_id: l.id })),
);
for (let i = 0; i < rows.length; i += 400)
  await db.exec(hzzoCodeSql(rows.slice(i, i + 400)));
await db.exec("select private.sync_hzzo_medications()");
const eligible = lists
  .filter(
    (l) =>
      !["Popis PSL", "indikacije_smjernice", "legenda"].includes(
        l.metadata.sheet,
      ),
  )
  .flatMap((l) =>
    l.entries.filter((e) =>
      ["R", "RS", "RSf"].includes(
        String(e.metadata.records[0].fields["R/RS"] ?? "").trim(),
      ),
    ),
  );
assert.equal(
  (
    await db.query(
      "select count(*)::int n from medications where catalog_list is not null and active",
    )
  ).rows[0].n,
  eligible.length,
);
const roj = (
  await as(1, () => rpc("search_prescription_medications", ["Rojazol", 0]))
)[0];
assert.equal(roj.catalog_code, "A01AB09 211");
assert.equal(roj.packaging, "gel oral. 2%, 1x40 g");
assert.equal(roj.catalog_metadata.fields["Doplata za orig. pakiranje"], 0.92);
assert.equal(
  (
    await as(1, () =>
      rpc("search_prescription_medications", ["A01AB09 211", 0]),
    )
  )[0].id,
  roj.id,
);
assert.ok(
  (
    await as(1, () => rpc("search_prescription_medications", ["mikonazol", 0]))
  ).some((m) => m.id === roj.id),
);
assert.ok(
  !(
    await as(1, () =>
      rpc("search_prescription_medications", ["A01AB12 451", 0]),
    )
  ).length,
);
const gel = (
  await as(1, () => rpc("search_prescription_medications", ["Gelclair", 0]))
)[0];
assert.equal(gel.catalog_metadata.fields["R/RS"], "RS");
assert.ok(gel.catalog_metadata.guidance.some((g) => g.code === "RA01"));
const first = await as(1, () =>
  rpc("search_prescription_medications", ["", 0]),
);
const second = await as(1, () =>
  rpc("search_prescription_medications", ["", 1]),
);
assert.equal(first.length, 50);
assert.equal(second.length, 50);
assert.ok(!first.some((a) => second.some((b) => a.id === b.id)));
await db.exec("select private.sync_hzzo_medications()");
assert.equal(
  (await as(1, () => rpc("search_prescription_medications", ["Rojazol", 0])))[0]
    .id,
  roj.id,
);
assert.ok(
  !(await as(1, () => rpc("clinical_context"))).medications.some(
    (m) => m.id === roj.id,
  ),
);
await assert.rejects(
  as(0, () => rpc("search_prescription_medications", ["", 0])),
  /permission denied|Forbidden/,
);
await assert.rejects(
  as(1, () => rpc("search_prescription_medications", ["", -1])),
  /Invalid search/,
);
await assert.rejects(
  as(5, () =>
    db.query("update medications set name=$1 where id=$2", ["FORGED", roj.id]),
  ),
  /permission denied|read only/,
);
const input = {
  expires_on: new Date(Date.now() + 86400000 * 30).toISOString().slice(0, 10),
  items: [
    {
      medication_id: roj.id,
      name: "FORGED",
      packaging: "FORGED",
      dosage: "Izmišljeno testno doziranje",
      quantity: 1,
      route: "Lokalno",
      duration: "Test",
      notes: "",
    },
  ],
};
const doc = await as(1, () =>
  rpc("issue_document", [patient, "PRESCRIPTION", input, id(7900)]),
);
const payload = (
  await db.query("select payload from documents where id=$1", [doc])
).rows[0].payload;
assert.equal(payload.details.items[0].name, "Rojazol");
assert.equal(payload.details.items[0].packaging, roj.packaging);
assert.equal(payload.details.items[0].catalog_code, roj.catalog_code);
assert.equal(
  await as(1, () =>
    rpc("issue_document", [patient, "PRESCRIPTION", input, id(7900)]),
  ),
  doc,
);
await assert.rejects(
  as(4, () =>
    rpc("issue_document", [patient, "PRESCRIPTION", input, id(7901)]),
  ),
  /Forbidden/,
);
await db.query("update medications set active=false where id=$1", [roj.id]);
await assert.rejects(
  as(1, () =>
    rpc("issue_document", [patient, "PRESCRIPTION", input, id(7902)]),
  ),
  /Invalid medication/,
);
assert.deepEqual(
  (await db.query("select payload from documents where id=$1", [doc])).rows[0]
    .payload,
  payload,
);
console.log(
  `PASS ${eligible.length} prescription packages from latest OLL/DLL, exact codes and copay, RS guidance, pagination, stable identities, authenticated search, authorized immutable issuance and inactive medicine rejection.`,
);
await db.close();

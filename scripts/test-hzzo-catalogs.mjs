import assert from "node:assert/strict";
import { workflowFixture } from "./lib/workflow-fixture.mjs";
import {
  hzzoCatalogData,
  hzzoSourceSql,
  hzzoListSql,
  hzzoCodeSql,
} from "./lib/hzzo-catalog-import.mjs";
const { db, as, rpc } = await workflowFixture();
const { manifest, sources, lists, codes } = await hzzoCatalogData();
assert.equal(manifest.uploaded_files, 52);
assert.equal(manifest.duplicate_files, 5);
assert.equal(sources.length, 24);
const family = (f) => sources.find((s) => s.family === f);
assert.equal(family("DTP-PZZ").source_date, "2026-08-01");
assert.equal(family("DTP-SKZZ").source_date, "2025-12-05");
assert.equal(family("OLL").source_date, "2026-10-01");
assert.equal(family("DLL").source_date, "2026-10-01");
assert.equal(family("DZO").source_date, null);
assert.equal(family("DZO").status, "UNCONFIRMED");
assert.equal(family("DTS-POSTUPCI").status, "HISTORICAL");
assert.equal(family("ZDRPOS").status, "HISTORICAL");
assert.notEqual(
  family("DTS-POSTUPCI").source_id,
  family("DTS-SKUPINE").source_id,
);
console.log(
  "PASS all supplied files are accounted for, effective dates win, duplicates and undated/legacy sources are distinguished",
);
await db.exec(hzzoSourceSql(sources));
await db.exec(hzzoListSql(lists));
for (let i = 0; i < codes.length; i += 1000)
  await db.exec(hzzoCodeSql(codes.slice(i, i + 1000)));
assert.equal(
  (
    await db.query(
      "select count(*)::int n from medical_codes where list_id like 'HZZO:%'",
    )
  ).rows[0].n,
  manifest.entry_count,
);
const sk = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:DTP-SKZZ", "SK001", 0]),
);
assert.equal(sk[0].code, "SK001");
assert.match(sk[0].name, /Prvi jednostavni pregled/i);
assert.ok(sk[0].metadata.records[0].fields["Cijena (EUR)"] > 0);
const fees = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:DBL", "DBL01", 0]),
);
assert.equal(fees[0].code, "DBL01");
assert.ok(Object.values(fees[0].metadata.records[0].fields).includes(83.72));
console.log(
  "PASS full import and exact procedure/tariff search use the selected edition and retain all source fields",
);
const towns = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:NASELJA", "072150", 0]),
);
assert.equal(towns[0].code, "072150");
assert.equal(towns[0].metadata.records.length, 5);
const institution = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:USTANOVE", "000116866", 0]),
);
assert.equal(institution[0].code, "000116866");
const errs = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:GRESKE-RACUNA", "2", 0]),
);
assert.equal(errs[0].code, "2");
assert.equal(errs[0].metadata.records.length, 10);
assert.equal(
  lists.find((l) => l.id === "HZZO:OLL:indikacije_smjernice").entries.length,
  676,
);
assert.ok(
  lists
    .find((l) => l.id === "HZZO:OLL:indikacije_smjernice")
    .entries.some((e) => e.code === "RN02a"),
);
const guides = await as(1, () =>
  rpc("search_medical_codes", ["HZZO:OLL:indikacije_smjernice", "pa02", 0]),
);
assert.equal(guides[0].code, "pa02");
assert.ok(
  lists
    .find((l) => l.id === "HZZO:DTP-PZZ")
    .source_text.includes("Vrste limita DTP PZZ"),
);
assert.ok(
  lists
    .find((l) => l.id === "HZZO:DTP-SKZZ")
    .source_text.includes("Kontrastno sredstvo"),
);
console.log(
  "PASS leading zeros, lowercase guidance codes, contextual duplicate errors/settlements and tariff footnotes survive extraction",
);
const catalog = await as(1, () => rpc("medical_code_catalogs", []));
assert.equal(
  catalog.lists.filter((l) => l.id.startsWith("HZZO:")).length,
  manifest.catalog_count,
);
const first = await as(1, () =>
    rpc("search_medical_codes", ["HZZO:DTP-SKZZ", "", 0]),
  ),
  second = await as(1, () =>
    rpc("search_medical_codes", ["HZZO:DTP-SKZZ", "", 1]),
  );
assert.equal(first.length, 50);
assert.equal(second.length, 50);
assert.ok(!first.some((f) => second.some((s) => s.code === f.code)));
const doctorCount = (await db.query("select count(*)::int n from doctors"))
  .rows[0].n;
assert.equal(
  (await db.query("select count(*)::int n from institutions")).rows[0].n,
  1,
);
assert.equal(doctorCount, 2);
await db.exec("set role anon");
await assert.rejects(rpc("medical_code_catalogs", []));
await assert.rejects(rpc("search_medical_codes", ["HZZO:DTP-SKZZ", "", 0]));
await assert.rejects(db.query("select * from medical_codes"));
await db.exec("reset role");
await assert.rejects(
  as(1, () => db.query("update medical_code_sources set metadata='{}'")),
);
console.log(
  "PASS paginated authorized reads, protected source mutations, and no automatic institution/doctor creation",
);
await db.close();

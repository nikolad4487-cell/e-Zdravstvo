import {
  medicalCatalogData,
  diagnosisImportSql,
  listImportSql,
  codesImportSql,
  sqlLiteral as q,
} from "./lib/medical-catalog-import.mjs";
const data = await medicalCatalogData(),
  apply = process.argv.includes("--apply");
const codes = data.lists.flatMap((l) =>
  l.entries.map((e) => ({ ...e, list_id: l.id })),
);
if (
  data.diagnoses.length !== data.manifest.mkb.count ||
  new Set(data.diagnoses.map((d) => d.code)).size !== data.diagnoses.length ||
  codes.length !== data.manifest.cezih.entries ||
  data.lists.length !== data.manifest.cezih.lists
)
  throw new Error("Source data integrity check failed");
console.log(
  `Validated ${data.diagnoses.length} MKB codes and ${codes.length} CEZIH codes in ${data.lists.length} lists.`,
);
if (!apply) {
  console.log(
    "Read-only plan; use --apply to import into the configured project.",
  );
  process.exit(0);
}
const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (!/^[a-z0-9]+$/.test(ref) || !process.env.SUPABASE_ACCESS_TOKEN)
  throw new Error("Project credentials missing");
async function query(query) {
  const r = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.SUPABASE_ACCESS_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, read_only: false }),
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!r.ok) throw new Error("Catalog import HTTP " + r.status);
  return r.json();
}
for (const [id, m, expected] of [
  ["HZJZ-MKB", data.manifest.mkb, data.diagnoses.length],
  ["CEZIH-UPLOAD", data.manifest.cezih, codes.length],
])
  await query(
    `insert into public.medical_code_sources(id,file_name,file_sha256,revision,expected_count)values(${q(id)},${q(m.file)},${q(m.sha256)},${q(m.revision ?? "Uploaded HZJZ list")},${expected}) on conflict(id) do update set file_name=excluded.file_name,file_sha256=excluded.file_sha256,revision=excluded.revision,expected_count=excluded.expected_count;`,
  );
for (let start = 0; start < data.lists.length; start += 20)
  await query(listImportSql(data.lists.slice(start, start + 20)));
for (let start = 0; start < codes.length; start += 500)
  await query(codesImportSql(codes.slice(start, start + 500)));
for (let start = 0; start < data.diagnoses.length; start += 1000) {
  await query(diagnosisImportSql(data.diagnoses.slice(start, start + 1000)));
  console.log(
    `MKB imported ${Math.min(start + 1000, data.diagnoses.length)}/${data.diagnoses.length}`,
  );
}
const counts = await query(
  `update public.medical_code_sources set imported_count=case id when 'HZJZ-MKB' then(select count(*) from public.diagnoses where catalog_source='HZJZ-MKB') else(select count(*) from public.medical_codes c join public.medical_code_lists l on l.id=c.list_id where l.source_id='CEZIH-UPLOAD')end,imported_at=now() returning id,expected_count,imported_count;`,
);
if (counts.some((c) => c.expected_count !== c.imported_count))
  throw new Error("Imported counts do not match source");
console.log(counts);

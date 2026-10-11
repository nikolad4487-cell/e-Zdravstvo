import {
  hzzoCatalogData,
  hzzoSourceSql,
  hzzoListSql,
  hzzoCodeSql,
} from "./lib/hzzo-catalog-import.mjs";
import { sqlLiteral as q } from "./lib/medical-catalog-import.mjs";
const { manifest, sources, lists, codes } = await hzzoCatalogData();
console.log(
  `Validated ${sources.length} selected sources, ${lists.length} catalogs, ${codes.length} codes; ${manifest.duplicate_files} identical extra copies excluded.`,
);
if (!process.argv.includes("--apply")) {
  console.log("Read-only plan. Use --apply to import the selected versions.");
  process.exit(0);
}
const ref = new URL(process.env.VITE_SUPABASE_URL).hostname.split(".")[0];
if (!/^[a-z0-9]+$/.test(ref) || !process.env.SUPABASE_ACCESS_TOKEN)
  throw Error("Configured project credentials required");
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
  if (!r.ok) throw Error("HZZO import HTTP " + r.status);
  return r.json();
}
await query(hzzoSourceSql(sources));
await query(hzzoListSql(lists));
for (let i = 0; i < codes.length; i += 400) {
  await query(hzzoCodeSql(codes.slice(i, i + 400)));
  if (i % 2000 === 0 || i + 400 >= codes.length)
    console.log(`Imported ${Math.min(i + 400, codes.length)}/${codes.length}`);
}
// Reference rows are synchronized; issued clinical records remain unchanged.
for (const l of lists) {
  const included = l.entries.map((e) => e.code);
  await query(
    `delete from public.medical_codes where list_id=${q(l.id)} and not(code=any(array[${included.map(q).join(",")}]::text[]));`,
  );
}
const ids = sources.map((s) => q(s.source_id)).join(",");
const result = await query(
  `update public.medical_code_sources s set imported_count=(select count(*) from public.medical_codes c join public.medical_code_lists l on l.id=c.list_id where l.source_id=s.id),imported_at=now() where s.id in(${ids}) returning id,expected_count,imported_count;`,
);
if (result.some((r) => r.expected_count !== r.imported_count))
  throw Error("HZZO imported counts do not match the source");
console.log(
  `Verified ${result.length} sources; ${result.reduce((n, r) => n + r.imported_count, 0)} codes imported.`,
);

await query("select private.sync_hzzo_medications();");
console.log(
  "Prescription medicines synchronized; existing medication identities retained.",
);

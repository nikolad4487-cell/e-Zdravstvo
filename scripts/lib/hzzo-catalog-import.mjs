import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { sqlLiteral as q } from "./medical-catalog-import.mjs";
export async function hzzoCatalogData() {
  const root = new URL("../../data/medical-catalogs/", import.meta.url);
  const lists = JSON.parse(
    gunzipSync(await readFile(new URL("hzzo.json.gz", root))),
  );
  const manifest = JSON.parse(
    await readFile(new URL("hzzo-manifest.json", root), "utf8"),
  );
  const sources = manifest.files.filter((s) => s.disposition === "SELECTED");
  const codes = lists.flatMap((l) =>
    l.entries.map((e) => ({ ...e, list_id: l.id })),
  );
  if (
    manifest.uploaded_files !== manifest.files.length ||
    sources.length !== manifest.selected_files ||
    lists.length !== manifest.catalog_count ||
    codes.length !== manifest.entry_count ||
    new Set(lists.map((l) => l.id)).size !== lists.length ||
    new Set(codes.map((c) => c.list_id + "\0" + c.code)).size !== codes.length
  )
    throw new Error("HZZO source integrity check failed");
  for (const s of sources) {
    const own = lists.filter((l) => l.source_id === s.source_id);
    if (
      own.reduce((n, l) => n + l.entries.length, 0) !== s.entry_count ||
      own.some((l) => l.metadata.source_date !== s.source_date)
    )
      throw new Error("HZZO source/version mismatch");
    if (s.source_date && s.source_date > manifest.as_of)
      throw new Error("Future reference cannot be selected");
  }
  return { lists, manifest, sources, codes };
}
export function hzzoSourceSql(sources) {
  return `insert into public.medical_code_sources(id,file_name,file_sha256,revision,expected_count,metadata)
  select r->>'source_id',r->>'file',r->>'sha256',coalesce(r->>'source_date','Datum nije potvrđen'),(r->>'entry_count')::int,r-'file'-'sha256'-'source_id'-'entry_count'
  from jsonb_array_elements(${q(JSON.stringify(sources))}::jsonb)r
  on conflict(id) do update set revision=excluded.revision,expected_count=excluded.expected_count,metadata=excluded.metadata;`;
}
export function hzzoListSql(lists) {
  return `insert into public.medical_code_lists(id,source_id,name,oid,source_text,external_only,metadata)
  select r->>'id',r->>'source_id',r->>'name',r->>'oid',r->>'source_text',false,r->'metadata' from jsonb_array_elements(${q(JSON.stringify(lists.map(({ entries, ...l }) => l)))}::jsonb)r
  on conflict(id) do update set source_id=excluded.source_id,name=excluded.name,source_text=excluded.source_text,external_only=excluded.external_only,metadata=excluded.metadata;`;
}
export function hzzoCodeSql(rows) {
  return `insert into public.medical_codes(list_id,code,name,description,metadata)
  select r->>'list_id',r->>'code',r->>'name',r->>'description',r->'metadata' from jsonb_array_elements(${q(JSON.stringify(rows))}::jsonb)r
  on conflict(list_id,code) do update set name=excluded.name,description=excluded.description,metadata=excluded.metadata;`;
}

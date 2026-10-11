import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
export const sqlLiteral = (value) =>
  "'" + String(value).replaceAll("'", "''") + "'";
export async function medicalCatalogData() {
  const root = new URL("../../data/medical-catalogs/", import.meta.url);
  return {
    diagnoses: JSON.parse(
      gunzipSync(await readFile(new URL("mkb.json.gz", root))),
    ),
    lists: JSON.parse(await readFile(new URL("cezih.json", root), "utf8")),
    manifest: JSON.parse(
      await readFile(new URL("manifest.json", root), "utf8"),
    ),
  };
}
export function diagnosisImportSql(rows) {
  return `insert into public.diagnoses(code,name,coding_system,catalog_source,catalog_metadata)
 select r->>'code',r->>'name','MKB-10-HZJZ','HZJZ-MKB',r-'code'-'name' from jsonb_array_elements(${sqlLiteral(JSON.stringify(rows))}::jsonb)r
 on conflict(coding_system,code) do update set name=excluded.name,catalog_source=excluded.catalog_source,catalog_metadata=excluded.catalog_metadata;`;
}
export function listImportSql(lists) {
  return `insert into public.medical_code_lists(id,source_id,name,oid,source_text,external_only)
 select r->>'id','CEZIH-UPLOAD',r->>'name',r->>'oid',r->>'source_text',(r->>'external_only')::boolean from jsonb_array_elements(${sqlLiteral(JSON.stringify(lists))}::jsonb)r
 on conflict(id) do update set name=excluded.name,oid=excluded.oid,source_text=excluded.source_text,external_only=excluded.external_only;`;
}
export function codesImportSql(rows) {
  return `insert into public.medical_codes(list_id,code,name,description,source_page)
 select r->>'list_id',r->>'code',r->>'name',r->>'description',(r->>'page')::integer from jsonb_array_elements(${sqlLiteral(JSON.stringify(rows))}::jsonb)r
 on conflict(list_id,code) do update set name=excluded.name,description=excluded.description,source_page=excluded.source_page;`;
}

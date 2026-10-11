export function migrationSql(source, version, name) {
  if (!/^\s*begin\s*;/i.test(source) || !/commit\s*;\s*$/i.test(source))
    throw new Error("Explicit migration transaction required.");
  const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
  const record = `insert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(version)},${quote(name)},ARRAY[${quote(source)}]::text[]);\nnotify pgrst,'reload schema';\ncommit;`;
  // A callback preserves SQL dollars ($$, $') literally in the history text.
  return source.replace(/commit\s*;\s*$/i, () => record);
}

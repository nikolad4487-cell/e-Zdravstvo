begin;
-- Public readiness metadata only: no identities or clinical information.
create function public.application_schema_version() returns integer
language sql immutable set search_path='' as $$select 20261004$$;
revoke all on function public.application_schema_version() from public;
grant execute on function public.application_schema_version() to anon,authenticated,service_role;
commit;

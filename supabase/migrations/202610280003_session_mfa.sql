begin;
-- The Auth service remains the authority for factor enrollment and JWT assurance.
create function private.mfa_challenge_required() returns boolean language plpgsql stable security definer set search_path='' as $$
declare required boolean;
begin
 if auth.uid() is null or coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb->>'aal'='aal2' then return false;end if;
 if to_regclass('auth.mfa_factors') is null then return false;end if;
 execute 'select exists(select 1 from auth.mfa_factors where user_id=$1 and status=''verified'')' into required using auth.uid();
 return required;
end $$;
revoke all on function private.mfa_challenge_required() from public,anon;
grant execute on function private.mfa_challenge_required() to authenticated;
create function public.enforce_session_mfa() returns void language plpgsql security definer set search_path='' as $$begin
 if private.mfa_challenge_required() then raise exception 'Potrebna je potvrda prijave autentifikatorom.' using errcode='42501';end if;
end $$;
revoke all on function public.enforce_session_mfa() from public;
grant execute on function public.enforce_session_mfa() to anon,authenticated,service_role;
-- A restrictive policy also protects Realtime/direct table reads using an AAL1 JWT.
do $$declare t record;prior_hook text;
begin
 for t in select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity loop
  execute format('create policy verified_mfa_session on public.%I as restrictive for all to authenticated using((select not private.mfa_challenge_required())) with check((select not private.mfa_challenge_required()))',t.relname);
 end loop;
 if exists(select 1 from pg_roles where rolname='authenticator') then
  select substring(v from length('pgrst.db_pre_request=')+1) into prior_hook from pg_db_role_setting s join pg_roles r on r.oid=s.setrole cross join lateral unnest(s.setconfig)v where r.rolname='authenticator' and v like 'pgrst.db_pre_request=%' limit 1;
  if coalesce(prior_hook,'') not in('','public.enforce_session_mfa') then raise exception 'Existing API pre-request hook requires explicit integration';end if;
  execute 'alter role authenticator set pgrst.db_pre_request=''public.enforce_session_mfa''';
 end if;
end $$;
notify pgrst,'reload config';
notify pgrst,'reload schema';
commit;

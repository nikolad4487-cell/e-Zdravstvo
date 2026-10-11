begin;
create table public.patient_guardians(
  id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),guardian_user_id uuid not null references public.profiles(id),
  legal_basis text not null check(legal_basis in ('PARENT','COURT_APPOINTED')),
  verification_reference text not null check(length(trim(verification_reference)) between 5 and 200),
  expires_at timestamptz not null,granted_by uuid not null references public.profiles(id),granted_at timestamptz not null default now(),
  revoked_at timestamptz,revoked_by uuid references public.profiles(id),revocation_reason text,
  unique(patient_id,guardian_user_id)
);
alter table public.patient_guardians enable row level security;
revoke all on public.patient_guardians from anon,authenticated;
create trigger audit_change after insert or update on public.patient_guardians for each row execute function private.audit_change();
create trigger no_delete before delete on public.patient_guardians for each row execute function private.no_clinical_delete();
create function private.can_read_as_guardian(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role('PATIENT') and private.patient_allows(pid,auth.uid()) and exists(
  select 1 from public.patient_guardians g join public.patients p on p.id=g.patient_id
  where g.patient_id=pid and g.guardian_user_id=auth.uid() and g.revoked_at is null and g.expires_at>now() and p.archived_at is null
    and p.user_id is distinct from auth.uid() and p.birth_date>((now() at time zone 'Europe/Zagreb')::date-interval '18 years')::date
 )
$$;
create or replace function private.can_read_patient(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.patients p where p.id=pid and p.archived_at is null and (
 (p.user_id=auth.uid() and private.has_role('PATIENT')) or private.can_read_as_guardian(pid) or (private.patient_allows(pid,auth.uid()) and (
 exists(select 1 from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=p.id and pd.revoked_at is null and d.active and d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id)) or
 exists(select 1 from public.patient_staff ps where ps.patient_id=p.id and ps.user_id=auth.uid() and ps.revoked_at is null and private.has_role('NURSE',ps.institution_id))))));
$$;
create function public.grant_guardian_access(patient_id uuid,guardian_user_id uuid,legal_basis text,verification_reference text,expires_on date)
returns void language plpgsql security definer set search_path='' as $$
declare p public.patients;expiry timestamptz;
begin
  if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
  select * into p from public.patients where id=patient_id for update;
  expiry:=(expires_on+1)::timestamp at time zone 'Europe/Zagreb';
  if p.id is null or p.archived_at is not null or p.user_id=guardian_user_id or expires_on is null or expiry<=now()
    or expiry>((p.birth_date+interval '18 years')::timestamp at time zone 'Europe/Zagreb')
    or legal_basis is null or legal_basis not in ('PARENT','COURT_APPOINTED') or length(trim(coalesce(verification_reference,''))) not between 5 and 200
    or not exists(select 1 from public.user_roles r join public.profiles u on u.id=r.user_id where r.user_id=guardian_user_id and r.role='PATIENT' and r.institution_id is null and not u.must_change_password)
  then raise exception 'Invalid verified guardian assignment';end if;
  insert into public.patient_guardians(patient_id,guardian_user_id,legal_basis,verification_reference,expires_at,granted_by)
  values(patient_id,guardian_user_id,legal_basis,trim(verification_reference),expiry,auth.uid())
  on conflict on constraint patient_guardians_patient_id_guardian_user_id_key do update set legal_basis=excluded.legal_basis,verification_reference=excluded.verification_reference,expires_at=excluded.expires_at,granted_by=auth.uid(),granted_at=now(),revoked_at=null,revoked_by=null,revocation_reason=null;
end $$;
create function public.revoke_guardian_access(assignment_id uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
  if length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Revocation reason required';end if;
  update public.patient_guardians set revoked_at=now(),revoked_by=auth.uid(),revocation_reason=trim(reason) where id=assignment_id and revoked_at is null;
end $$;
create function public.admin_patient_guardians(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
  return(select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',p.first_name||' '||p.last_name,'email',u.email,'legal_basis',g.legal_basis,'expires_at',g.expires_at,'revoked_at',g.revoked_at) order by g.granted_at desc),'[]') from public.patient_guardians g join public.profiles p on p.id=g.guardian_user_id join auth.users u on u.id=p.id where g.patient_id=admin_patient_guardians.patient_id);
end $$;
create function public.my_guardian_patients(page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
  if page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid page';end if;
  return(select coalesce(jsonb_agg(x order by x.last_name,x.first_name,x.id),'[]') from(
    select p.id,p.first_name,p.last_name,p.birth_date,p.patient_number,g.expires_at
    from public.patient_guardians g join public.patients p on p.id=g.patient_id where g.guardian_user_id=auth.uid() and private.can_read_as_guardian(p.id)
    order by p.last_name,p.first_name,p.id limit 50 offset page_number*50)x);
end $$;
create function public.guardian_patient_record(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_read_as_guardian(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
  result:=public.get_patient_chart(patient_id)||jsonb_build_object('can_write',false);
  perform private.audit_event('GUARDIAN_RECORD_VIEWED','patients',patient_id);return result;
end $$;
revoke all on function private.can_read_as_guardian(uuid) from public,anon,authenticated;
revoke all on function public.grant_guardian_access(uuid,uuid,text,text,date),public.revoke_guardian_access(uuid,text),public.admin_patient_guardians(uuid),public.my_guardian_patients(integer),public.guardian_patient_record(uuid) from public,anon;
grant execute on function public.grant_guardian_access(uuid,uuid,text,text,date),public.revoke_guardian_access(uuid,text),public.admin_patient_guardians(uuid),public.my_guardian_patients(integer),public.guardian_patient_record(uuid) to authenticated;
commit;

begin;
create table public.doctor_working_hours(
  id uuid not null unique default gen_random_uuid(),
  doctor_id uuid not null references public.doctors(id),weekday integer not null check(weekday between 1 and 7),
  starts_at time not null,ends_at time not null,primary key(doctor_id,weekday),check(ends_at>starts_at),
  updated_at timestamptz not null default now(),updated_by uuid not null references public.profiles(id)
);
create table public.doctor_absences(
  id uuid primary key default gen_random_uuid(),doctor_id uuid not null references public.doctors(id),
  starts_at timestamptz not null,ends_at timestamptz not null,check(ends_at>starts_at),
  substitute_id uuid references public.doctors(id),reason text not null check(length(trim(reason)) between 5 and 500),
  created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
  cancelled_at timestamptz,cancelled_by uuid references public.profiles(id),check(substitute_id is distinct from doctor_id)
);
create index doctor_absence_period on public.doctor_absences(doctor_id,starts_at,ends_at) where cancelled_at is null;
alter table public.doctor_working_hours enable row level security;
alter table public.doctor_absences enable row level security;
revoke all on public.doctor_working_hours,public.doctor_absences from anon,authenticated;
create trigger audit_change after insert or update or delete on public.doctor_working_hours for each row execute function private.audit_change();
create trigger audit_change after insert or update on public.doctor_absences for each row execute function private.audit_change();
create trigger no_delete before delete on public.doctor_absences for each row execute function private.no_clinical_delete();
create function private.can_manage_schedule(did uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.doctors d where d.id=did and d.active and
    ((d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id)) or private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',d.institution_id)))
$$;
create function public.doctor_schedule() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not (private.has_role('DOCTOR') or private.has_role('INSTITUTION_ADMIN') or private.has_role('SYSTEM_ADMIN')) then raise exception 'Forbidden' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'institution',i.name,'institution_id',i.id,
    'hours',(select coalesce(jsonb_agg(h order by h.weekday),'[]') from public.doctor_working_hours h where h.doctor_id=d.id),
    'absences',(select coalesce(jsonb_agg(x order by x.starts_at desc),'[]') from (
      select a.id,a.starts_at,a.ends_at,a.reason,a.cancelled_at,s.display_name substitute_name
      from public.doctor_absences a left join public.doctors s on s.id=a.substitute_id
      where a.doctor_id=d.id and a.ends_at>=now() order by a.starts_at desc limit 200)x)
  ) order by d.display_name,d.id),'[]') into result from public.doctors d join public.institutions i on i.id=d.institution_id where private.can_manage_schedule(d.id);
  perform private.audit_event('STAFF_SCHEDULE_VIEWED','doctors',null);return result;
end $$;
create function public.set_doctor_hours(doctor_id uuid,weekday integer,starts_at time,ends_at time,enabled boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.can_manage_schedule(doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if weekday is null or weekday not between 1 and 7 or enabled is null or (enabled and (starts_at is null or ends_at is null or ends_at<=starts_at)) then raise exception 'Invalid working hours';end if;
  perform pg_advisory_xact_lock(hashtextextended('doctor:'||(select d.user_id from public.doctors d where d.id=doctor_id)::text,910));
  if enabled then
    insert into public.doctor_working_hours(doctor_id,weekday,starts_at,ends_at,updated_by) values(doctor_id,weekday,starts_at,ends_at,auth.uid())
    on conflict on constraint doctor_working_hours_pkey do update set starts_at=excluded.starts_at,ends_at=excluded.ends_at,updated_at=now(),updated_by=auth.uid();
  else delete from public.doctor_working_hours h where h.doctor_id=set_doctor_hours.doctor_id and h.weekday=set_doctor_hours.weekday;end if;
  perform private.audit_event('STAFF_HOURS_CHANGED','doctors',doctor_id);
end $$;
create function private.assert_doctor_availability(did uuid,starts timestamptz,minutes integer)
returns void language plpgsql security definer set search_path='' as $$
declare local_start timestamp:=starts at time zone 'Europe/Zagreb';local_end timestamp:=(starts+make_interval(mins=>minutes)) at time zone 'Europe/Zagreb';doctor_user uuid;
begin
  select d.user_id into doctor_user from public.doctors d where d.id=did;
  if exists(select 1 from public.doctor_absences a join public.doctors d on d.id=a.doctor_id
    where d.user_id=doctor_user and a.cancelled_at is null
      and a.starts_at<starts+make_interval(mins=>minutes) and a.ends_at>starts) then raise exception 'Doctor is absent' using errcode='23P01';end if;
  -- No configured hours preserves existing behavior until a schedule is set.
  if exists(select 1 from public.doctor_working_hours h where h.doctor_id=did) and not exists(
    select 1 from public.doctor_working_hours h where h.doctor_id=did
      and h.weekday=extract(isodow from local_start) and local_start::date=local_end::date
      and local_start::time>=h.starts_at and local_end::time<=h.ends_at
  ) then raise exception 'Outside working hours' using errcode='23P01';end if;
end $$;
create or replace function private.check_unified_schedule() returns trigger language plpgsql security definer set search_path='' as $$
declare sl public.hospital_slots;did uuid;
begin
  if TG_TABLE_NAME='appointments' then
    if new.status in ('SCHEDULED','ARRIVED','IN_PROGRESS') then
      perform private.assert_schedule_available(new.patient_id,new.doctor_id,new.starts_at,new.duration_minutes,new.id,null);
      if TG_OP='INSERT' or (new.starts_at,new.duration_minutes,new.doctor_id) is distinct from (old.starts_at,old.duration_minutes,old.doctor_id) then
        perform private.assert_doctor_availability(new.doctor_id,new.starts_at,new.duration_minutes);
      end if;
    end if;
  elsif new.status in ('BOOKED','ARRIVED') then
    select * into sl from public.hospital_slots where id=new.slot_id;
    select doctor_id into did from public.hospital_services where id=sl.service_id;
    perform private.assert_schedule_available(new.patient_id,did,sl.starts_at,sl.duration_minutes,null,new.id);
    if TG_OP='INSERT' or new.slot_id is distinct from old.slot_id then perform private.assert_doctor_availability(did,sl.starts_at,sl.duration_minutes);end if;
  end if;
  return new;
end $$;
create function public.record_doctor_absence(doctor_id uuid,starts_at timestamp,ends_at timestamp,substitute_id uuid,reason text)
returns uuid language plpgsql security definer set search_path='' as $$
declare doctor_user uuid;org uuid;result uuid;start_time timestamptz:=starts_at at time zone 'Europe/Zagreb';end_time timestamptz:=ends_at at time zone 'Europe/Zagreb';
begin
  if not private.can_manage_schedule(doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if starts_at is null or ends_at is null or ends_at<=starts_at or (start_time at time zone 'Europe/Zagreb')<>starts_at or (end_time at time zone 'Europe/Zagreb')<>ends_at or length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Invalid absence';end if;
  select d.user_id,d.institution_id into doctor_user,org from public.doctors d where d.id=doctor_id;
  if substitute_id is not null and not exists(select 1 from public.doctors d where d.id=substitute_id and d.id<>doctor_id and d.institution_id=org and d.active and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id where m.user_id=d.user_id and m.institution_id=org and m.active and r.role='DOCTOR')) then raise exception 'Invalid substitute';end if;
  perform pg_advisory_xact_lock(hashtextextended('doctor:'||doctor_user::text,910));
  if exists(select 1 from public.appointments a join public.doctors d on d.id=a.doctor_id where d.user_id=doctor_user and a.status in ('SCHEDULED','ARRIVED','IN_PROGRESS') and a.starts_at<end_time and a.starts_at+make_interval(mins=>a.duration_minutes)>start_time)
    or exists(select 1 from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.doctors d on d.id=s.doctor_id where d.user_id=doctor_user and b.status in ('BOOKED','ARRIVED') and sl.starts_at<end_time and sl.starts_at+make_interval(mins=>sl.duration_minutes)>start_time)
  then raise exception 'Existing appointments must be moved before recording absence' using errcode='23P01';end if;
  insert into public.doctor_absences(doctor_id,starts_at,ends_at,substitute_id,reason,created_by) values(doctor_id,start_time,end_time,substitute_id,trim(reason),auth.uid()) returning id into result;
  perform private.audit_event('STAFF_ABSENCE_CREATED','doctor_absences',result);return result;
end $$;
create function public.cancel_doctor_absence(absence_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare did uuid;
begin
  select doctor_id into did from public.doctor_absences where id=absence_id for update;
  if did is null or not private.can_manage_schedule(did) then raise exception 'Forbidden' using errcode='42501';end if;
  update public.doctor_absences set cancelled_at=now(),cancelled_by=auth.uid() where id=absence_id and cancelled_at is null;
  perform private.audit_event('STAFF_ABSENCE_CANCELLED','doctor_absences',absence_id);
end $$;
revoke all on function private.can_manage_schedule(uuid),private.assert_doctor_availability(uuid,timestamptz,integer) from public,anon,authenticated;
revoke all on function public.doctor_schedule(),public.set_doctor_hours(uuid,integer,time,time,boolean),public.record_doctor_absence(uuid,timestamp,timestamp,uuid,text),public.cancel_doctor_absence(uuid) from public,anon;
grant execute on function public.doctor_schedule(),public.set_doctor_hours(uuid,integer,time,time,boolean),public.record_doctor_absence(uuid,timestamp,timestamp,uuid,text),public.cancel_doctor_absence(uuid) to authenticated;
commit;

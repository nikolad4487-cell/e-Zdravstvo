begin;

-- Both booking paths use the same locks, including doctors with multiple
-- institution profiles. The RPC authorization remains the access boundary.
create function private.assert_schedule_available(
  patient uuid, doctor uuid, starts timestamptz, minutes integer,
  appointment_exclude uuid default null, booking_exclude uuid default null
) returns void language plpgsql security definer set search_path='' as $$
declare doctor_user uuid; lock_id bigint;
begin
  select user_id into doctor_user from public.doctors where id=doctor;
  if doctor_user is null or starts is null or minutes is null or minutes<1 then
    raise exception 'Invalid schedule';
  end if;
  for lock_id in select distinct value from unnest(array[
    hashtextextended('patient:'||patient::text,910),
    hashtextextended('doctor:'||doctor_user::text,910)
  ]) value order by value loop
    perform pg_advisory_xact_lock(lock_id);
  end loop;
  if exists(
    select 1 from public.appointments a join public.doctors d on d.id=a.doctor_id
    where (a.patient_id=patient or d.user_id=doctor_user)
      and a.id is distinct from appointment_exclude
      and a.status in ('SCHEDULED','ARRIVED','IN_PROGRESS')
      and a.starts_at<starts+make_interval(mins=>minutes)
      and a.starts_at+make_interval(mins=>a.duration_minutes)>starts
  ) or exists(
    select 1 from public.hospital_bookings b
    join public.hospital_slots sl on sl.id=b.slot_id
    join public.hospital_services s on s.id=sl.service_id
    join public.doctors d on d.id=s.doctor_id
    where (b.patient_id=patient or d.user_id=doctor_user)
      and b.id is distinct from booking_exclude
      and b.status in ('BOOKED','ARRIVED')
      and sl.starts_at<starts+make_interval(mins=>minutes)
      and sl.starts_at+make_interval(mins=>sl.duration_minutes)>starts
  ) then raise exception 'Patient or doctor has an overlapping appointment' using errcode='23P01'; end if;
end $$;
create function private.check_unified_schedule() returns trigger
language plpgsql security definer set search_path='' as $$
declare sl public.hospital_slots; did uuid;
begin
  if TG_TABLE_NAME='appointments' then
    if new.status in ('SCHEDULED','ARRIVED','IN_PROGRESS') then
      perform private.assert_schedule_available(new.patient_id,new.doctor_id,new.starts_at,new.duration_minutes,new.id,null);
    end if;
  else
    if new.status in ('BOOKED','ARRIVED') then
      select * into sl from public.hospital_slots where id=new.slot_id;
      select doctor_id into did from public.hospital_services where id=sl.service_id;
      perform private.assert_schedule_available(new.patient_id,did,sl.starts_at,sl.duration_minutes,null,new.id);
    end if;
  end if;
  return new;
end $$;
create trigger unified_schedule before insert or update of starts_at,duration_minutes,doctor_id,patient_id,status
  on public.appointments for each row execute function private.check_unified_schedule();
create trigger unified_schedule before insert or update of slot_id,patient_id,status
  on public.hospital_bookings for each row execute function private.check_unified_schedule();
revoke all on function private.assert_schedule_available(uuid,uuid,timestamptz,integer,uuid,uuid),private.check_unified_schedule() from public,anon,authenticated;

-- Keep existing RPC contracts for old clients, add explicit paginated endpoints.
create function public.search_patients_page(search_term text default '',page_number integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; term text:=lower(trim(coalesce(search_term,'')));
begin
  if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
  if page_number is null or page_number not between 0 and 10000 or length(term)>100 then raise exception 'Invalid search';end if;
  select coalesce(jsonb_agg(x order by x.last_name,x.first_name,x.id),'[]') into result from (
    select p.id,p.patient_number,p.first_name,p.last_name,p.birth_date,p.sex,
      (select d.display_name from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id
       where pd.patient_id=p.id and pd.is_primary and pd.revoked_at is null limit 1) primary_doctor
    from public.patients p where private.can_read_patient(p.id)
      and (term='' or position(term in lower(concat_ws(' ',p.first_name,p.last_name,p.patient_number,p.birth_date::text,to_char(p.birth_date,'DD.MM.YYYY'))))>0)
    order by p.last_name,p.first_name,p.id limit 50 offset page_number*50
  ) x;
  perform private.audit_event('PATIENT_SEARCHED','patients',null);
  return result;
end $$;
create function public.search_documents(
  patient_filter uuid default null,kind_filter text default null,search_term text default '',
  status_filter text default null,date_from date default null,date_to date default null,
  page_number integer default 0,institution_filter uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; term text:=lower(trim(coalesce(search_term,'')));
begin
  if auth.uid() is null or (patient_filter is not null and not private.can_read_patient(patient_filter)) then raise exception 'Forbidden' using errcode='42501';end if;
  if page_number is null or page_number not between 0 and 10000 or length(term)>100
    or (kind_filter is not null and kind_filter not in ('PRESCRIPTION','REFERRAL','SCHOOL_EXCUSE'))
    or (status_filter is not null and status_filter not in ('ISSUED','VALID','REVOKED','CANCELLED','EXPIRED','DISPENSED','COMPLETED'))
    or (date_from is not null and date_to is not null and date_from>date_to)
  then raise exception 'Invalid search';end if;
  select coalesce(jsonb_agg(private.document_card(x) order by x.issued_at desc,x.id),'[]') into result from (
    select d.* from public.documents d where private.can_read_patient(d.patient_id)
      and (patient_filter is null or d.patient_id=patient_filter)
      and (kind_filter is null or d.kind=kind_filter)
      and (institution_filter is null or d.institution_id=institution_filter)
      and (status_filter is null or private.document_status(d)=status_filter)
      and (date_from is null or (d.issued_at at time zone 'Europe/Zagreb')::date>=date_from)
      and (date_to is null or (d.issued_at at time zone 'Europe/Zagreb')::date<=date_to)
      and (term='' or position(term in lower(concat_ws(' ',d.number,d.payload->'patient'->>'first_name',d.payload->'patient'->>'last_name',d.payload->'patient'->>'patient_number',d.payload->>'doctor')))>0)
    order by d.issued_at desc,d.id limit 50 offset page_number*50
  ) x;
  perform private.audit_event('DOCUMENT_LIST_VIEWED','documents',patient_filter);
  return result;
end $$;
revoke all on function public.search_patients_page(text,integer),public.search_documents(uuid,text,text,text,date,date,integer,uuid) from public,anon;
grant execute on function public.search_patients_page(text,integer),public.search_documents(uuid,text,text,text,date,date,integer,uuid) to authenticated;
commit;

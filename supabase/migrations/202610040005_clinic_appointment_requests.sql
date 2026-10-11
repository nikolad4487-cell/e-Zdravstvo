begin;
create table public.clinic_appointment_requests(
  id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),
  preferred_date date not null,preferred_period text not null check(preferred_period in ('MORNING','AFTERNOON','ANY')),
  note text not null default '' check(length(note)<=1000),status text not null default 'PENDING' check(status in ('PENDING','APPROVED','DECLINED','CANCELLED')),
  response text,appointment_id uuid references public.appointments(id),version integer not null default 1,
  request_id uuid not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
  resolved_at timestamptz,resolved_by uuid references public.profiles(id),unique(created_by,request_id)
);
create unique index one_pending_clinic_request on public.clinic_appointment_requests(patient_id,doctor_id) where status='PENDING';
alter table public.clinic_appointment_requests enable row level security;
revoke all on public.clinic_appointment_requests from anon,authenticated;
create trigger no_delete before delete on public.clinic_appointment_requests for each row execute function private.no_clinical_delete();
create trigger audit_change after insert or update on public.clinic_appointment_requests for each row execute function private.audit_change();
create function public.my_care_doctors() returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
  if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
  select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'institution',i.name) order by d.display_name,d.id),'[]') from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.institutions i on i.id=d.institution_id where pd.patient_id=pid and pd.revoked_at is null and private.can_message(pid,d.id));
end $$;
create function public.request_clinic_appointment(doctor_id uuid,preferred_date date,preferred_period text,note text,request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;result uuid;prior public.clinic_appointment_requests;
begin
  if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
  select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
  if pid is null or not private.can_message(pid,doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if request_id is null or preferred_date is null or preferred_date<(now() at time zone 'Europe/Zagreb')::date or preferred_date>(now() at time zone 'Europe/Zagreb')::date+90 or preferred_period is null or preferred_period not in ('MORNING','AFTERNOON','ANY') or length(coalesce(note,''))>1000 then raise exception 'Invalid request';end if;
  perform pg_advisory_xact_lock(hashtextextended('clinic-request:'||pid::text||doctor_id::text,911));
  select * into prior from public.clinic_appointment_requests r where r.created_by=auth.uid() and r.request_id=request_clinic_appointment.request_id;
  if prior.id is not null then
    if (prior.doctor_id,prior.preferred_date,prior.preferred_period,prior.note) is distinct from (doctor_id,preferred_date,preferred_period,coalesce(note,'')) then raise exception 'Request reused';end if;return prior.id;
  end if;
  insert into public.clinic_appointment_requests(patient_id,doctor_id,preferred_date,preferred_period,note,request_id,created_by) values(pid,doctor_id,preferred_date,preferred_period,coalesce(note,''),request_id,auth.uid()) returning id into result;
  insert into public.notifications(user_id,message) select d.user_id,'Novi zahtjev pacijenta za termin u ordinaciji.' from public.doctors d where d.id=doctor_id;
  return result;
end $$;
create function public.clinic_appointment_requests(personal boolean,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if personal is null or auth.uid() is null or (personal and not private.has_role('PATIENT')) or (not personal and not(private.has_role('DOCTOR') or private.has_role('NURSE'))) then raise exception 'Forbidden' using errcode='42501';end if;
  if page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid page';end if;
  select coalesce(jsonb_agg(x order by (x.status='PENDING') desc,x.created_at desc,x.id),'[]') into result from (
    select r.*,p.first_name||' '||p.last_name patient_name,d.display_name doctor_name,a.starts_at appointment_starts_at
    from public.clinic_appointment_requests r join public.patients p on p.id=r.patient_id join public.doctors d on d.id=r.doctor_id left join public.appointments a on a.id=r.appointment_id
    where case when personal then p.user_id=auth.uid() else private.can_schedule(r.patient_id,r.doctor_id) end
    order by (r.status='PENDING') desc,r.created_at desc,r.id limit 50 offset page_number*50
  )x;
  perform private.audit_event('CLINIC_REQUESTS_VIEWED','clinic_appointment_requests',null);return result;
end $$;
create function public.resolve_clinic_request(request_id uuid,expected_version integer,approve boolean,response text,appointment_data jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.clinic_appointment_requests;aid uuid;
begin
  select * into r from public.clinic_appointment_requests where id=resolve_clinic_request.request_id for update;
  if r.id is null or not private.can_schedule(r.patient_id,r.doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if expected_version is distinct from r.version then raise exception 'Request changed' using errcode='40001';end if;
  if r.status<>'PENDING' or approve is null or length(trim(coalesce(response,''))) not between 5 and 1000 then raise exception 'Invalid resolution';end if;
  if approve then
    if appointment_data is null then raise exception 'Appointment data required';end if;
    aid:=public.save_appointment(null,null,appointment_data||jsonb_build_object('patient_id',r.patient_id,'doctor_id',r.doctor_id),r.request_id);
  end if;
  update public.clinic_appointment_requests set status=case when approve then 'APPROVED' else 'DECLINED' end,response=trim(resolve_clinic_request.response),appointment_id=aid,version=version+1,resolved_at=now(),resolved_by=auth.uid() where id=r.id;
  insert into public.notifications(user_id,message) select p.user_id,'Zahtjev za termin u ordinaciji je obrađen. Detalji su dostupni u portalu.' from public.patients p where p.id=r.patient_id and p.user_id is not null;
  return aid;
end $$;
create function public.cancel_clinic_request(request_id uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare r public.clinic_appointment_requests;
begin
  select * into r from public.clinic_appointment_requests where id=cancel_clinic_request.request_id for update;
  if r.id is null or not private.has_role('PATIENT') or not exists(select 1 from public.patients p where p.id=r.patient_id and p.user_id=auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
  if expected_version is distinct from r.version then raise exception 'Request changed' using errcode='40001';end if;
  if r.status<>'PENDING' then raise exception 'Only pending requests can be cancelled';end if;
  update public.clinic_appointment_requests set status='CANCELLED',version=version+1,resolved_at=now(),resolved_by=auth.uid() where id=r.id;
end $$;
create or replace function public.doctor_task_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_role('DOCTOR') then raise exception 'Forbidden' using errcode='42501';end if;
  select jsonb_build_object(
    'clinic_requests',(select count(*) from public.clinic_appointment_requests r where r.status='PENDING' and private.can_schedule(r.patient_id,r.doctor_id)),
    'waiting',(select count(*) from public.appointments a join public.doctors d on d.id=a.doctor_id where d.user_id=auth.uid() and a.status='ARRIVED' and private.can_read_patient(a.patient_id)),
    'unread_messages',(select count(*) from public.messages m join public.doctors d on d.id=m.doctor_id where d.user_id=auth.uid() and m.sender_id<>auth.uid() and private.can_message(m.patient_id,m.doctor_id) and m.created_at>coalesce((select r.read_at from public.message_reads r where r.patient_id=m.patient_id and r.doctor_id=m.doctor_id and r.user_id=auth.uid()),'-infinity'::timestamptz)),
    'renewals',(select count(*) from public.medication_renewals r where r.status='PENDING' and private.treating_doctor(r.patient_id) is not null),
    'critical_results',(select count(*) from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.superseded_by is null and private.treating_doctor(o.patient_id) is not null and exists(select 1 from public.laboratory_parameters p where p.result_id=r.id and p.flag='CRITICAL') and not exists(select 1 from public.laboratory_acknowledgements a where a.result_id=r.id))
  ) into result;
  perform private.audit_event('DOCTOR_TASKS_VIEWED','doctors',null);return result;
end $$;

revoke all on function public.my_care_doctors(),public.request_clinic_appointment(uuid,date,text,text,uuid),public.clinic_appointment_requests(boolean,integer),public.resolve_clinic_request(uuid,integer,boolean,text,jsonb),public.cancel_clinic_request(uuid,integer) from public,anon;
grant execute on function public.my_care_doctors(),public.request_clinic_appointment(uuid,date,text,text,uuid),public.clinic_appointment_requests(boolean,integer),public.resolve_clinic_request(uuid,integer,boolean,text,jsonb),public.cancel_clinic_request(uuid,integer) to authenticated;
commit;

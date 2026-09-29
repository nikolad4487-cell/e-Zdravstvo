begin;
create table public.appointments(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),institution_id uuid not null references public.institutions(id),
 starts_at timestamptz not null,duration_minutes integer not null check(duration_minutes between 5 and 240),kind text not null check(length(trim(kind)) between 2 and 100),
 status text not null default 'SCHEDULED' check(status in ('SCHEDULED','ARRIVED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),version integer not null default 1,
 cancellation_reason text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),request_id uuid not null,unique(created_by,request_id)
);
create index appointments_doctor_time on public.appointments(doctor_id,starts_at);
create index appointments_patient_time on public.appointments(patient_id,starts_at);
create table public.appointment_history(id uuid primary key default gen_random_uuid(),appointment_id uuid not null references public.appointments(id),previous_record jsonb not null,changed_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create table public.schedule_events(user_id uuid primary key references public.profiles(id),revision uuid not null default gen_random_uuid());
alter table public.schedule_events enable row level security;
revoke all on public.schedule_events from anon,authenticated;
grant select on public.schedule_events to authenticated;
create policy own_schedule_event on public.schedule_events for select to authenticated using(user_id=auth.uid());
do $$declare t text;begin foreach t in array array['appointments','appointment_history'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
end loop;end $$;
create trigger updated_at before update on public.appointments for each row execute function private.touch_updated_at();
create function private.can_schedule(pid uuid,did uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.doctors d join public.patient_doctors pd on pd.doctor_id=d.id join public.patients p on p.id=pd.patient_id where d.id=did and pd.patient_id=pid and pd.revoked_at is null and d.active and p.archived_at is null and (
 (d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id)) or (private.has_role('NURSE',d.institution_id) and exists(select 1 from public.patient_staff ps where ps.patient_id=pid and ps.user_id=auth.uid() and ps.institution_id=d.institution_id and ps.revoked_at is null))));
$$;
create function private.appointment_changed() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' then insert into public.appointment_history(appointment_id,previous_record,changed_by) values(old.id,to_jsonb(old),auth.uid());end if;
 insert into public.schedule_events(user_id,revision)
 select recipients.id,gen_random_uuid() from(select d.user_id id from public.doctors d where d.id=new.doctor_id union select ps.user_id from public.patient_staff ps where ps.patient_id=new.patient_id and ps.institution_id=new.institution_id and ps.revoked_at is null)recipients
 on conflict(user_id) do update set revision=excluded.revision;
 insert into public.notifications(user_id,message) select p.user_id,'Termin: '||to_char(new.starts_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||' · '||case new.status when 'SCHEDULED' then 'zakazan' when 'ARRIVED' then 'dolazak evidentiran' when 'IN_PROGRESS' then 'pregled u tijeku' when 'COMPLETED' then 'završen' when 'CANCELLED' then 'otkazan' else 'nije ostvaren' end from public.patients p where p.id=new.patient_id and p.user_id is not null;
 return new;
end $$;
create trigger changed after insert or update on public.appointments for each row execute function private.appointment_changed();
create function public.appointment_doctors(patient_id uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'institution',i.name)),'[]') from public.doctors d join public.institutions i on i.id=d.institution_id where private.can_schedule(patient_id,d.id);
$$;
create function public.list_appointments(date_from date,date_to date,personal boolean default false,patient_filter uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or (personal and not private.has_role('PATIENT')) then raise exception 'Forbidden' using errcode='42501';end if;
 if date_from is null or date_to is null or date_to<date_from or date_to-date_from>62 then raise exception 'Invalid date interval';end if;
 select coalesce(jsonb_agg(x order by x.starts_at,x.id),'[]') into result from (
 select a.id,a.patient_id,a.doctor_id,a.starts_at,a.duration_minutes,a.kind,a.status,a.version,a.cancellation_reason,p.first_name||' '||p.last_name patient_name,p.patient_number,d.display_name doctor_name,i.name institution,
 not personal and private.can_schedule(a.patient_id,a.doctor_id) can_manage,not personal and d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id) can_clinical
 from public.appointments a join public.patients p on p.id=a.patient_id join public.doctors d on d.id=a.doctor_id join public.institutions i on i.id=a.institution_id
 where a.starts_at>=date_from::timestamp at time zone 'Europe/Zagreb' and a.starts_at<(date_to+1)::timestamp at time zone 'Europe/Zagreb'
 and (patient_filter is null or a.patient_id=patient_filter)
 and case when personal then p.user_id=auth.uid() and p.archived_at is null else private.can_schedule(a.patient_id,a.doctor_id) end)x;
 perform private.audit_event('APPOINTMENTS_VIEWED','appointments',patient_filter);return result;
end $$;
create function public.save_appointment(appointment_id uuid,expected_version integer,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.appointments;did uuid;pid uuid;org uuid;start_time timestamptz;minutes integer:=(data->>'duration_minutes')::integer;aid uuid;local_time timestamp:=(data->>'local_time')::timestamp;
begin
 if appointment_id is null then did:=(data->>'doctor_id')::uuid;pid:=(data->>'patient_id')::uuid;
 else select * into a from public.appointments where id=appointment_id for update;did:=a.doctor_id;pid:=a.patient_id;
 if a.id is null or a.version is distinct from expected_version then raise exception 'Appointment changed' using errcode='40001';end if;
 if a.status<>'SCHEDULED' then raise exception 'Only scheduled appointments can be rescheduled';end if;end if;
 if not private.can_schedule(pid,did) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,25));
 if appointment_id is null then select id into aid from public.appointments where created_by=auth.uid() and appointments.request_id=save_appointment.request_id;if aid is not null then return aid;end if;end if;
 start_time:=local_time at time zone 'Europe/Zagreb';
 if start_time is null or (start_time at time zone 'Europe/Zagreb')<>local_time or start_time<now()-interval '1 day' or start_time>now()+interval '2 years' or minutes is null or minutes not between 5 and 240 then raise exception 'Invalid appointment time';end if;
 -- Serialize overlapping reservations per doctor and patient, including concurrent requests.
 perform pg_advisory_xact_lock(hashtextextended(did::text,26));perform pg_advisory_xact_lock(hashtextextended(pid::text,27));
 if exists(select 1 from public.appointments x where (x.doctor_id=did or x.patient_id=pid) and x.id<>coalesce(appointment_id,'00000000-0000-0000-0000-000000000000'::uuid) and x.status in ('SCHEDULED','ARRIVED','IN_PROGRESS') and x.starts_at<start_time+make_interval(mins=>minutes) and x.starts_at+make_interval(mins=>x.duration_minutes)>start_time) then raise exception 'Time slot already occupied' using errcode='23P01';end if;
 select institution_id into org from public.doctors where id=did;
 if appointment_id is null then insert into public.appointments(patient_id,doctor_id,institution_id,starts_at,duration_minutes,kind,created_by,request_id) values(pid,did,org,start_time,minutes,trim(data->>'kind'),auth.uid(),request_id) returning id into aid;
 else update public.appointments set starts_at=start_time,duration_minutes=minutes,kind=trim(data->>'kind'),version=version+1 where id=appointment_id returning id into aid;end if;return aid;
end $$;
create function public.set_appointment_status(appointment_id uuid,expected_version integer,new_status text,reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare a public.appointments;is_doctor boolean;begin
 select * into a from public.appointments where id=appointment_id for update;
 if a.id is null or not private.can_schedule(a.patient_id,a.doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if a.version is distinct from expected_version then raise exception 'Appointment changed' using errcode='40001';end if;
 select user_id=auth.uid() and private.has_role('DOCTOR',institution_id) into is_doctor from public.doctors where id=a.doctor_id;
 if new_status is null or not ((a.status='SCHEDULED' and new_status in ('ARRIVED','CANCELLED','NO_SHOW')) or (a.status='ARRIVED' and new_status in ('IN_PROGRESS','CANCELLED')) or (a.status='IN_PROGRESS' and new_status='COMPLETED')) then raise exception 'Invalid status transition';end if;
 if new_status in ('IN_PROGRESS','COMPLETED') and not is_doctor then raise exception 'Doctor required' using errcode='42501';end if;
 if new_status in ('ARRIVED','IN_PROGRESS','COMPLETED','NO_SHOW') and a.starts_at>now() and (a.starts_at at time zone 'Europe/Zagreb')::date>(now() at time zone 'Europe/Zagreb')::date then raise exception 'Appointment is in the future';end if;
 if new_status='CANCELLED' and length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Cancellation reason required';end if;
 update public.appointments set status=new_status,version=version+1,cancellation_reason=case when new_status='CANCELLED' then trim(reason) else null end where id=appointment_id;
 perform private.audit_event('APPOINTMENT_'||new_status,'appointments',appointment_id);
end $$;
revoke all on function private.can_schedule(uuid,uuid),private.appointment_changed() from public,anon,authenticated;
revoke all on function public.appointment_doctors(uuid),public.list_appointments(date,date,boolean,uuid),public.save_appointment(uuid,integer,jsonb,uuid),public.set_appointment_status(uuid,integer,text,text) from public,anon;
grant execute on function public.appointment_doctors(uuid),public.list_appointments(date,date,boolean,uuid),public.save_appointment(uuid,integer,jsonb,uuid),public.set_appointment_status(uuid,integer,text,text) to authenticated;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') then alter publication supabase_realtime add table public.schedule_events;end if;end $$;
create or replace function public.patient_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;result jsonb;
begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 if pid is null then return null;end if;
 select jsonb_build_object('patient_id',pid,
 'next_appointment',(select jsonb_build_object('starts_at',a.starts_at,'kind',a.kind,'doctor_name',d.display_name) from public.appointments a join public.doctors d on d.id=a.doctor_id where a.patient_id=pid and a.starts_at>=now() and a.status='SCHEDULED' order by a.starts_at limit 1),
 'active_prescriptions',(select count(*) from public.documents d where d.patient_id=pid and d.kind='PRESCRIPTION' and private.document_status(d)='ISSUED'),
 'active_referrals',(select count(*) from public.documents d where d.patient_id=pid and d.kind='REFERRAL' and private.document_status(d) in ('ISSUED','BOOKED','IN_PROGRESS')),
 'attachments',(select count(*) from public.document_attachments a where a.patient_id=pid and a.status='AVAILABLE'),
 'unread_notifications',(select count(*) from public.notifications n where n.user_id=auth.uid() and n.read_at is null),
 'active_therapy',coalesce((select jsonb_agg(jsonb_build_object('id',pm.id,'name',m.name,'strength',m.strength,'dosage',pm.dosage,'frequency',pm.frequency)) from public.patient_medications pm join public.medications m on m.id=pm.medication_id where pm.patient_id=pid and pm.status='ACTIVE' and pm.start_date<=current_date and (pm.end_date is null or pm.end_date>=current_date)),'[]'),
 'doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'specialty',d.specialty,'institution',i.name,'is_primary',pd.is_primary)) from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.institutions i on i.id=d.institution_id where pd.patient_id=pid and pd.revoked_at is null and d.active and i.active),'[]'),
 'recent_documents',coalesce((select jsonb_agg(x) from (select d.id,d.number,d.kind,d.issued_at,private.document_status(d) status from public.documents d where d.patient_id=pid order by d.issued_at desc limit 5)x),'[]'),
 'recent_activity',coalesce((select jsonb_agg(x) from (select n.id,n.message,n.created_at,n.read_at from public.notifications n where n.user_id=auth.uid() order by n.created_at desc limit 5)x),'[]')) into result;
 perform private.audit_event('PATIENT_DASHBOARD_VIEWED','patients',pid);return result;
end $$;
commit;

begin;
-- Contact-address confirmations are private, database-generated appointment events.
-- Account-linked patients continue to use verified login addresses and their preferences.
create table private.contact_appointment_email_events(
 id uuid primary key default gen_random_uuid(),sequence_id bigint generated always as identity unique,
 patient_id uuid not null references public.patients(id),
 appointment_id uuid references public.appointments(id),hospital_booking_id uuid references public.hospital_bookings(id),
 entity_version integer not null,event_type text not null check(event_type in ('BOOKED','RESCHEDULED','CANCELLED')),
 email text not null,payload jsonb not null,created_at timestamptz not null default now(),
 check(num_nonnulls(appointment_id,hospital_booking_id)=1),
 unique(appointment_id,entity_version),unique(hospital_booking_id,entity_version)
);
revoke all on private.contact_appointment_email_events from public,anon,authenticated;
alter table private.notification_email_outbox alter column notification_id drop not null;
alter table private.notification_email_outbox alter column user_id drop not null;
alter table private.notification_email_outbox add column contact_event_id uuid unique references private.contact_appointment_email_events(id);
alter table private.notification_email_outbox add constraint notification_email_source check(
 (notification_id is not null and user_id is not null and contact_event_id is null) or
 (notification_id is null and user_id is null and contact_event_id is not null));
create function private.contact_appointment_payload(appointment_id uuid,hospital_booking_id uuid,event_type text) returns jsonb language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
 if appointment_id is not null then
  select jsonb_build_object('eventType',event_type,'patientName',p.first_name||' '||p.last_name,
   'startsAt',a.starts_at,'durationMinutes',a.duration_minutes,'institution',i.name,'doctor',d.display_name,
   -- Appointment kind is free text: never copy symptoms or diagnoses into mail.
   'kind',case when a.kind in ('Pregled','Kontrolni pregled','Prvi pregled','Preventivni pregled','Sistematski pregled') then a.kind else 'Pregled u ordinaciji' end,
   'location',coalesce(nullif(concat_ws(', ',nullif(i.address,''),nullif(i.postal_code,''),nullif(i.city,'')),''),'Lokaciju provjerite kod svojeg liječnika'),
   'portalPath','/moje/termini') into payload
  from public.appointments a join public.patients p on p.id=a.patient_id join public.institutions i on i.id=a.institution_id join public.doctors d on d.id=a.doctor_id where a.id=appointment_id;
 else
  select jsonb_build_object('eventType',event_type,'patientName',p.first_name||' '||p.last_name,
   'startsAt',sl.starts_at,'durationMinutes',sl.duration_minutes,'hospital',i.name,'department',coalesce(h.name,s.specialty),
   'specialist',d.display_name,'kind',s.name,'priority',b.priority,
   'location',concat_ws(', ',nullif(s.location,''),nullif(i.address,''),nullif(i.city,'')),
   'portalPath','/moje/narudzbe') into payload
  from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.patients p on p.id=b.patient_id
  join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id left join public.hospital_departments h on h.id=s.department_id where b.id=hospital_booking_id;
 end if;
 return payload;
end $$;
create function private.valid_patient_contact_email(email text) returns boolean language sql immutable set search_path='' as $$
 select email is not null and length(trim(email)) between 3 and 254 and trim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
$$;
create function private.queue_contact_appointment_email(appointment_id uuid,hospital_booking_id uuid,event_type text) returns uuid language plpgsql security definer set search_path='' as $$
declare p public.patients;pid uuid;version integer;event uuid;payload jsonb;
begin
 if num_nonnulls(appointment_id,hospital_booking_id)<>1 or event_type not in ('BOOKED','RESCHEDULED','CANCELLED') then raise exception 'Invalid appointment email event';end if;
 if not(select c.email_available from private.notification_delivery_config c where c.id) then return null;end if;
 if appointment_id is not null then
 select a.version,a.patient_id into version,pid from public.appointments a where a.id=appointment_id;
 else
 select b.version,b.patient_id into version,pid from public.hospital_bookings b where b.id=hospital_booking_id;
 end if;
 select * into p from public.patients where id=pid;
 if p.id is null or p.archived_at is not null or p.user_id is not null or not private.valid_patient_contact_email(p.email) then return null;end if;
 payload:=private.contact_appointment_payload(appointment_id,hospital_booking_id,event_type);
 if payload is null then return null;end if;
 insert into private.contact_appointment_email_events(patient_id,appointment_id,hospital_booking_id,entity_version,event_type,email,payload)
 values(p.id,appointment_id,hospital_booking_id,version,event_type,trim(p.email),payload) on conflict do nothing returning id into event;
 if event is not null then
 insert into private.notification_email_outbox(contact_event_id) values(event) on conflict do nothing;
 end if;
 return event;
end $$;
create function private.contact_appointment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare event_type text;
begin
 if TG_TABLE_NAME='appointments' then
 event_type:=case when TG_OP='INSERT' and new.status='SCHEDULED' then 'BOOKED'
 when TG_OP='UPDATE' and new.status='CANCELLED' and old.status<>'CANCELLED' then 'CANCELLED'
 when TG_OP='UPDATE' and new.status='SCHEDULED' and (new.starts_at,new.duration_minutes,new.kind) is distinct from (old.starts_at,old.duration_minutes,old.kind) then 'RESCHEDULED' end;
 if event_type is not null then perform private.queue_contact_appointment_email(new.id,null,event_type);end if;
 else
 event_type:=case when TG_OP='INSERT' and new.status='BOOKED' then 'BOOKED'
 when TG_OP='UPDATE' and new.status='CANCELLED' and old.status<>'CANCELLED' then 'CANCELLED'
 when TG_OP='UPDATE' and new.status='BOOKED' and new.slot_id is distinct from old.slot_id then 'RESCHEDULED' end;
 if event_type is not null then perform private.queue_contact_appointment_email(null,new.id,event_type);end if;
 end if;
 return new;
end $$;
create trigger contact_email_changed after insert or update on public.appointments for each row execute function private.contact_appointment_changed();
create trigger contact_email_changed after insert or update on public.hospital_bookings for each row execute function private.contact_appointment_changed();
revoke all on function private.contact_appointment_payload(uuid,uuid,text),private.valid_patient_contact_email(text),private.queue_contact_appointment_email(uuid,uuid,text),private.contact_appointment_changed() from public,anon,authenticated;
create or replace function public.claim_notification_emails(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if batch_size is null or batch_size not between 1 and 100 then raise exception 'Invalid batch';end if;
 if not (select c.email_available from private.notification_delivery_config c where c.id) then return '[]'::jsonb;end if;
 -- Never repeat an uncertain send outside the provider's idempotency window.
 insert into private.notification_email_attempts(job_id,attempt_number,lease_id,succeeded,outcome)
 select id,attempts,lease_id,false,'LEASE_EXPIRED' from private.notification_email_outbox
 where status='SENDING' and (locked_until<now() or first_attempt_at<now()-interval '23 hours') and lease_id is not null on conflict do nothing;
 update private.notification_email_outbox set status='FAILED',locked_until=null,lease_id=null
 where status in ('PENDING','SENDING') and first_attempt_at<now()-interval '23 hours';
 update private.notification_email_outbox set status='FAILED',locked_until=null,lease_id=null where status='SENDING' and locked_until<now() and attempts>=5;
 update private.notification_email_outbox o set status='CANCELLED',locked_until=null,lease_id=null
 where o.status in ('PENDING','SENDING') and o.notification_id is not null and (
 not exists(select 1 from public.notification_preferences p where p.user_id=o.user_id and p.email_enabled)
 or exists(select 1 from public.notifications n join public.appointments a on a.id=n.appointment_id join public.patients p on p.id=a.patient_id left join private.appointment_email_snapshots snap on snap.notification_id=n.id where n.id=o.notification_id and
  (p.archived_at is not null or p.user_id is distinct from o.user_id or n.email_event is null or
   (n.email_event='CANCELLED' and a.status<>'CANCELLED') or
   (n.email_event<>'CANCELLED' and (a.status<>'SCHEDULED' or a.starts_at<=now() or a.starts_at is distinct from (snap.payload->>'startsAt')::timestamptz))))
 or exists(select 1 from public.notifications n join public.hospital_bookings b on b.id=n.hospital_booking_id join public.hospital_slots sl on sl.id=b.slot_id join public.patients p on p.id=b.patient_id where n.id=o.notification_id and
  (p.archived_at is not null or p.user_id is distinct from o.user_id or n.email_event is null or
   (n.email_event='CANCELLED' and b.status<>'CANCELLED') or
   (n.email_event<>'CANCELLED' and (b.status<>'BOOKED' or sl.starts_at<=now() or sl.starts_at is distinct from n.booking_starts_at))))
 or exists(select 1 from public.notifications n join public.notifications newer on newer.user_id=n.user_id and newer.email_event is not null and
   ((n.appointment_id is not null and newer.appointment_id=n.appointment_id) or (n.hospital_booking_id is not null and newer.hospital_booking_id=n.hospital_booking_id))
   join private.appointment_email_snapshots ns on ns.notification_id=newer.id
   where n.id=o.notification_id and ns.sequence_id>(select original.sequence_id from private.appointment_email_snapshots original where original.notification_id=n.id)));
 update private.notification_email_outbox o set status='CANCELLED',locked_until=null,lease_id=null
 from private.contact_appointment_email_events e join public.patients p on p.id=e.patient_id
 left join public.appointments a on a.id=e.appointment_id
 left join public.hospital_bookings b on b.id=e.hospital_booking_id
 left join public.hospital_slots sl on sl.id=b.slot_id
 where o.contact_event_id=e.id and o.status in ('PENDING','SENDING') and (
 p.archived_at is not null or p.user_id is not null or trim(coalesce(p.email,'')) is distinct from e.email
 or (e.appointment_id is not null and ((e.event_type='CANCELLED' and a.status<>'CANCELLED') or (e.event_type<>'CANCELLED' and (a.status<>'SCHEDULED' or a.starts_at<=now() or a.starts_at is distinct from (e.payload->>'startsAt')::timestamptz))))
 or (e.hospital_booking_id is not null and ((e.event_type='CANCELLED' and b.status<>'CANCELLED') or (e.event_type<>'CANCELLED' and (b.status<>'BOOKED' or sl.starts_at<=now() or sl.starts_at is distinct from (e.payload->>'startsAt')::timestamptz))))
 or exists(select 1 from private.contact_appointment_email_events newer where newer.sequence_id>e.sequence_id and ((e.appointment_id is not null and newer.appointment_id=e.appointment_id) or (e.hospital_booking_id is not null and newer.hospital_booking_id=e.hospital_booking_id))));
 with picked as (
 select o.id from private.notification_email_outbox o left join auth.users u on u.id=o.user_id left join private.contact_appointment_email_events e on e.id=o.contact_event_id
 where (o.status='PENDING' or (o.status='SENDING' and o.locked_until<now())) and o.next_attempt_at<=now() and o.attempts<5 and ((o.notification_id is not null and u.email is not null and u.email_confirmed_at is not null) or e.id is not null)
 order by o.created_at,o.id for update of o skip locked limit batch_size
 ), claimed as (
 update private.notification_email_outbox o set status='SENDING',attempts=o.attempts+1,first_attempt_at=coalesce(o.first_attempt_at,now()),locked_until=now()+interval '5 minutes',lease_id=gen_random_uuid()
 from picked where o.id=picked.id returning o.id,o.user_id,o.lease_id,o.notification_id,o.contact_event_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_id',c.lease_id,'email',coalesce(e.email,u.email),'portalAccess',e.id is null)||case when coalesce(e.payload,snap.payload) is null then '{}'::jsonb else jsonb_build_object(case when coalesce(e.hospital_booking_id,n.hospital_booking_id) is not null then 'confirmation' else 'appointment' end,coalesce(e.payload,snap.payload)) end),'[]') into result
 from claimed c left join auth.users u on u.id=c.user_id left join public.notifications n on n.id=c.notification_id left join private.appointment_email_snapshots snap on snap.notification_id=n.id left join private.contact_appointment_email_events e on e.id=c.contact_event_id;
 return result;
end $$;
create or replace function public.hospital_booking_email_status(booking_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare pid uuid;uid uuid;email text;status text;
begin
 select b.patient_id,p.user_id,p.email into pid,uid,email from public.hospital_bookings b join public.patients p on p.id=b.patient_id where b.id=booking_id;
 if pid is null or not coalesce(private.treating_doctor(pid) is not null or (uid=auth.uid() and private.has_role('PATIENT')),false) then raise exception 'Forbidden' using errcode='42501';end if;
 if not(select c.email_available from private.notification_delivery_config c where c.id) then return 'UNAVAILABLE';end if;
 if uid is null then
 if not private.valid_patient_contact_email(email) then return 'NO_EMAIL';end if;
 select o.status into status from private.contact_appointment_email_events e join private.notification_email_outbox o on o.contact_event_id=e.id where e.hospital_booking_id=booking_id order by e.sequence_id desc limit 1;
 else
 if not exists(select 1 from public.notification_preferences p where p.user_id=uid and p.email_enabled) then return 'DISABLED';end if;
 if not exists(select 1 from auth.users u where u.id=uid and u.email is not null and u.email_confirmed_at is not null) then return 'UNVERIFIED';end if;
 select o.status into status from public.notifications n join private.notification_email_outbox o on o.notification_id=n.id where n.hospital_booking_id=booking_id order by n.created_at desc,n.id desc limit 1;
 end if;
 return coalesce(status,'NOT_QUEUED');
end $$;
-- Queue confirmations for existing upcoming accountless hospital bookings, once per booking version.
-- No historical/cancelled bookings and no messages for missing or malformed addresses.
do $$declare booking record;begin
 for booking in select b.id from public.hospital_bookings b join public.patients p on p.id=b.patient_id join public.hospital_slots sl on sl.id=b.slot_id
 where b.status='BOOKED' and sl.starts_at>now() and p.user_id is null and p.archived_at is null and private.valid_patient_contact_email(p.email)
 loop perform private.queue_contact_appointment_email(null,booking.id,'BOOKED');end loop;
end $$;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 2026101104$$;
commit;

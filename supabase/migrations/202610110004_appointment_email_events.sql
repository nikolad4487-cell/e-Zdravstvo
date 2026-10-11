begin;
-- Only database-generated appointment events may supply email details.
alter table public.notifications add column appointment_id uuid references public.appointments(id);
alter table public.notifications add column email_event text check(email_event in ('BOOKED','RESCHEDULED','CANCELLED'));
create table private.appointment_email_snapshots(
 notification_id uuid primary key references public.notifications(id),
 sequence_id bigint generated always as identity unique,
 payload jsonb not null
);
create table private.notification_email_attempts(
 job_id uuid not null references private.notification_email_outbox(id),
 attempt_number integer not null,
 lease_id uuid not null,
 succeeded boolean not null,
 provider_id text,
 outcome text not null check(outcome in ('SENT','DELIVERY_FAILED','LEASE_EXPIRED')),
 created_at timestamptz not null default now(),
 primary key(job_id,attempt_number)
);
alter table private.notification_email_outbox add column first_attempt_at timestamptz;
-- Existing jobs may already have reached the provider. Bound retries to its 24h idempotency window.
update private.notification_email_outbox set first_attempt_at=created_at where attempts>0;
revoke all on private.appointment_email_snapshots,private.notification_email_attempts from public,anon,authenticated;
create or replace function private.appointment_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare event_type text;
begin
 if TG_OP='UPDATE' then insert into public.appointment_history(appointment_id,previous_record,changed_by) values(old.id,to_jsonb(old),auth.uid());end if;
 insert into public.schedule_events(user_id,revision)
 select recipients.id,gen_random_uuid() from(select d.user_id id from public.doctors d where d.id=new.doctor_id union select ps.user_id from public.patient_staff ps where ps.patient_id=new.patient_id and ps.institution_id=new.institution_id and ps.revoked_at is null)recipients
 on conflict(user_id) do update set revision=excluded.revision;
 event_type:=case when TG_OP='INSERT' and new.status='SCHEDULED' then 'BOOKED' when TG_OP='UPDATE' and new.status='CANCELLED' and old.status<>'CANCELLED' then 'CANCELLED' when TG_OP='UPDATE' and new.status='SCHEDULED' and (new.starts_at,new.duration_minutes,new.kind) is distinct from (old.starts_at,old.duration_minutes,old.kind) then 'RESCHEDULED' end;
 insert into public.notifications(user_id,message,appointment_id,email_event) select p.user_id,'Termin: '||to_char(new.starts_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||' · '||case new.status when 'SCHEDULED' then 'zakazan' when 'ARRIVED' then 'dolazak evidentiran' when 'IN_PROGRESS' then 'pregled u tijeku' when 'COMPLETED' then 'završen' when 'CANCELLED' then 'otkazan' else 'nije ostvaren' end,new.id,event_type from public.patients p where p.id=new.patient_id and p.user_id is not null;
 return new;
end $$;
create function private.snapshot_appointment_email() returns trigger language plpgsql security definer set search_path='' as $$
declare payload jsonb;
begin
 if new.email_event is null then return new;end if;
 if new.appointment_id is not null then
  select jsonb_build_object('eventType',new.email_event,'patientName',p.first_name||' '||p.last_name,
   'startsAt',a.starts_at,'durationMinutes',a.duration_minutes,'institution',i.name,'doctor',d.display_name,
   -- Appointment kind is free text: never copy symptoms or diagnoses into mail.
   'kind',case when a.kind in ('Pregled','Kontrolni pregled','Prvi pregled','Preventivni pregled','Sistematski pregled') then a.kind else 'Pregled u ordinaciji' end,
   'location',coalesce(nullif(concat_ws(', ',nullif(i.address,''),nullif(i.postal_code,''),nullif(i.city,'')),''),'Lokaciju provjerite u portalu'),
   'portalPath','/moje/termini') into payload
  from public.appointments a join public.patients p on p.id=a.patient_id join public.institutions i on i.id=a.institution_id join public.doctors d on d.id=a.doctor_id where a.id=new.appointment_id;
 else
  select jsonb_build_object('eventType',new.email_event,'patientName',p.first_name||' '||p.last_name,
   'startsAt',sl.starts_at,'durationMinutes',sl.duration_minutes,'hospital',i.name,'department',coalesce(h.name,s.specialty),
   'specialist',d.display_name,'kind',s.name,'priority',b.priority,
   'location',concat_ws(', ',nullif(s.location,''),nullif(i.address,''),nullif(i.city,'')),
   'portalPath','/moje/narudzbe') into payload
  from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.patients p on p.id=b.patient_id
  join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id left join public.hospital_departments h on h.id=s.department_id where b.id=new.hospital_booking_id;
 end if;
 if payload is not null then insert into private.appointment_email_snapshots(notification_id,payload) values(new.id,payload);end if;
 return new;
end $$;
create trigger snapshot_email after insert on public.notifications for each row execute function private.snapshot_appointment_email();
revoke all on function private.snapshot_appointment_email() from public,anon,authenticated;
create or replace function private.hospital_booking_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare starts timestamptz;confirmation boolean; event_type text;
begin
 if TG_OP='UPDATE' then insert into public.hospital_booking_history(booking_id,snapshot,created_by) values(old.id,to_jsonb(old),auth.uid());end if;
 select sl.starts_at into starts from public.hospital_slots sl where sl.id=new.slot_id;
 event_type:=case when TG_OP='INSERT' and new.status='BOOKED' then 'BOOKED' when TG_OP='UPDATE' and new.status='CANCELLED' and old.status<>'CANCELLED' then 'CANCELLED' when TG_OP='UPDATE' and new.status='BOOKED' and new.slot_id is distinct from old.slot_id then 'RESCHEDULED' end;
 confirmation:=new.priority and new.status='BOOKED' and (TG_OP='INSERT' or new.slot_id is distinct from old.slot_id);
 insert into public.notifications(user_id,message,hospital_booking_id,booking_starts_at,email_event)
 select p.user_id,case when confirmation then 'Potvrđen PRIORITETNI pregled: '||to_char(starts at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||'. Detalji su u bolničkim narudžbama.'
 else 'Bolnička narudžba: '||case new.status when 'BOOKED' then 'termin je potvrđen.' when 'CANCELLED' then 'termin je otkazan.' when 'COMPLETED' then 'pregled je završen.' else 'status je promijenjen.' end end,
 new.id,starts,event_type from public.patients p where p.id=new.patient_id and p.user_id is not null;
 insert into public.schedule_events(user_id,revision) select d.user_id,gen_random_uuid() from public.doctors d where d.id=new.referring_doctor_id or d.id=(select s.doctor_id from public.hospital_slots sl join public.hospital_services s on s.id=sl.service_id where sl.id=new.slot_id) on conflict(user_id) do update set revision=excluded.revision;
 return new;
end $$;
create or replace function private.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.appointment_id is not null or new.hospital_booking_id is not null) and new.email_event is null then return new;end if;
 if (select c.email_available from private.notification_delivery_config c where c.id) and exists(select 1 from public.notification_preferences p where p.user_id=new.user_id and p.email_enabled) then
  insert into private.notification_email_outbox(notification_id,user_id) values(new.id,new.user_id) on conflict(notification_id) do nothing;
 end if;
 return new;
end $$;
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
 where o.status in ('PENDING','SENDING') and (
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
 with picked as (
 select o.id from private.notification_email_outbox o join auth.users u on u.id=o.user_id
 where (o.status='PENDING' or (o.status='SENDING' and o.locked_until<now())) and o.next_attempt_at<=now() and o.attempts<5 and u.email is not null and u.email_confirmed_at is not null
 order by o.created_at,o.id for update of o skip locked limit batch_size
 ), claimed as (
 update private.notification_email_outbox o set status='SENDING',attempts=o.attempts+1,first_attempt_at=coalesce(o.first_attempt_at,now()),locked_until=now()+interval '5 minutes',lease_id=gen_random_uuid()
 from picked where o.id=picked.id returning o.id,o.user_id,o.lease_id,o.notification_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_id',c.lease_id,'email',u.email)||case when snap.payload is null then '{}'::jsonb else jsonb_build_object(case when n.hospital_booking_id is not null then 'confirmation' else 'appointment' end,snap.payload) end),'[]') into result
 from claimed c join auth.users u on u.id=c.user_id join public.notifications n on n.id=c.notification_id left join private.appointment_email_snapshots snap on snap.notification_id=n.id;
 return result;
end $$;
create or replace function public.complete_notification_email(job_id uuid,lease_id uuid,succeeded boolean,provider_id text default null,retry_seconds integer default 60)
returns void language plpgsql security definer set search_path='' as $$
declare completed record;
begin
 if succeeded is null or retry_seconds is null or retry_seconds not between 1 and 86400 then raise exception 'Invalid completion';end if;
 update private.notification_email_outbox o set status=case when succeeded then 'SENT' when o.attempts>=5 then 'FAILED' else 'PENDING' end,
 sent_at=case when succeeded then now() else null end,provider_id=case when succeeded then left(complete_notification_email.provider_id,200) else null end,
 next_attempt_at=now()+make_interval(secs=>retry_seconds),locked_until=null,lease_id=null
 where o.id=job_id and o.lease_id=complete_notification_email.lease_id and o.status='SENDING' and o.locked_until>=now()
 returning o.id,o.attempts,o.provider_id into completed;
 if found then
 insert into private.notification_email_attempts(job_id,attempt_number,lease_id,succeeded,provider_id,outcome)
 values(completed.id,completed.attempts,complete_notification_email.lease_id,succeeded,completed.provider_id,case when succeeded then 'SENT' else 'DELIVERY_FAILED' end) on conflict do nothing;
 end if;
end $$;
commit;

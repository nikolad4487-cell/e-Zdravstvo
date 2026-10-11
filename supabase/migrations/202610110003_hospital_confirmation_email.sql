begin;
alter table public.notifications add column hospital_booking_id uuid references public.hospital_bookings(id);
alter table public.notifications add column booking_starts_at timestamptz;
create or replace function private.hospital_booking_changed() returns trigger language plpgsql security definer set search_path='' as $$
declare starts timestamptz;confirmation boolean;
begin
 if TG_OP='UPDATE' then insert into public.hospital_booking_history(booking_id,snapshot,created_by) values(old.id,to_jsonb(old),auth.uid());end if;
 select sl.starts_at into starts from public.hospital_slots sl where sl.id=new.slot_id;
 confirmation:=new.priority and new.status='BOOKED' and (TG_OP='INSERT' or new.slot_id is distinct from old.slot_id);
 insert into public.notifications(user_id,message,hospital_booking_id,booking_starts_at)
 select p.user_id,case when confirmation then 'Potvrđen PRIORITETNI pregled: '||to_char(starts at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||'. Detalji su u bolničkim narudžbama.'
 else 'Bolnička narudžba: '||case new.status when 'BOOKED' then 'termin je potvrđen.' when 'CANCELLED' then 'termin je otkazan.' when 'COMPLETED' then 'pregled je završen.' else 'status je promijenjen.' end end,
 case when confirmation then new.id else null end,case when confirmation then starts else null end from public.patients p where p.id=new.patient_id and p.user_id is not null;
 insert into public.schedule_events(user_id,revision) select d.user_id,gen_random_uuid() from public.doctors d where d.id=new.referring_doctor_id or d.id=(select s.doctor_id from public.hospital_slots sl join public.hospital_services s on s.id=sl.service_id where sl.id=new.slot_id) on conflict(user_id) do update set revision=excluded.revision;
 return new;
end $$;
create or replace function public.claim_notification_emails(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if batch_size is null or batch_size not between 1 and 100 then raise exception 'Invalid batch';end if;
 if not (select c.email_available from private.notification_delivery_config c where c.id) then return '[]'::jsonb;end if;
 update private.notification_email_outbox set status='FAILED' where status='SENDING' and locked_until<now() and attempts>=5;
 update private.notification_email_outbox o set status='CANCELLED' where o.status in ('PENDING','SENDING') and (
 not exists(select 1 from public.notification_preferences p where p.user_id=o.user_id and p.email_enabled)
 or exists(select 1 from public.notifications n join public.hospital_bookings b on b.id=n.hospital_booking_id join public.hospital_slots sl on sl.id=b.slot_id join public.patients p on p.id=b.patient_id where n.id=o.notification_id and (b.status<>'BOOKED' or sl.starts_at is distinct from n.booking_starts_at or sl.starts_at<=now() or p.archived_at is not null or p.user_id is distinct from o.user_id)));
 with picked as (
 select o.id from private.notification_email_outbox o join auth.users u on u.id=o.user_id
 where (o.status='PENDING' or (o.status='SENDING' and o.locked_until<now())) and o.next_attempt_at<=now() and o.attempts<5 and u.email is not null and u.email_confirmed_at is not null
 order by o.created_at,o.id for update of o skip locked limit batch_size
 ), claimed as (
 update private.notification_email_outbox o set status='SENDING',attempts=o.attempts+1,locked_until=now()+interval '5 minutes',lease_id=gen_random_uuid() from picked where o.id=picked.id returning o.id,o.user_id,o.lease_id,o.notification_id
 ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_id',c.lease_id,'email',u.email)||case when n.hospital_booking_id is null then '{}'::jsonb else jsonb_build_object('confirmation',jsonb_build_object('startsAt',sl.starts_at,'durationMinutes',sl.duration_minutes,'hospital',i.name,'department',coalesce(h.name,s.specialty),'specialist',d.display_name,'location',s.location)) end),'[]') into result
 from claimed c join auth.users u on u.id=c.user_id join public.notifications n on n.id=c.notification_id
 left join public.hospital_bookings b on b.id=n.hospital_booking_id left join public.hospital_slots sl on sl.id=b.slot_id left join public.hospital_services s on s.id=sl.service_id left join public.hospital_departments h on h.id=s.department_id left join public.institutions i on i.id=s.institution_id left join public.doctors d on d.id=s.doctor_id;
 return result;
end $$;
create function public.hospital_booking_email_status(booking_id uuid) returns text language plpgsql security definer set search_path='' as $$
declare pid uuid;uid uuid;status text;
begin
 select b.patient_id,p.user_id into pid,uid from public.hospital_bookings b join public.patients p on p.id=b.patient_id where b.id=booking_id;
 if pid is null or not coalesce(private.treating_doctor(pid) is not null or (uid=auth.uid() and private.has_role('PATIENT')),false) then raise exception 'Forbidden' using errcode='42501';end if;
 if uid is null then return 'NO_ACCOUNT';end if;
 if not(select c.email_available from private.notification_delivery_config c where c.id) then return 'UNAVAILABLE';end if;
 if not exists(select 1 from public.notification_preferences p where p.user_id=uid and p.email_enabled) then return 'DISABLED';end if;
 if not exists(select 1 from auth.users u where u.id=uid and u.email is not null and u.email_confirmed_at is not null) then return 'UNVERIFIED';end if;
 select o.status into status from public.notifications n join private.notification_email_outbox o on o.notification_id=n.id where n.hospital_booking_id=booking_id order by n.created_at desc,n.id desc limit 1;
 return coalesce(status,'NOT_QUEUED');
end $$;
revoke all on function public.hospital_booking_email_status(uuid) from public,anon;
grant execute on function public.hospital_booking_email_status(uuid) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 2026101102$$;
commit;

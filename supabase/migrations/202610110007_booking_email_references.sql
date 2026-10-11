begin;
-- One permanent reference for a reservation, shared by its confirmation and later changes.
create table private.booking_email_references(
 sequence_number bigint generated always as identity primary key,
 booked_year integer not null,
 appointment_id uuid unique references public.appointments(id),
 hospital_booking_id uuid unique references public.hospital_bookings(id),
 check(num_nonnulls(appointment_id,hospital_booking_id)=1)
);
revoke all on private.booking_email_references from public,anon,authenticated;
insert into private.booking_email_references(booked_year,appointment_id,hospital_booking_id)
select extract(year from created_at at time zone 'Europe/Zagreb')::integer,appointment_id,hospital_booking_id
from (select created_at,id appointment_id,null::uuid hospital_booking_id from public.appointments
 union all select created_at,null::uuid,id from public.hospital_bookings) reservations
order by created_at,coalesce(appointment_id,hospital_booking_id);
create function private.create_booking_email_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.booking_email_references(booked_year,appointment_id,hospital_booking_id)
 values(extract(year from new.created_at at time zone 'Europe/Zagreb')::integer,
 case when TG_TABLE_NAME='appointments' then new.id end,
 case when TG_TABLE_NAME='hospital_bookings' then new.id end) on conflict do nothing;
 return new;
end $$;
-- PostgreSQL orders same-kind triggers by name; the reference must precede email snapshots.
create trigger a_booking_email_reference after insert on public.appointments for each row execute function private.create_booking_email_reference();
create trigger a_booking_email_reference after insert on public.hospital_bookings for each row execute function private.create_booking_email_reference();
create function private.add_booking_email_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare appointment uuid;booking uuid;reference text;
begin
 if TG_TABLE_NAME='appointment_email_snapshots' then
 select n.appointment_id,n.hospital_booking_id into appointment,booking from public.notifications n where n.id=new.notification_id;
 else appointment:=new.appointment_id;booking:=new.hospital_booking_id;end if;
 select 'PREG-'||r.booked_year::text||'-'||lpad(r.sequence_number::text,greatest(5,length(r.sequence_number::text)), '0')
 into reference from private.booking_email_references r where r.appointment_id=appointment or r.hospital_booking_id=booking;
 if reference is not null then new.payload:=new.payload||jsonb_build_object('bookingReference',reference);end if;
 return new;
end $$;
create trigger booking_reference before insert on private.appointment_email_snapshots for each row execute function private.add_booking_email_reference();
create trigger booking_reference before insert on private.contact_appointment_email_events for each row execute function private.add_booking_email_reference();
revoke all on function private.create_booking_email_reference(),private.add_booking_email_reference() from public,anon,authenticated;
-- Attempted jobs keep their original payload for provider idempotency.
update private.appointment_email_snapshots s set payload=s.payload||jsonb_build_object('bookingReference',
 'PREG-'||r.booked_year::text||'-'||lpad(r.sequence_number::text,greatest(5,length(r.sequence_number::text)),'0'))
from public.notifications n,private.booking_email_references r,private.notification_email_outbox o
where n.id=s.notification_id and o.notification_id=n.id and o.status='PENDING' and o.attempts=0
and (r.appointment_id=n.appointment_id or r.hospital_booking_id=n.hospital_booking_id);
update private.contact_appointment_email_events e set payload=e.payload||jsonb_build_object('bookingReference',
 'PREG-'||r.booked_year::text||'-'||lpad(r.sequence_number::text,greatest(5,length(r.sequence_number::text)),'0'))
from private.booking_email_references r,private.notification_email_outbox o
where o.contact_event_id=e.id and o.status='PENDING' and o.attempts=0
and (r.appointment_id=e.appointment_id or r.hospital_booking_id=e.hospital_booking_id);
commit;

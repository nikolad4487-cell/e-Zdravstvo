begin;
create table public.hospital_reschedules (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null references public.hospital_bookings(id),
 old_slot_id uuid not null references public.hospital_slots(id), new_slot_id uuid not null references public.hospital_slots(id),
 reason text not null check(length(trim(reason)) between 5 and 500), expected_version integer not null, request_id uuid not null,
 created_by uuid not null references public.profiles(id), created_at timestamptz not null default now(),
 unique(created_by,request_id), check(old_slot_id<>new_slot_id)
);
create index hospital_reschedules_booking_idx on public.hospital_reschedules(booking_id,created_at);
alter table public.hospital_reschedules enable row level security;
revoke all on public.hospital_reschedules from anon,authenticated;
create trigger no_delete before delete on public.hospital_reschedules for each row execute function private.no_clinical_delete();
create function private.preserve_hospital_reschedule() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Reschedule history is immutable';end $$;
create trigger immutable before update on public.hospital_reschedules for each row execute function private.preserve_hospital_reschedule();
create trigger audit_change after insert on public.hospital_reschedules for each row execute function private.audit_change();

create function public.reschedule_hospital_booking(booking_id uuid,new_slot_id uuid,expected_version integer,reason text,request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.hospital_bookings; old_slot public.hospital_slots; target public.hospital_slots; s public.hospital_services; prior public.hospital_reschedules; pid uuid;
begin
 select patient_id into pid from public.hospital_bookings where id=booking_id;
 if pid is null then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(pid::text,73));
 select * into b from public.hospital_bookings where id=booking_id for update;
 select * into old_slot from public.hospital_slots where id=b.slot_id;
 if not (private.treating_doctor(pid) is not null or private.hospital_provider(old_slot.service_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null or new_slot_id is null or expected_version is null or length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Invalid reschedule';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,74));
 select * into prior from public.hospital_reschedules r where r.created_by=auth.uid() and r.request_id=reschedule_hospital_booking.request_id;
 if prior.id is not null then
  if prior.booking_id<>booking_id or prior.new_slot_id<>new_slot_id or prior.expected_version<>expected_version or prior.reason<>trim(reason) then raise exception 'Request reused';end if; return;
 end if;
 if b.version<>expected_version then raise exception 'Booking changed' using errcode='40001';end if;
 if b.status<>'BOOKED' or old_slot.starts_at<=now() or b.slot_id=new_slot_id then raise exception 'Only future booked appointments can move';end if;
 perform 1 from public.hospital_slots where id in (b.slot_id,new_slot_id) order by id for update;
 select * into target from public.hospital_slots where id=new_slot_id;
 select * into s from public.hospital_services where id=target.service_id;
 if target.id is null or target.service_id<>old_slot.service_id or not target.active or not s.active or target.starts_at<=now() or (target.priority_only and not b.priority)
 or not exists(select 1 from public.doctors d where d.id=s.doctor_id and d.active and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id and r.role='DOCTOR' where m.user_id=d.user_id and m.institution_id=d.institution_id and m.active))
 or not exists(select 1 from public.institutions i where i.id=s.institution_id and i.active and i.archived_at is null) then raise exception 'Slot unavailable';end if;
 if exists(select 1 from public.hospital_bookings x where x.slot_id=new_slot_id and x.status<>'CANCELLED') then raise exception 'Slot booked' using errcode='23P01';end if;
 if exists(select 1 from public.hospital_bookings x join public.hospital_slots sl on sl.id=x.slot_id where x.patient_id=pid and x.id<>b.id and x.status<>'CANCELLED' and sl.starts_at<target.starts_at+make_interval(mins=>target.duration_minutes) and sl.starts_at+make_interval(mins=>sl.duration_minutes)>target.starts_at) then raise exception 'Patient overlap' using errcode='23P01';end if;
 insert into public.hospital_reschedules(booking_id,old_slot_id,new_slot_id,reason,expected_version,request_id,created_by) values(b.id,b.slot_id,new_slot_id,trim(reason),expected_version,request_id,auth.uid());
 update public.hospital_bookings set slot_id=new_slot_id,version=version+1,updated_at=now() where id=b.id;
 perform private.audit_event('HOSPITAL_BOOKING_RESCHEDULED','hospital_bookings',b.id);
end $$;
create function public.hospital_reschedule_history(booking_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.hospital_bookings; sid uuid;begin
 select * into b from public.hospital_bookings where id=booking_id; select service_id into sid from public.hospital_slots where id=b.slot_id;
 if b.id is null or not (private.treating_doctor(b.patient_id) is not null or private.hospital_provider(sid) or exists(select 1 from public.patients p where p.id=b.patient_id and p.user_id=auth.uid() and private.has_role('PATIENT'))) then raise exception 'Forbidden' using errcode='42501';end if;
 perform private.audit_event('HOSPITAL_BOOKING_VIEWED','hospital_bookings',b.id);
 return (select coalesce(jsonb_agg(x order by x.created_at desc),'[]') from (select r.id,r.created_at,r.reason,a.starts_at old_starts_at,z.starts_at new_starts_at from public.hospital_reschedules r join public.hospital_slots a on a.id=r.old_slot_id join public.hospital_slots z on z.id=r.new_slot_id where r.booking_id=b.id order by r.created_at desc limit 100)x);
end $$;
create or replace function public.list_hospital_bookings(mode text,patient_filter uuid default null,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or mode is null or mode not in ('CARE','PERSONAL','PROVIDER') or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid request';end if;
 select coalesce(jsonb_agg(x order by x.starts_at desc),'[]') into result from(select b.*,sl.starts_at,sl.duration_minutes,s.id service_id,s.name service_name,s.specialty,s.location,s.instructions,i.name institution_name,d.display_name specialist_name,p.first_name||' '||p.last_name patient_name,p.patient_number,
 (mode='CARE' and private.treating_doctor(p.id) is not null) or (mode='PERSONAL' and p.user_id=auth.uid() and private.has_role('PATIENT')) or (mode='PROVIDER' and private.hospital_provider(s.id)) can_cancel,
 mode='PROVIDER' and private.hospital_provider(s.id) can_process, b.status='BOOKED' and sl.starts_at>now() and ((mode='CARE' and private.treating_doctor(p.id) is not null) or (mode='PROVIDER' and private.hospital_provider(s.id))) can_reschedule
 from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id join public.patients p on p.id=b.patient_id
 where (patient_filter is null or b.patient_id=patient_filter) and case mode when 'PERSONAL' then p.user_id=auth.uid() and private.has_role('PATIENT') when 'PROVIDER' then private.hospital_provider(s.id) else private.treating_doctor(p.id) is not null end order by sl.starts_at desc,b.id limit 50 offset page_number*50)x;
 perform private.audit_event('HOSPITAL_BOOKINGS_VIEWED','hospital_bookings',patient_filter);return result;end $$;

revoke all on function private.preserve_hospital_reschedule() from public,anon,authenticated;
revoke all on function public.reschedule_hospital_booking(uuid,uuid,integer,text,uuid),public.hospital_reschedule_history(uuid) from public,anon;
grant execute on function public.reschedule_hospital_booking(uuid,uuid,integer,text,uuid),public.hospital_reschedule_history(uuid) to authenticated;
create or replace function private.hospital_booking_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if TG_OP='UPDATE' then insert into public.hospital_booking_history(booking_id,snapshot,created_by) values(old.id,to_jsonb(old),auth.uid());end if;
 insert into public.notifications(user_id,message) select p.user_id,'Bolnička narudžba: '||case when TG_OP='UPDATE' and new.slot_id<>old.slot_id then 'termin je premješten na '||to_char((select starts_at from public.hospital_slots where id=new.slot_id) at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||'.' else case new.status when 'BOOKED' then 'termin je potvrđen.' when 'CANCELLED' then 'termin je otkazan.' when 'COMPLETED' then 'pregled je završen.' else 'status je promijenjen.' end end from public.patients p where p.id=new.patient_id and p.user_id is not null;
 insert into public.schedule_events(user_id,revision) select d.user_id,gen_random_uuid() from public.doctors d where d.id=new.referring_doctor_id or d.id=(select s.doctor_id from public.hospital_slots sl join public.hospital_services s on s.id=sl.service_id where sl.id=new.slot_id) on conflict(user_id) do update set revision=excluded.revision;
 return new;end $$;

commit;

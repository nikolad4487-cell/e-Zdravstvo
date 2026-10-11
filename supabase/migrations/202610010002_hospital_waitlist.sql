-- Recovered from the existing project migration history; do not reapply there.
begin;

create table public.hospital_waitlist (
 id uuid primary key default gen_random_uuid(), booking_id uuid not null unique references public.hospital_bookings(id),
 active boolean not null default true, joined_at timestamptz not null default now(),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid not null references public.profiles(id)
);

create table public.hospital_waitlist_offers (
 id uuid primary key default gen_random_uuid(), waitlist_id uuid not null references public.hospital_waitlist(id),
 slot_id uuid not null references public.hospital_slots(id), booking_version integer not null,
 status text not null default 'PENDING' check(status in ('PENDING','ACCEPTED','DECLINED','EXPIRED','UNAVAILABLE')),
 expires_at timestamptz not null, created_at timestamptz not null default now(), responded_at timestamptz,
 unique(waitlist_id,slot_id)
);

create unique index hospital_offer_slot_pending on public.hospital_waitlist_offers(slot_id) where status='PENDING';

create unique index hospital_offer_wait_pending on public.hospital_waitlist_offers(waitlist_id) where status='PENDING';

create index hospital_wait_active on public.hospital_waitlist(joined_at) where active;

do $$declare t text;begin foreach t in array array['hospital_waitlist','hospital_waitlist_offers'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
end loop;end $$;

-- Offers are invitations, not exclusive reservations. All acceptance paths recheck availability.
create function private.hospital_offer_available(offer_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hospital_waitlist_offers o join public.hospital_waitlist w on w.id=o.waitlist_id
 join public.hospital_bookings b on b.id=w.booking_id join public.hospital_slots original on original.id=b.slot_id
 join public.hospital_slots target on target.id=o.slot_id join public.hospital_services s on s.id=target.service_id
 join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id
 where o.id=offer_id and o.status='PENDING' and o.expires_at>now() and w.active and b.status='BOOKED' and b.version=o.booking_version
 and original.service_id=target.service_id and target.starts_at>now()+interval '2 hours' and target.starts_at<original.starts_at
 and target.active and s.active and i.active and i.archived_at is null and d.active and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id and r.role='DOCTOR' where m.user_id=d.user_id and m.institution_id=d.institution_id and m.active) and (not target.priority_only or b.priority)
 and not exists(select 1 from public.hospital_bookings taken where taken.slot_id=target.id and taken.status<>'CANCELLED'))
$$;

create function private.waitlist_offer_authorized(booking uuid,target uuid,request uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.has_role('PATIENT') and exists(select 1 from public.hospital_waitlist_offers o join public.hospital_waitlist w on w.id=o.waitlist_id
 join public.hospital_bookings b on b.id=w.booking_id join public.patients p on p.id=b.patient_id
 where o.id=request and b.id=booking and o.slot_id=target and p.user_id=auth.uid() and p.archived_at is null and private.hospital_offer_available(o.id))
$$;

create function private.process_hospital_waitlist() returns integer language plpgsql security definer set search_path='' as $$
declare candidate record; inserted integer:=0;begin
 if not pg_try_advisory_xact_lock(8102026) then return 0;end if;
 update public.hospital_waitlist_offers o set status=case when expires_at<=now() then 'EXPIRED' else 'UNAVAILABLE' end,responded_at=now()
 where status='PENDING' and not private.hospital_offer_available(o.id);
 update public.hospital_waitlist w set active=false,updated_at=now() from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id
 where w.booking_id=b.id and w.active and (b.status<>'BOOKED' or sl.starts_at<=now());
 -- One invitation per slot and per booking; priority first, then time of joining.
 for candidate in select w.id wait_id,b.version,b.priority,b.patient_id,p.user_id,sl.id slot_id,sl.starts_at
 from public.hospital_waitlist w join public.hospital_bookings b on b.id=w.booking_id join public.patients p on p.id=b.patient_id
 join public.hospital_slots original on original.id=b.slot_id join public.hospital_slots sl on sl.service_id=original.service_id
 join public.hospital_services s on s.id=sl.service_id join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id
 where w.active and b.status='BOOKED' and p.archived_at is null and p.user_id is not null and exists(select 1 from public.user_roles r where r.user_id=p.user_id and r.role='PATIENT')
 and sl.active and s.active and i.active and i.archived_at is null and d.active and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id and r.role='DOCTOR' where m.user_id=d.user_id and m.institution_id=d.institution_id and m.active)
 and sl.starts_at>now()+interval '2 hours' and sl.starts_at<original.starts_at and (not sl.priority_only or b.priority)
 and not exists(select 1 from public.hospital_bookings used where used.slot_id=sl.id and used.status<>'CANCELLED')
 and not exists(select 1 from public.hospital_waitlist_offers old where old.waitlist_id=w.id and old.slot_id=sl.id)
 and not exists(select 1 from public.hospital_bookings other join public.hospital_slots os on os.id=other.slot_id where other.patient_id=b.patient_id and other.id<>b.id and other.status<>'CANCELLED' and os.starts_at<sl.starts_at+make_interval(mins=>sl.duration_minutes) and os.starts_at+make_interval(mins=>os.duration_minutes)>sl.starts_at)
 order by b.priority desc,w.joined_at,w.id,sl.starts_at limit 1000
 loop
  if exists(select 1 from public.hospital_waitlist_offers o where o.status='PENDING' and (o.waitlist_id=candidate.wait_id or o.slot_id=candidate.slot_id)) then continue;end if;
  insert into public.hospital_waitlist_offers(waitlist_id,slot_id,booking_version,expires_at) values(candidate.wait_id,candidate.slot_id,candidate.version,least(now()+interval '24 hours',candidate.starts_at-interval '2 hours'));
  insert into public.notifications(user_id,message) values(candidate.user_id,'Dostupan je prijedlog ranijeg bolničkog termina. Otvorite Narudžbe za detalje i rok odgovora.');
  inserted:=inserted+1;if inserted>=100 then exit;end if;
 end loop;
 return inserted;
end $$;

create function public.set_hospital_waitlist(booking_id uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$
declare b public.hospital_bookings;begin
 perform pg_advisory_xact_lock(8102026);
 select * into b from public.hospital_bookings where id=booking_id for update;
 if enabled is null or b.id is null or not private.has_role('PATIENT') or not exists(select 1 from public.patients p where p.id=b.patient_id and p.user_id=auth.uid() and p.archived_at is null) then raise exception 'Forbidden' using errcode='42501';end if;
 if enabled and (b.status<>'BOOKED' or not exists(select 1 from public.hospital_slots sl where sl.id=b.slot_id and sl.starts_at>now()+interval '2 hours')) then raise exception 'Future booking required';end if;
 insert into public.hospital_waitlist(booking_id,active,created_by) values(b.id,enabled,auth.uid())
 on conflict on constraint hospital_waitlist_booking_id_key do update set active=excluded.active,joined_at=case when not hospital_waitlist.active and excluded.active then now() else hospital_waitlist.joined_at end,updated_at=now();
 if not enabled then update public.hospital_waitlist_offers set status='UNAVAILABLE',responded_at=now() where waitlist_id=(select id from public.hospital_waitlist where hospital_waitlist.booking_id=b.id) and status='PENDING';end if;
 perform private.audit_event('HOSPITAL_WAITLIST_UPDATED','hospital_bookings',b.id);
end $$;

create function public.my_hospital_waitlist() returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(x),'[]') into result from (
 select w.id,w.booking_id,w.active and b.status='BOOKED' and original.starts_at>now() active,s.name service_name,i.name institution_name,original.starts_at,
 (select coalesce(jsonb_agg(y order by y.created_at desc),'[]') from (select o.id,sl.starts_at,o.expires_at,o.created_at,case when o.status='PENDING' and o.expires_at<=now() then 'EXPIRED' when o.status='PENDING' and not private.hospital_offer_available(o.id) then 'UNAVAILABLE' else o.status end status
 from public.hospital_waitlist_offers o join public.hospital_slots sl on sl.id=o.slot_id where o.waitlist_id=w.id order by o.created_at desc limit 10)y) offers
 from public.hospital_waitlist w join public.hospital_bookings b on b.id=w.booking_id join public.patients p on p.id=b.patient_id join public.hospital_slots original on original.id=b.slot_id
 join public.hospital_services s on s.id=original.service_id join public.institutions i on i.id=s.institution_id where p.user_id=auth.uid() and p.archived_at is null order by w.updated_at desc limit 100)x;
 perform private.audit_event('HOSPITAL_WAITLIST_VIEWED','patients',(select id from public.patients where user_id=auth.uid() and archived_at is null));return result;
end $$;

create function public.respond_hospital_offer(offer_id uuid,accept boolean) returns void language plpgsql security definer set search_path='' as $$
declare o public.hospital_waitlist_offers; b public.hospital_bookings;bid uuid;pid uuid;begin
 perform pg_advisory_xact_lock(8102026);
 select w.booking_id,bk.patient_id into bid,pid from public.hospital_waitlist_offers x join public.hospital_waitlist w on w.id=x.waitlist_id join public.hospital_bookings bk on bk.id=w.booking_id where x.id=offer_id;
 if bid is null or accept is null or not private.has_role('PATIENT') or not exists(select 1 from public.patients p where p.id=pid and p.user_id=auth.uid()) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(pid::text,73));
 select * into b from public.hospital_bookings where id=bid for update;
 select * into o from public.hospital_waitlist_offers where id=offer_id for update;
 if (accept and o.status='ACCEPTED') or (not accept and o.status='DECLINED') then return;end if;
 if not private.hospital_offer_available(o.id) then raise exception 'Offer expired or unavailable' using errcode='40001';end if;
 if accept then perform public.reschedule_hospital_booking(b.id,o.slot_id,o.booking_version,'Pacijent je prihvatio ponudu ranijeg termina.',o.id);
 else update public.hospital_waitlist_offers set status='DECLINED',responded_at=now() where id=o.id;end if;
 perform private.audit_event(case when accept then 'HOSPITAL_OFFER_ACCEPTED' else 'HOSPITAL_OFFER_DECLINED' end,'hospital_bookings',b.id);
end $$;

revoke all on function private.hospital_offer_available(uuid),private.waitlist_offer_authorized(uuid,uuid,uuid),private.process_hospital_waitlist() from public,anon,authenticated;

revoke all on function public.set_hospital_waitlist(uuid,boolean),public.my_hospital_waitlist(),public.respond_hospital_offer(uuid,boolean) from public,anon;

grant execute on function public.set_hospital_waitlist(uuid,boolean),public.my_hospital_waitlist(),public.respond_hospital_offer(uuid,boolean) to authenticated;

create or replace function public.reschedule_hospital_booking(booking_id uuid,new_slot_id uuid,expected_version integer,reason text,request_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare b public.hospital_bookings; old_slot public.hospital_slots; target public.hospital_slots; s public.hospital_services; prior public.hospital_reschedules; pid uuid;
begin
 perform pg_advisory_xact_lock(8102026);
 select patient_id into pid from public.hospital_bookings where id=booking_id;
 if pid is null then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(pid::text,73));
 select * into b from public.hospital_bookings where id=booking_id for update;
 select * into old_slot from public.hospital_slots where id=b.slot_id;
 if not (private.treating_doctor(pid) is not null or private.hospital_provider(old_slot.service_id) or private.waitlist_offer_authorized(b.id,new_slot_id,request_id)) then raise exception 'Forbidden' using errcode='42501';end if;
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
 update public.hospital_waitlist_offers o set status='ACCEPTED',responded_at=now() where o.id=request_id and o.status='PENDING' and o.slot_id=new_slot_id and exists(select 1 from public.hospital_waitlist w where w.id=o.waitlist_id and w.booking_id=b.id);
 if found then update public.hospital_waitlist set active=false,updated_at=now() where hospital_waitlist.booking_id=b.id;end if;
 perform private.audit_event('HOSPITAL_BOOKING_RESCHEDULED','hospital_bookings',b.id);
end $$;

do $$begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $job$select cron.schedule('ez-hospital-waitlist','*/5 * * * *','select private.process_hospital_waitlist()')$job$;
 end if;
end $$;

commit;

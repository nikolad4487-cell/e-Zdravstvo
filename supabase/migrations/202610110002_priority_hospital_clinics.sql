begin;
create table public.hospital_departments(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.institutions(id),
 name text not null check(length(trim(name)) between 2 and 150),duration_minutes integer not null check(duration_minutes in (15,30)),
 active boolean not null default true,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(institution_id,name),unique(id,institution_id)
);
alter table public.hospital_services add column department_id uuid;
alter table public.hospital_services add constraint hospital_service_department foreign key(department_id,institution_id) references public.hospital_departments(id,institution_id);
alter table public.hospital_slots add column clinic_generated boolean not null default false;
-- Preserve the existing hospital directory; administrators can change the default duration.
insert into public.hospital_departments(institution_id,name,duration_minutes,created_by)
select distinct on (institution_id,trim(specialty)) institution_id,trim(specialty),30,created_by
from public.hospital_services order by institution_id,trim(specialty),created_at,id;
update public.hospital_services s set department_id=h.id from public.hospital_departments h where h.institution_id=s.institution_id and h.name=trim(s.specialty);
create table public.hospital_clinic_shifts(
 id uuid not null unique default gen_random_uuid(),
 service_id uuid not null references public.hospital_services(id),weekday integer not null check(weekday between 1 and 7),
 shift text not null check(shift in ('MORNING','AFTERNOON')),updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),primary key(service_id,weekday)
);
create table private.priority_booking_requests(
 user_id uuid not null references public.profiles(id),request_id uuid not null,input jsonb not null,booking_id uuid not null references public.hospital_bookings(id),primary key(user_id,request_id)
);
alter table public.hospital_departments enable row level security;
alter table public.hospital_clinic_shifts enable row level security;
revoke all on public.hospital_departments,public.hospital_clinic_shifts from anon,authenticated;
create trigger audit_change after insert or update on public.hospital_departments for each row execute function private.audit_change();
create trigger no_delete before delete on public.hospital_departments for each row execute function private.no_clinical_delete();
create trigger audit_change after insert or update or delete on public.hospital_clinic_shifts for each row execute function private.audit_change();

create function public.priority_hospital_context(manage boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or manage is null or not(private.has_role('DOCTOR') or private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN')) then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object(
 'departments',(select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('institution_name',i.name) order by i.name,h.name,h.id),'[]') from public.hospital_departments h join public.institutions i on i.id=h.institution_id
 where i.active and i.archived_at is null and (case when manage then private.hospital_admin(i.id) or exists(select 1 from public.hospital_services s where s.department_id=h.id and private.hospital_provider(s.id)) else h.active end)),
 'services',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('institution_name',i.name,'doctor_name',d.display_name,'department_name',h.name,'duration_minutes',h.duration_minutes,
 'shifts',(select coalesce(jsonb_agg(jsonb_build_object('weekday',c.weekday,'shift',c.shift) order by c.weekday),'[]') from public.hospital_clinic_shifts c where c.service_id=s.id)) order by i.name,h.name,d.display_name,s.name,s.id),'[]')
 from public.hospital_services s join public.hospital_departments h on h.id=s.department_id join public.institutions i on i.id=s.institution_id join public.doctors d on d.id=s.doctor_id
 where i.active and i.archived_at is null and (case when manage then private.hospital_admin(i.id) or private.hospital_provider(s.id) else s.active and h.active and d.active and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id where m.user_id=d.user_id and m.institution_id=s.institution_id and m.active and r.role='DOCTOR') end)));
end $$;
create function public.save_hospital_department(department_id uuid,institution_id uuid,name text,duration_minutes integer,active boolean default true) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if not private.hospital_admin(institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if name is null or length(trim(name)) not between 2 and 150 or duration_minutes is null or duration_minutes not in (15,30) or active is null
 or not exists(select 1 from public.institutions i where i.id=institution_id and i.active and i.archived_at is null) then raise exception 'Invalid department';end if;
 if department_id is null then insert into public.hospital_departments(institution_id,name,duration_minutes,active,created_by) values(institution_id,trim(name),duration_minutes,active,auth.uid()) returning id into result;
 else update public.hospital_departments h set name=trim(save_hospital_department.name),duration_minutes=save_hospital_department.duration_minutes,active=save_hospital_department.active where h.id=department_id and h.institution_id=save_hospital_department.institution_id returning id into result;
 if result is null then raise exception 'Department unavailable';end if;end if;
 perform private.audit_event('HOSPITAL_DEPARTMENT_SAVED','hospital_departments',result);return result;
end $$;
create function public.assign_hospital_department(service_id uuid,department_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;
begin
 select * into s from public.hospital_services where id=service_id for update;
 if s.id is null or not private.hospital_admin(s.institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.hospital_departments h where h.id=department_id and h.institution_id=s.institution_id and h.active) then raise exception 'Department unavailable';end if;
 update public.hospital_services set department_id=assign_hospital_department.department_id where id=service_id;
 perform private.audit_event('HOSPITAL_DEPARTMENT_ASSIGNED','hospital_services',service_id);
end $$;
create function public.create_priority_hospital_service(department_id uuid,doctor_id uuid,name text,specialty text,location text,instructions text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare h public.hospital_departments;result uuid;
begin
 select * into h from public.hospital_departments where id=department_id;
 if h.id is null or not private.hospital_admin(h.institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if not h.active then raise exception 'Department unavailable';end if;
 result:=public.save_hospital_service(null,jsonb_build_object('institution_id',h.institution_id,'doctor_id',doctor_id,'name',name,'specialty',specialty,'location',location,'instructions',instructions));
 perform public.assign_hospital_department(result,department_id);return result;
end $$;
revoke all on function public.create_priority_hospital_service(uuid,uuid,text,text,text,text) from public,anon;
grant execute on function public.create_priority_hospital_service(uuid,uuid,text,text,text,text) to authenticated;
create function public.set_hospital_clinic_shift(service_id uuid,weekday integer,shift text) returns void language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;doctor_user uuid;hours_start time;hours_end time;
begin
 select * into s from public.hospital_services where id=service_id;
 if s.id is null or not(private.hospital_provider(s.id) or private.hospital_admin(s.institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if s.department_id is null or not s.active or weekday is null or weekday not between 1 and 7 or (shift is not null and shift not in ('MORNING','AFTERNOON')) then raise exception 'Invalid clinic shift';end if;
 select user_id into doctor_user from public.doctors where id=s.doctor_id;
 perform pg_advisory_xact_lock(hashtextextended('doctor:'||doctor_user::text,910));
 if shift is null then delete from public.hospital_clinic_shifts c where c.service_id=set_hospital_clinic_shift.service_id and c.weekday=set_hospital_clinic_shift.weekday;
 else insert into public.hospital_clinic_shifts(service_id,weekday,shift,updated_by) values(service_id,weekday,shift,auth.uid())
 on conflict on constraint hospital_clinic_shifts_pkey do update set shift=excluded.shift,updated_by=auth.uid(),updated_at=now();end if;
 select min(case c.shift when 'MORNING' then time '07:00' else time '13:30' end),max(case c.shift when 'MORNING' then time '13:30' else time '19:00' end) into hours_start,hours_end
 from public.hospital_clinic_shifts c join public.hospital_services hs on hs.id=c.service_id where hs.doctor_id=s.doctor_id and hs.active and c.weekday=set_hospital_clinic_shift.weekday;
 perform public.set_doctor_hours(s.doctor_id,weekday,coalesce(hours_start,time '07:00'),coalesce(hours_end,time '13:30'),hours_start is not null);
 perform private.audit_event('HOSPITAL_CLINIC_SHIFT_CHANGED','hospital_services',service_id);
end $$;

create function private.valid_priority_clinic_slot(service uuid,starts timestamptz,minutes integer) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.hospital_services s join public.hospital_departments h on h.id=s.department_id join public.doctors d on d.id=s.doctor_id join public.institutions i on i.id=s.institution_id
 join public.hospital_clinic_shifts c on c.service_id=s.id and c.weekday=extract(isodow from starts at time zone 'Europe/Zagreb')
 where s.id=service and s.active and h.active and d.active and i.active and i.archived_at is null and starts>now() and starts<=now()+interval '365 days' and h.duration_minutes=minutes
 and exists(select 1 from public.institution_users m join public.user_roles r on r.user_id=m.user_id and r.institution_id=m.institution_id where m.user_id=d.user_id and m.institution_id=s.institution_id and m.active and r.role='DOCTOR')
 and (starts at time zone 'Europe/Zagreb')::time >= case c.shift when 'MORNING' then time '07:00' else time '13:30' end
 and ((starts+make_interval(mins=>minutes)) at time zone 'Europe/Zagreb')::time <= case c.shift when 'MORNING' then time '13:30' else time '19:00' end
 and (starts at time zone 'Europe/Zagreb')::date=((starts+make_interval(mins=>minutes)) at time zone 'Europe/Zagreb')::date
 and mod(extract(epoch from ((starts at time zone 'Europe/Zagreb')::time-case c.shift when 'MORNING' then time '07:00' else time '13:30' end))::numeric,minutes*60)=0
 and not exists(select 1 from public.doctor_absences a join public.doctors ad on ad.id=a.doctor_id where ad.user_id=d.user_id and a.cancelled_at is null and a.starts_at<starts+make_interval(mins=>minutes) and a.ends_at>starts)
 and (not exists(select 1 from public.doctor_working_hours w where w.doctor_id=d.id) or exists(select 1 from public.doctor_working_hours w where w.doctor_id=d.id and w.weekday=c.weekday and w.starts_at<=(starts at time zone 'Europe/Zagreb')::time and w.ends_at>=((starts+make_interval(mins=>minutes)) at time zone 'Europe/Zagreb')::time))
 )
$$;
create function public.priority_hospital_slots(patient_id uuid,service_id uuid,date_from date,date_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;minutes integer;result jsonb;
begin
 if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if date_from is null or date_to is null or date_to<date_from or date_to-date_from>31 then raise exception 'Range up to 31 days';end if;
 select * into s from public.hospital_services where id=service_id;
 if s.id is null or s.department_id is null then raise exception 'Clinic unavailable';end if;
 select duration_minutes into minutes from public.hospital_departments where id=s.department_id;
 select coalesce(jsonb_agg(jsonb_build_object('starts_at',t.starts_at,'duration_minutes',minutes) order by t.starts_at),'[]') into result
 from generate_series(date_from::timestamp,date_to::timestamp,interval '1 day') day
 join public.hospital_clinic_shifts c on c.service_id=s.id and c.weekday=extract(isodow from day)
 cross join lateral generate_series(day::date+case c.shift when 'MORNING' then time '07:00' else time '13:30' end,
 day::date+case c.shift when 'MORNING' then time '13:30' else time '19:00' end-make_interval(mins=>minutes),make_interval(mins=>minutes)) local_time
 cross join lateral (select local_time at time zone 'Europe/Zagreb' starts_at)t
 where private.valid_priority_clinic_slot(s.id,t.starts_at,minutes)
 and not exists(select 1 from public.hospital_slots sl where sl.service_id=s.id and sl.starts_at=t.starts_at and (not sl.active or sl.duration_minutes<>minutes or exists(select 1 from public.hospital_bookings b where b.slot_id=sl.id and b.status<>'CANCELLED')))
 and not exists(select 1 from public.appointments a join public.doctors d on d.id=a.doctor_id where (a.patient_id=priority_hospital_slots.patient_id or d.user_id=(select sd.user_id from public.doctors sd where sd.id=s.doctor_id)) and a.status in ('SCHEDULED','ARRIVED','IN_PROGRESS') and a.starts_at<t.starts_at+make_interval(mins=>minutes) and a.starts_at+make_interval(mins=>a.duration_minutes)>t.starts_at)
 and not exists(select 1 from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services hs on hs.id=sl.service_id join public.doctors d on d.id=hs.doctor_id where (b.patient_id=priority_hospital_slots.patient_id or d.user_id=(select sd.user_id from public.doctors sd where sd.id=s.doctor_id)) and b.status in ('BOOKED','ARRIVED') and sl.starts_at<t.starts_at+make_interval(mins=>minutes) and sl.starts_at+make_interval(mins=>sl.duration_minutes)>t.starts_at);
 perform private.audit_event('PRIORITY_HOSPITAL_AVAILABILITY_VIEWED','patients',patient_id);return result;
end $$;
create function public.priority_hospital_referrals(patient_id uuid,service_id uuid,starts_at timestamptz,search_term text default '',page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;chosen_specialty text;
begin
 if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if starts_at is null or search_term is null or length(search_term)>100 or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid referral search';end if;
 select s.specialty into chosen_specialty from public.hospital_services s where s.id=service_id and s.active and s.department_id is not null;
 if chosen_specialty is null then raise exception 'Clinic unavailable';end if;
 select coalesce(jsonb_agg(x order by x.issued_at desc,x.id),'[]') into result from(
 select d.id,d.number,d.expires_on,d.issued_at from public.documents d join public.referrals r on r.document_id=d.id
 where d.patient_id=priority_hospital_referrals.patient_id and d.kind='REFERRAL' and d.status='ISSUED' and d.expires_on>=(starts_at at time zone 'Europe/Zagreb')::date
 and r.referral_type in ('SPECIALIST','HOSPITAL','FOLLOW_UP') and lower(trim(r.specialty))=lower(trim(chosen_specialty))
 and (search_term='' or position(lower(trim(search_term)) in lower(d.number))>0)
 and not exists(select 1 from public.hospital_bookings b where b.referral_id=d.id and b.status<>'CANCELLED')
 order by d.issued_at desc,d.id limit 50 offset page_number*50)x;return result;
end $$;
create function public.book_priority_hospital(patient_id uuid,service_id uuid,starts_at timestamptz,referral_id uuid,new_referral jsonb,priority_reason text,request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;h public.hospital_departments;slot uuid;ref uuid:=referral_id;booking uuid;prior private.priority_booking_requests;
 input jsonb:=jsonb_build_object('patient',patient_id,'service',service_id,'starts',starts_at,'referral',referral_id,'new_referral',new_referral,'reason',priority_reason);
begin
 if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null or starts_at is null or length(trim(coalesce(priority_reason,''))) not between 5 and 1000 or ((referral_id is null)=(new_referral is null)) then raise exception 'Referral and priority reason required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into prior from private.priority_booking_requests r where r.user_id=auth.uid() and r.request_id=book_priority_hospital.request_id;
 if prior.booking_id is not null then if prior.input<>input then raise exception 'Request reused';end if;return jsonb_build_object('booking_id',prior.booking_id,'referral_id',(select b.referral_id from public.hospital_bookings b where b.id=prior.booking_id));end if;
 select * into s from public.hospital_services where id=service_id;
 if s.id is null then raise exception 'Clinic unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,72));
 perform pg_advisory_xact_lock(hashtextextended(patient_id::text,73));
 perform private.assert_schedule_available(patient_id,s.doctor_id,starts_at,(select duration_minutes from public.hospital_departments where id=s.department_id));
 select * into s from public.hospital_services where id=service_id for share;
 select * into h from public.hospital_departments where id=s.department_id for share;
 if not private.valid_priority_clinic_slot(s.id,starts_at,h.duration_minutes) then raise exception 'Clinic slot unavailable' using errcode='23P01';end if;
 insert into public.hospital_slots(service_id,starts_at,duration_minutes,priority_only,created_by,clinic_generated) values(s.id,starts_at,h.duration_minutes,true,auth.uid(),true) on conflict on constraint hospital_slots_service_id_starts_at_key do nothing;
 select sl.id into slot from public.hospital_slots sl where sl.service_id=s.id and sl.starts_at=book_priority_hospital.starts_at and sl.active and sl.duration_minutes=h.duration_minutes for update;
 if slot is null or exists(select 1 from public.hospital_bookings b where b.slot_id=slot and b.status<>'CANCELLED') then raise exception 'Slot unavailable' using errcode='23P01';end if;
 if new_referral is not null then
 if jsonb_typeof(new_referral)<>'object' or length(trim(coalesce(new_referral->>'reason',''))) not between 5 and 4000 or (new_referral->>'expires_on')::date<(starts_at at time zone 'Europe/Zagreb')::date then raise exception 'Valid referral details required';end if;
 if exists(select 1 from public.documents d where d.created_by=auth.uid() and d.request_id=book_priority_hospital.request_id) then raise exception 'Request reused';end if;
 ref:=public.issue_document(patient_id,'REFERRAL',jsonb_build_object('referral_type','SPECIALIST','specialty',s.specialty,'reason',new_referral->>'reason','expires_on',new_referral->>'expires_on','priority','REGULAR','notes',coalesce(new_referral->>'notes','')),request_id);
 end if;
 perform 1 from public.documents d join public.referrals r on r.document_id=d.id where d.id=ref and d.patient_id=book_priority_hospital.patient_id and d.kind='REFERRAL' and d.status='ISSUED' and d.expires_on>=(starts_at at time zone 'Europe/Zagreb')::date and r.referral_type in ('SPECIALIST','HOSPITAL','FOLLOW_UP') and lower(trim(r.specialty))=lower(trim(s.specialty)) for share of d;
 if not found then raise exception 'Matching valid patient referral required';end if;
 booking:=public.book_hospital_slot(patient_id,slot,ref,true,priority_reason,request_id);
 insert into private.priority_booking_requests(user_id,request_id,input,booking_id) values(auth.uid(),request_id,input,booking);
 return jsonb_build_object('booking_id',booking,'referral_id',ref);
end $$;
-- Generated slots cannot bypass the current clinic schedule via older booking clients.
create function private.check_priority_clinic_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare sl public.hospital_slots;
begin
 if new.status in ('BOOKED','ARRIVED') and (TG_OP='INSERT' or new.slot_id is distinct from old.slot_id) then
 select * into sl from public.hospital_slots where id=new.slot_id;
 if sl.clinic_generated then
 if not new.priority or new.referral_id is null or not private.valid_priority_clinic_slot(sl.service_id,sl.starts_at,sl.duration_minutes) then raise exception 'Clinic slot unavailable' using errcode='23P01';end if;
 if not exists(select 1 from public.documents d join public.referrals r on r.document_id=d.id join public.hospital_services s on s.id=sl.service_id where d.id=new.referral_id and d.patient_id=new.patient_id and d.kind='REFERRAL' and d.status='ISSUED' and d.expires_on>=(sl.starts_at at time zone 'Europe/Zagreb')::date and r.referral_type in ('SPECIALIST','HOSPITAL','FOLLOW_UP') and lower(trim(r.specialty))=lower(trim(s.specialty))) then raise exception 'Matching valid patient referral required';end if;
 end if;end if;return new;
end $$;
create trigger priority_clinic_booking before insert or update of slot_id on public.hospital_bookings for each row execute function private.check_priority_clinic_booking();
revoke all on function private.valid_priority_clinic_slot(uuid,timestamptz,integer),private.check_priority_clinic_booking() from public,anon,authenticated;
revoke all on function public.priority_hospital_context(boolean),public.save_hospital_department(uuid,uuid,text,integer,boolean),public.assign_hospital_department(uuid,uuid),public.set_hospital_clinic_shift(uuid,integer,text),public.priority_hospital_slots(uuid,uuid,date,date),public.priority_hospital_referrals(uuid,uuid,timestamptz,text,integer),public.book_priority_hospital(uuid,uuid,timestamptz,uuid,jsonb,text,uuid) from public,anon;
grant execute on function public.priority_hospital_context(boolean),public.save_hospital_department(uuid,uuid,text,integer,boolean),public.assign_hospital_department(uuid,uuid),public.set_hospital_clinic_shift(uuid,integer,text),public.priority_hospital_slots(uuid,uuid,date,date),public.priority_hospital_referrals(uuid,uuid,timestamptz,text,integer),public.book_priority_hospital(uuid,uuid,timestamptz,uuid,jsonb,text,uuid) to authenticated;
commit;

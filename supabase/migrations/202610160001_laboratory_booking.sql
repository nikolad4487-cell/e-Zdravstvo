begin;
alter table public.hospital_services add column booking_kind text not null default 'SPECIALIST' check(booking_kind in('SPECIALIST','LABORATORY')),add column procedure_code text not null default '' check(length(procedure_code)<=40);
alter table public.hospital_bookings add column laboratory_details jsonb;
create table public.hospital_laboratory_tests(
 id uuid primary key default gen_random_uuid(),service_id uuid not null references public.hospital_services(id),
 code text not null check(length(trim(code)) between 1 and 40),name text not null check(length(trim(name)) between 2 and 200),
 required_time time, instructions text not null default '' check(length(instructions)<=4000),
 steps jsonb not null default '[]' check(jsonb_typeof(steps)='array' and jsonb_array_length(steps)<=10),
 active boolean not null default true,updated_by uuid not null references public.profiles(id),updated_at timestamptz not null default now(),unique(service_id,code)
);
alter table public.hospital_laboratory_tests enable row level security;
revoke all on public.hospital_laboratory_tests from public,anon,authenticated;
create trigger audit_change after insert or update on public.hospital_laboratory_tests for each row execute function private.audit_change();
create trigger no_delete before delete on public.hospital_laboratory_tests for each row execute function private.no_clinical_delete();
create function public.configure_hospital_laboratory(service_id uuid,procedure_code text) returns void language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;
begin
 select * into s from public.hospital_services where id=service_id for update;
 if s.id is null or not private.hospital_admin(s.institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if s.booking_kind<>'LABORATORY' and exists(select 1 from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id where sl.service_id=s.id) then raise exception 'Create a separate laboratory service for existing bookings';end if;
 if length(trim(coalesce(procedure_code,''))) not between 1 and 40 then raise exception 'Procedure code required';end if;
 update public.hospital_services set booking_kind='LABORATORY',procedure_code=trim(configure_hospital_laboratory.procedure_code),updated_at=now() where id=service_id;
 perform private.audit_event('LABORATORY_SERVICE_CONFIGURED','hospital_services',service_id);
end $$;
create function public.create_hospital_laboratory(department_id uuid,doctor_id uuid,name text,specialty text,location text,instructions text,procedure_code text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 result:=public.create_priority_hospital_service(department_id,doctor_id,name,specialty,location,instructions);
 perform public.configure_hospital_laboratory(result,procedure_code);return result;
end $$;
revoke all on function public.create_hospital_laboratory(uuid,uuid,text,text,text,text,text) from public,anon;
grant execute on function public.create_hospital_laboratory(uuid,uuid,text,text,text,text,text) to authenticated;
create function public.save_hospital_laboratory_test(service_id uuid,test_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;result uuid;step jsonb;new_steps jsonb:=coalesce(data->'steps','[]');
begin
 select * into s from public.hospital_services where id=service_id for share;
 if s.id is null or not(private.hospital_admin(s.institution_id) or private.hospital_provider(service_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if s.booking_kind<>'LABORATORY' then raise exception 'Laboratory service required';end if;
 if jsonb_typeof(new_steps) is distinct from 'array' or jsonb_array_length(new_steps)>10 or length(coalesce(data->>'instructions',''))>4000 then raise exception 'Invalid laboratory instructions';end if;
 for step in select * from jsonb_array_elements(new_steps) loop
 if jsonb_typeof(step) is distinct from 'object' or length(trim(coalesce(step->>'label',''))) not between 2 and 200 or coalesce(step->>'day_offset','') !~ '^-?[0-9]{1,2}$' or (step->>'day_offset')::integer not between -7 and 7 or coalesce(step->>'time','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or length(coalesce(step->>'instructions',''))>2000 then raise exception 'Invalid protocol step';end if;
 end loop;
 if test_id is null then
 insert into public.hospital_laboratory_tests(service_id,code,name,required_time,instructions,steps,active,updated_by)
 values(service_id,trim(data->>'code'),trim(data->>'name'),nullif(data->>'required_time','')::time,coalesce(data->>'instructions',''),new_steps,coalesce((data->>'active')::boolean,true),auth.uid()) returning id into result;
 else
 update public.hospital_laboratory_tests t set code=trim(data->>'code'),name=trim(data->>'name'),required_time=nullif(data->>'required_time','')::time,instructions=coalesce(data->>'instructions',''),steps=new_steps,active=coalesce((data->>'active')::boolean,true),updated_by=auth.uid(),updated_at=now() where t.id=test_id and t.service_id=save_hospital_laboratory_test.service_id returning id into result;
 if result is null then raise exception 'Test unavailable';end if;
 end if;
 perform private.audit_event('LABORATORY_TEST_SAVED','hospital_laboratory_tests',result);return result;
end $$;
create function private.laboratory_booking_details(service uuid,test_ids uuid[],sampling_method text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.hospital_services;tests jsonb;required_times integer;
begin
 select * into s from public.hospital_services where id=service and booking_kind='LABORATORY' and active;
 if s.id is null or test_ids is null or cardinality(test_ids) not between 1 and 20 or (select count(distinct x) from unnest(test_ids)x)<>cardinality(test_ids) or sampling_method is null or sampling_method not in('VENIPUNCTURE','CANNULA','OTHER') then raise exception 'Select laboratory tests and sampling method';end if;
 if (select count(*) from public.hospital_laboratory_tests t where t.id=any(test_ids) and t.service_id=service and t.active)<>cardinality(test_ids) then raise exception 'Test unavailable';end if;
 select count(distinct required_time) into required_times from public.hospital_laboratory_tests where id=any(test_ids);
 if required_times>1 then raise exception 'Tests require separate appointment times';end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'required_time',t.required_time,'instructions',t.instructions,'steps',t.steps) order by t.code,t.id) into tests from public.hospital_laboratory_tests t where t.id=any(test_ids);
 return jsonb_build_object('service_id',s.id,'procedure_code',s.procedure_code,'service_name',s.name,'sampling_method',sampling_method,'required_time',(select max(required_time)::text from public.hospital_laboratory_tests where id=any(test_ids)),'tests',tests);
end $$;
create function private.hospital_referral_kind(service uuid,kind text) returns boolean language sql stable security definer set search_path='' as $$
 select case when s.booking_kind='LABORATORY' then kind in('LABORATORY','DIAGNOSTICS') else kind in('SPECIALIST','HOSPITAL','FOLLOW_UP') end from public.hospital_services s where s.id=service
$$;
-- Reuse the existing authenticated service/department directory.
do $$ declare definition text;begin
 select pg_get_functiondef('public.priority_hospital_context(boolean)'::regprocedure) into definition;
 definition:=replace(definition,'''shifts'',(','''laboratory_tests'',(select coalesce(jsonb_agg(to_jsonb(t) order by t.code),''[]'') from public.hospital_laboratory_tests t where t.service_id=s.id and (manage or t.active)),''shifts'',(');execute definition;
 select pg_get_functiondef('public.priority_hospital_referrals(uuid,uuid,timestamptz,text,integer)'::regprocedure) into definition;
 execute replace(definition,'r.referral_type in (''SPECIALIST'',''HOSPITAL'',''FOLLOW_UP'')','private.hospital_referral_kind(service_id,r.referral_type)');
 select pg_get_functiondef('private.check_priority_clinic_booking()'::regprocedure) into definition;
 execute replace(definition,'r.referral_type in (''SPECIALIST'',''HOSPITAL'',''FOLLOW_UP'')','private.hospital_referral_kind(s.id,r.referral_type)');
end $$;
create function public.priority_laboratory_slots(patient_id uuid,service_id uuid,test_ids uuid[],date_from date,date_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare details jsonb;available jsonb;
begin
 if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 details:=private.laboratory_booking_details(service_id,test_ids,'VENIPUNCTURE');
 available:=public.priority_hospital_slots(patient_id,service_id,date_from,date_to);
 return(select coalesce(jsonb_agg(x order by x->>'starts_at'),'[]') from jsonb_array_elements(available)x where details->>'required_time' is null or ((x->>'starts_at')::timestamptz at time zone 'Europe/Zagreb')::time=(details->>'required_time')::time);
end $$;
-- A private variant of the existing atomic booking flow adds validated laboratory snapshots before notification triggers run.
do $$ declare definition text;begin
 select pg_get_functiondef('public.book_hospital_slot(uuid,uuid,uuid,boolean,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'public.book_hospital_slot(', 'private.book_laboratory_slot(');
 definition:=replace(definition,'request_id uuid)', 'request_id uuid, laboratory_details jsonb)');
 definition:=replace(definition,'book_hospital_slot.', 'book_laboratory_slot.');
 if strpos(definition,'request_id,created_by) values(patient_id,slot_id,did,referral_id,priority,')=0 then raise exception 'Hospital booking definition mismatch';end if;
 definition:=replace(definition,'request_id,created_by) values(patient_id,slot_id,did,referral_id,priority,','request_id,created_by,laboratory_details) values(patient_id,slot_id,did,referral_id,priority,');
 definition:=replace(definition,'request_id,auth.uid()) returning id into result','request_id,auth.uid(),laboratory_details) returning id into result');
 execute definition;
 select pg_get_functiondef('public.book_priority_hospital(uuid,uuid,timestamptz,uuid,jsonb,text,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'public.book_priority_hospital(', 'public.book_priority_laboratory(');
 definition:=replace(definition,'request_id uuid)', 'request_id uuid, test_ids uuid[], sampling_method text)');
 definition:=replace(definition,'book_priority_hospital.', 'book_priority_laboratory.');
 definition:=replace(definition,'prior private.priority_booking_requests;', 'prior private.priority_booking_requests;lab jsonb;');
 definition:=replace(definition,'''reason'',priority_reason)', '''reason'',priority_reason,''test_ids'',to_jsonb(test_ids),''sampling_method'',sampling_method)');
 definition:=replace(definition,'if s.id is null then raise exception ''Clinic unavailable'';end if;', 'if s.id is null or s.booking_kind<>''LABORATORY'' then raise exception ''Laboratory unavailable'';end if;lab:=private.laboratory_booking_details(service_id,test_ids,sampling_method);');
 definition:=replace(definition,'''referral_type'',''SPECIALIST''', '''referral_type'',''LABORATORY''');
 definition:=replace(definition,'''referral_code'',coalesce(new_referral->>''referral_code'',''A1'')', '''referral_code'',coalesce(new_referral->>''referral_code'',''A3'')');
 definition:=replace(definition,'r.referral_type in (''SPECIALIST'',''HOSPITAL'',''FOLLOW_UP'')','private.hospital_referral_kind(s.id,r.referral_type)');
 definition:=replace(definition,'public.book_hospital_slot(patient_id,slot,ref,true,priority_reason,request_id)', 'private.book_laboratory_slot(patient_id,slot,ref,true,priority_reason,request_id,lab)');
 execute definition;
 -- Old specialist clients cannot bypass test selection for laboratories.
 select pg_get_functiondef('public.book_priority_hospital(uuid,uuid,timestamptz,uuid,jsonb,text,uuid)'::regprocedure) into definition;
 execute replace(definition,'if s.id is null then raise exception ''Clinic unavailable'';end if;', 'if s.id is null or s.booking_kind=''LABORATORY'' then raise exception ''Choose laboratory tests before booking'';end if;');
end $$;
create function private.check_laboratory_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;starts timestamptz;ids uuid[];
begin
 select hs.* into s from public.hospital_slots sl join public.hospital_services hs on hs.id=sl.service_id where sl.id=new.slot_id;
 select sl.starts_at into starts from public.hospital_slots sl where sl.id=new.slot_id;
 if tg_op='UPDATE' and new.laboratory_details is distinct from old.laboratory_details then raise exception 'Laboratory snapshot is immutable';end if;
 if s.booking_kind='LABORATORY' then
 if new.laboratory_details is null or new.laboratory_details->>'service_id' is distinct from s.id::text then raise exception 'Laboratory test selection required';end if;
 if tg_op='INSERT' then
 select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(new.laboratory_details->'tests')x;
 if new.laboratory_details is distinct from private.laboratory_booking_details(s.id,ids,new.laboratory_details->>'sampling_method') then raise exception 'Invalid laboratory snapshot';end if;
 end if;
 if new.status in('BOOKED','ARRIVED') and (tg_op='INSERT' or new.slot_id is distinct from old.slot_id) and new.laboratory_details->>'required_time' is not null and (starts at time zone 'Europe/Zagreb')::time<>(new.laboratory_details->>'required_time')::time then raise exception 'Laboratory test requires a specific time';end if;
 elsif new.laboratory_details is not null then raise exception 'Laboratory service required';end if;
 return new;
end $$;
create trigger a_laboratory_booking before insert or update on public.hospital_bookings for each row execute function private.check_laboratory_booking();
-- Details go only into the patient's PDF attachment and authorized booking view, not the email body.
do $$ declare definition text;begin
 select pg_get_functiondef('private.booking_pdf_details(uuid,uuid)'::regprocedure) into definition;
 definition:=replace(definition,' from (',' ||coalesce((select jsonb_build_object(''laboratory'',b.laboratory_details) from public.hospital_bookings b where b.id=booking and b.laboratory_details is not null),''{}''::jsonb) from (');execute definition;
end $$;
do $$ declare definition text;begin
 select pg_get_functiondef('private.contact_appointment_payload(uuid,uuid,text)'::regprocedure) into definition;
 execute replace(definition,'''kind'',s.name','''kind'',case when s.booking_kind=''LABORATORY'' then ''Laboratorijska usluga'' else s.name end');
 select pg_get_functiondef('private.snapshot_appointment_email()'::regprocedure) into definition;
 execute replace(definition,'''kind'',s.name','''kind'',case when s.booking_kind=''LABORATORY'' then ''Laboratorijska usluga'' else s.name end');
end $$;
revoke all on function private.laboratory_booking_details(uuid,uuid[],text),private.hospital_referral_kind(uuid,text),private.book_laboratory_slot(uuid,uuid,uuid,boolean,text,uuid,jsonb),private.check_laboratory_booking() from public,anon,authenticated;
revoke all on function public.configure_hospital_laboratory(uuid,text),public.save_hospital_laboratory_test(uuid,uuid,jsonb),public.priority_laboratory_slots(uuid,uuid,uuid[],date,date),public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text) from public,anon;
grant execute on function public.configure_hospital_laboratory(uuid,text),public.save_hospital_laboratory_test(uuid,uuid,jsonb),public.priority_laboratory_slots(uuid,uuid,uuid[],date,date),public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text) to authenticated;
commit;

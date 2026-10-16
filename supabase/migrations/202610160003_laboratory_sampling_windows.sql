begin;
alter table public.hospital_laboratory_tests add column sampling_from time not null default '07:00',add column sampling_until time not null default '19:00',add constraint laboratory_sampling_window check(sampling_from>='07:00'::time and sampling_until<='19:00'::time and sampling_from<sampling_until and (required_time is null or (required_time>=sampling_from and required_time<sampling_until)));
alter table public.hospital_clinic_shifts drop constraint hospital_clinic_shifts_shift_check;
alter table public.hospital_clinic_shifts add constraint hospital_clinic_shifts_shift_check check(shift in('MORNING','AFTERNOON','FULL_DAY'));
-- A full laboratory day uses the same absence, overlap and working-hour protections.
do $$ declare definition text;begin
 select pg_get_functiondef('public.set_hospital_clinic_shift(uuid,integer,text)'::regprocedure) into definition;
 definition:=replace(definition,'shift not in (''MORNING'',''AFTERNOON'')','shift not in (''MORNING'',''AFTERNOON'',''FULL_DAY'')');
 definition:=replace(definition,' select user_id into doctor_user',' if shift=''FULL_DAY'' and s.booking_kind<>''LABORATORY'' then raise exception ''Full day is only available for laboratories'';end if; select user_id into doctor_user');
 definition:=replace(definition,'case c.shift when ''MORNING'' then time ''07:00'' else time ''13:30'' end','case c.shift when ''AFTERNOON'' then time ''13:30'' else time ''07:00'' end');execute definition;
 select pg_get_functiondef('private.valid_priority_clinic_slot(uuid,timestamptz,integer)'::regprocedure) into definition;
 definition:=replace(definition,'case c.shift when ''MORNING'' then time ''07:00'' else time ''13:30'' end','case c.shift when ''AFTERNOON'' then time ''13:30'' else time ''07:00'' end');execute definition;
 select pg_get_functiondef('public.priority_hospital_slots(uuid,uuid,date,date)'::regprocedure) into definition;
 definition:=replace(definition,'case c.shift when ''MORNING'' then time ''07:00'' else time ''13:30'' end','case c.shift when ''AFTERNOON'' then time ''13:30'' else time ''07:00'' end');execute definition;
 select pg_get_functiondef('public.save_hospital_laboratory_test(uuid,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'instructions,steps,active,updated_by)','instructions,steps,active,updated_by,sampling_from,sampling_until)');
 definition:=replace(definition,'true),auth.uid()) returning id into result','true),auth.uid(),coalesce(nullif(data->>''sampling_from'','''')::time,time ''07:00''),coalesce(nullif(data->>''sampling_until'','''')::time,time ''19:00'')) returning id into result');
 definition:=replace(definition,'set code=trim(data->>''code''),','set sampling_from=coalesce(nullif(data->>''sampling_from'','''')::time,t.sampling_from),sampling_until=coalesce(nullif(data->>''sampling_until'','''')::time,t.sampling_until),code=trim(data->>''code''),');execute definition;
end $$;
create or replace function private.laboratory_booking_details(service uuid,test_ids uuid[],sampling_method text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.hospital_services;tests jsonb;required_times integer;window_start time;window_end time;fixed time;
begin
 select * into s from public.hospital_services where id=service and booking_kind='LABORATORY' and active;
 if s.id is null or test_ids is null or cardinality(test_ids) not between 1 and 20 or (select count(distinct x) from unnest(test_ids)x)<>cardinality(test_ids) or sampling_method is null or sampling_method not in('VENIPUNCTURE','CANNULA','OTHER') then raise exception 'Select laboratory tests and sampling method';end if;
 if (select count(*) from public.hospital_laboratory_tests t where t.id=any(test_ids) and t.service_id=service and t.active)<>cardinality(test_ids) then raise exception 'Test unavailable';end if;
 select count(distinct required_time),max(required_time),max(sampling_from),min(sampling_until) into required_times,fixed,window_start,window_end from public.hospital_laboratory_tests where id=any(test_ids);
 if required_times>1 or window_start>=window_end or (fixed is not null and (fixed<window_start or fixed>=window_end)) then raise exception 'Tests require separate appointment times';end if;
 select jsonb_agg(jsonb_build_object('id',t.id,'code',t.code,'name',t.name,'required_time',t.required_time,'sampling_from',t.sampling_from,'sampling_until',t.sampling_until,'instructions',t.instructions,'steps',t.steps) order by t.code,t.id) into tests from public.hospital_laboratory_tests t where t.id=any(test_ids);
 return jsonb_build_object('service_id',s.id,'procedure_code',s.procedure_code,'service_name',s.name,'sampling_method',sampling_method,'required_time',fixed::text,'sampling_from',window_start::text,'sampling_until',window_end::text,'tests',tests);
end $$;
create or replace function public.priority_laboratory_slots(patient_id uuid,service_id uuid,test_ids uuid[],date_from date,date_to date) returns jsonb language plpgsql security definer set search_path='' as $$
declare details jsonb;available jsonb;
begin
 if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 details:=private.laboratory_booking_details(service_id,test_ids,'VENIPUNCTURE');
 available:=public.priority_hospital_slots(patient_id,service_id,date_from,date_to);
 return(select coalesce(jsonb_agg(x order by x->>'starts_at'),'[]') from jsonb_array_elements(available)x
 where ((x->>'starts_at')::timestamptz at time zone 'Europe/Zagreb')::time>=(details->>'sampling_from')::time
 and (((x->>'starts_at')::timestamptz+make_interval(mins=>(x->>'duration_minutes')::integer)) at time zone 'Europe/Zagreb')::time<=(details->>'sampling_until')::time
 and (details->>'required_time' is null or ((x->>'starts_at')::timestamptz at time zone 'Europe/Zagreb')::time=(details->>'required_time')::time));
end $$;
-- Apply the frozen window on insertion and on every reschedule, including older clients.
do $$ declare definition text;begin
 select pg_get_functiondef('private.check_laboratory_booking()'::regprocedure) into definition;
 definition:=replace(definition,' if new.status in(''BOOKED'',''ARRIVED'') and', ' if new.status in(''BOOKED'',''ARRIVED'') and (tg_op=''INSERT'' or new.slot_id is distinct from old.slot_id) and ((starts at time zone ''Europe/Zagreb'')::time<coalesce((new.laboratory_details->>''sampling_from'')::time,time ''07:00'') or ((starts+make_interval(mins=>(select sl.duration_minutes from public.hospital_slots sl where sl.id=new.slot_id))) at time zone ''Europe/Zagreb'')::time>coalesce((new.laboratory_details->>''sampling_until'')::time,time ''19:00'')) then raise exception ''Laboratory sampling window unavailable'';end if; if new.status in(''BOOKED'',''ARRIVED'') and');execute definition;
end $$;
create function public.apply_laboratory_sampling_defaults(service_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;
begin
 select * into s from public.hospital_services where id=service_id;
 if s.id is null or s.booking_kind<>'LABORATORY' or not(private.hospital_admin(s.institution_id) or private.hospital_provider(s.id)) then raise exception 'Forbidden' using errcode='42501';end if;
 insert into public.hospital_laboratory_tests(service_id,code,name,sampling_from,sampling_until,instructions,updated_by)
 values(service_id,'LOCAL-ROUTINE','Redovne laboratorijske pretrage','07:00','09:30','Priprema prema pisanoj uputi liječnika i laboratorija.',auth.uid()),
 (service_id,'LOCAL-THYROID','Hormoni štitnjače','07:00','19:00','Priprema prema pisanoj uputi liječnika i laboratorija.',auth.uid()),
 (service_id,'LOCAL-DEX-SUPPRESSION','Deksametazonski test supresije','08:00','14:00','Protokol i pripremu određuje odgovorni liječnik/laboratorij.',auth.uid())
 on conflict on constraint hospital_laboratory_tests_service_id_code_key do nothing;
 perform private.audit_event('LABORATORY_SAMPLING_DEFAULTS_APPLIED','hospital_services',service_id);
end $$;
revoke all on function public.apply_laboratory_sampling_defaults(uuid) from public,anon;
grant execute on function public.apply_laboratory_sampling_defaults(uuid) to authenticated;
-- New laboratories get the user's three sampling windows, without inventing weekdays or medical protocols.
do $$ declare definition text;begin
 select pg_get_functiondef('public.create_hospital_laboratory(uuid,uuid,text,text,text,text,text)'::regprocedure) into definition;
 definition:=replace(definition,'declare result uuid;begin','declare result uuid;workday integer;begin');
 execute replace(definition,'perform public.configure_hospital_laboratory(result,procedure_code);return result;', 'perform public.configure_hospital_laboratory(result,procedure_code);perform public.apply_laboratory_sampling_defaults(result);for workday in 1..5 loop perform public.set_hospital_clinic_shift(result,workday,''FULL_DAY'');end loop;return result;');
end $$;
commit;

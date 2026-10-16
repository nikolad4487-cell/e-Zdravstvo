begin;
alter table public.hospital_laboratory_tests add column catalog_list text,add constraint laboratory_test_catalog_code foreign key(catalog_list,code) references public.medical_codes(list_id,code);
alter table public.laboratory_orders add column catalog_details jsonb;
alter table public.laboratory_parameters add column catalog_list text,add column text_value text check(text_value is null or length(trim(text_value)) between 1 and 2000),alter column value drop not null,add constraint laboratory_parameter_value check(num_nonnulls(value,text_value)=1),add constraint laboratory_parameter_catalog_code foreign key(catalog_list,code) references public.medical_codes(list_id,code);
create function private.cezih_laboratory_codes(catalog text,codes text[]) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if catalog not in('2.2.18','2.2.30','2.2.31') or codes is null or cardinality(codes)>113 or (select count(distinct x) from unnest(codes)x)<>cardinality(codes) then raise exception 'Invalid laboratory catalog selection';end if;
 if (select count(*) from public.medical_codes c where c.list_id=catalog and c.code=any(codes))<>cardinality(codes) then raise exception 'Unknown laboratory catalog code';end if;
 select coalesce(jsonb_agg(jsonb_build_object('list_id',c.list_id,'code',c.code,'name',c.name,'description',c.description,'unit',case when catalog='2.2.31' then split_part(c.description,' | ',3) else '' end,'source_page',c.source_page) order by c.code),'[]') into result from public.medical_codes c where c.list_id=catalog and c.code=any(codes);
 return result;
end $$;
create function private.sync_cezih_laboratory_service(service uuid) returns integer language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;added integer;
begin
 select * into s from public.hospital_services where id=service and booking_kind='LABORATORY';
 if s.id is null then raise exception 'Laboratory service required';end if;
 if (select count(*) from public.medical_codes where list_id='2.2.30')<>43 then return 0;end if;
 insert into public.hospital_laboratory_tests(service_id,code,name,catalog_list,sampling_from,sampling_until,active,instructions,updated_by)
 select s.id,c.code,c.name,'2.2.30','07:00',case when c.code='35510-10' then time '19:00' else time '09:30' end,c.code not in('23301-10','23301-20','23301-30'),
 case when c.code in('23301-10','23301-20','23301-30') then 'Pretraga s vremenskim točkama: laboratorij treba potvrditi protokol, trajanje i povezane termine prije aktivacije.' else 'Vrstu uzorka i pripremu određuje laboratorij prema pisanoj uputi.' end,s.created_by
 from public.medical_codes c where c.list_id='2.2.30' on conflict on constraint hospital_laboratory_tests_service_id_code_key do nothing;
 get diagnostics added=row_count;
 update public.hospital_laboratory_tests set active=false where service_id=s.id and catalog_list is null and code in('LOCAL-ROUTINE','LOCAL-THYROID');
 return added;
end $$;
create function public.apply_cezih_laboratory_catalog(service_id uuid) returns integer language plpgsql security definer set search_path='' as $$
declare s public.hospital_services;result integer;
begin
 select * into s from public.hospital_services where id=service_id;
 if s.id is null or not(private.hospital_admin(s.institution_id) or private.hospital_provider(s.id)) then raise exception 'Forbidden' using errcode='42501';end if;
 result:=private.sync_cezih_laboratory_service(service_id);perform private.audit_event('CEZIH_LABORATORY_CATALOG_APPLIED','hospital_services',service_id);return result;
end $$;
-- Keep official code/name identities authoritative while preserving local tests and clinical settings.
do $$ declare definition text;begin
 select pg_get_functiondef('public.save_hospital_laboratory_test(uuid,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,' if jsonb_typeof(new_steps)', ' if test_id is not null and exists(select 1 from public.hospital_laboratory_tests t where t.id=test_id and t.service_id=s.id and t.catalog_list=''2.2.30'') then data:=data||jsonb_build_object(''code'',(select t.code from public.hospital_laboratory_tests t where t.id=test_id),''name'',(select c.name from public.medical_codes c join public.hospital_laboratory_tests t on t.code=c.code and t.catalog_list=c.list_id where t.id=test_id));end if; if jsonb_typeof(new_steps)');execute definition;
 select pg_get_functiondef('public.create_hospital_laboratory(uuid,uuid,text,text,text,text,text)'::regprocedure) into definition;
 execute replace(definition,'perform public.apply_laboratory_sampling_defaults(result);','perform public.apply_laboratory_sampling_defaults(result);perform private.sync_cezih_laboratory_service(result);');
 -- Sampling is not one official procedure code shared by every investigation.
 select pg_get_functiondef('public.configure_hospital_laboratory(uuid,text)'::regprocedure) into definition;
 execute replace(definition,'if length(trim(coalesce(procedure_code,''''))) not between 1 and 40','if procedure_code is null or length(trim(procedure_code))>40');
 select pg_get_functiondef('private.laboratory_booking_details(uuid,uuid[],text)'::regprocedure) into definition;
 execute replace(definition,'''id'',t.id,''code'',t.code,','''id'',t.id,''code'',t.code,''catalog_list'',t.catalog_list,');
end $$;
-- Preserve old request signatures through the optional final parameter.
do $$ declare definition text;begin
 select pg_get_functiondef('public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text)'::regprocedure) into definition;
 drop function public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text);
 definition:=replace(definition,'sampling_method text)', 'sampling_method text, specimen_codes text[] DEFAULT ''{}''::text[])');
 definition:=replace(definition,'''sampling_method'',sampling_method);','''sampling_method'',sampling_method)||case when cardinality(specimen_codes)>0 then jsonb_build_object(''specimen_codes'',to_jsonb(specimen_codes)) else ''{}''::jsonb end;');
 definition:=replace(definition,'lab:=private.laboratory_booking_details(service_id,test_ids,sampling_method);','lab:=private.laboratory_booking_details(service_id,test_ids,sampling_method)||jsonb_build_object(''specimens'',private.cezih_laboratory_codes(''2.2.18'',specimen_codes));');execute definition;
 select pg_get_functiondef('private.check_laboratory_booking()'::regprocedure) into definition;
 definition:=replace(definition,'new.laboratory_details is distinct from private.laboratory_booking_details(s.id,ids,new.laboratory_details->>''sampling_method'')','(new.laboratory_details-''specimens'') is distinct from private.laboratory_booking_details(s.id,ids,new.laboratory_details->>''sampling_method'')');
 definition:=replace(definition,' if tg_op=''INSERT'' then',' if tg_op=''INSERT'' then if new.laboratory_details ? ''specimens'' and new.laboratory_details->''specimens'' is distinct from private.cezih_laboratory_codes(''2.2.18'',array(select x->>''code'' from jsonb_array_elements(new.laboratory_details->''specimens'')x)) then raise exception ''Invalid specimen codes'';end if;');execute definition;
end $$;
-- Order forms store independently validated order and specimen codes; free-text legacy orders remain supported.
do $$ declare definition text;begin
 select pg_get_functiondef('public.order_laboratory(uuid,jsonb,uuid)'::regprocedure) into definition;
 definition:=replace(definition,'result uuid;begin','result uuid;selection jsonb;specimens jsonb;begin');
 definition:=replace(definition,' insert into public.laboratory_orders(', ' selection:=private.cezih_laboratory_codes(''2.2.30'',array(select jsonb_array_elements_text(data->''catalog_order_codes'')));specimens:=private.cezih_laboratory_codes(''2.2.18'',array(select jsonb_array_elements_text(data->''specimen_codes'')));if jsonb_array_length(selection)>0 then data:=data||jsonb_build_object(''requested_tests'',(select string_agg((x->>''code'')||'' · ''||(x->>''name''),E''\n'' order by x->>''code'') from jsonb_array_elements(selection)x));end if; insert into public.laboratory_orders(');
 definition:=replace(definition,'priority,request_id,created_by) values','priority,request_id,created_by,catalog_details) values');
 definition:=replace(definition,'request_id,auth.uid()) returning id into result','request_id,auth.uid(),jsonb_build_object(''orders'',selection,''specimens'',specimens,''source_revision'',''RevBE 2023-07-12'')) returning id into result');execute definition;
end $$;
-- Official result codes override client-provided names/units; text findings are preserved as text, never coerced to zero.
do $$ declare definition text;begin
 select pg_get_functiondef('public.publish_laboratory_result(uuid,uuid,jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'row_data jsonb;val numeric;', 'row_data jsonb;official jsonb;text_val text;val numeric;');
 definition:=replace(definition,' val:=(row_data->>''value'')::numeric;', ' official:=null;if nullif(row_data->>''catalog_list'','''') is not null and row_data->>''catalog_list''<>''2.2.31'' then raise exception ''Invalid laboratory result code system'';end if;if row_data->>''catalog_list''=''2.2.31'' or exists(select 1 from public.medical_codes c where c.list_id=''2.2.31'' and c.code=row_data->>''code'') then official:=private.cezih_laboratory_codes(''2.2.31'',array[row_data->>''code''])->0;row_data:=row_data||jsonb_build_object(''name'',official->>''name'',''unit'',official->>''unit'',''catalog_list'',''2.2.31'');end if;text_val:=case when row_data->>''value_kind''=''TEXT'' then nullif(trim(row_data->>''text_value''),'''') end;val:=case when row_data->>''value_kind''=''TEXT'' then null else nullif(row_data->>''value'','''')::numeric end;');
 definition:=replace(definition,' flag:=case when', ' if text_val is not null then lo:=null;hi:=null;end if;flag:=case when');
 definition:=replace(definition,'reference_low,reference_high,flag) values','reference_low,reference_high,flag,catalog_list,text_value) values');
 definition:=replace(definition,'lo,hi,flag);','lo,hi,flag,nullif(row_data->>''catalog_list'',''''),text_val);');execute definition;
 select pg_get_functiondef('private.queue_issued_document_email()'::regprocedure) into definition;
 execute replace(definition,'x.value||'' ''||x.unit','coalesce(x.value::text,x.text_value,'''')||'' ''||x.unit');
 select pg_get_functiondef('private.snapshot_document_print_layout()'::regprocedure) into definition;
 execute replace(definition,'''value'',x.value::text','''value'',coalesce(x.value::text,x.text_value,'''')');
 select pg_get_functiondef('public.laboratory_trend_catalog(uuid)'::regprocedure) into definition;
 execute replace(definition,'where o.patient_id=pid and r.superseded_by is null','where o.patient_id=pid and r.superseded_by is null and p.value is not null');
 select pg_get_functiondef('public.laboratory_trend_points(uuid,text,text,date,date,integer)'::regprocedure) into definition;
 execute replace(definition,'where o.patient_id=pid and r.superseded_by is null','where o.patient_id=pid and r.superseded_by is null and p.value is not null');
end $$;
-- The shared service is no longer labelled with an unverified universal VVK/VKK code.
update public.hospital_services set procedure_code='',name=case when name='Laboratorij - Uzimanje venske krvi' then 'Laboratorijske pretrage i predaja uzoraka' else name end where booking_kind='LABORATORY' and procedure_code in('VVK','VKK');
select private.sync_cezih_laboratory_service(s.id) from public.hospital_services s where s.booking_kind='LABORATORY';
revoke all on function private.cezih_laboratory_codes(text,text[]),private.sync_cezih_laboratory_service(uuid) from public,anon,authenticated;
revoke all on function public.apply_cezih_laboratory_catalog(uuid),public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text,text[]) from public,anon;
grant execute on function public.apply_cezih_laboratory_catalog(uuid),public.book_priority_laboratory(uuid,uuid,timestamptz,uuid,jsonb,text,uuid,uuid[],text,text[]) to authenticated;
commit;

begin;
create sequence private.lab_number;
create table public.laboratory_orders(
 id uuid primary key default gen_random_uuid(),number text not null unique default('EZ-LAB-'||extract(year from now())::text||'-'||lpad(nextval('private.lab_number')::text,8,'0')),
 patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),laboratory_institution_id uuid not null references public.institutions(id),
 requested_tests text not null check(length(trim(requested_tests)) between 2 and 2000),clinical_question text not null default '' check(length(clinical_question)<=2000),priority text not null check(priority in ('REGULAR','URGENT')),
 status text not null default 'ORDERED' check(status in ('ORDERED','IN_PROGRESS','COMPLETED','CANCELLED')),cancellation_reason text,version integer not null default 1,
 request_id uuid not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),unique(created_by,request_id)
);
create table public.laboratory_results(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.laboratory_orders(id),sampled_at timestamptz not null,reported_at timestamptz not null default now(),
 summary text not null default '' check(length(summary)<=4000),version integer not null check(version>0),correction_reason text not null default '',superseded_by uuid references public.laboratory_results(id),
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),unique(order_id,version)
);
create table public.laboratory_parameters(
 id uuid primary key default gen_random_uuid(),result_id uuid not null references public.laboratory_results(id),code text not null check(length(trim(code)) between 1 and 40),name text not null check(length(trim(name)) between 1 and 150),
 value numeric not null check(value between -1000000000000 and 1000000000000),unit text not null check(length(unit)<=50),reference_low numeric,reference_high numeric,
 flag text check(flag in ('LOW','NORMAL','HIGH','CRITICAL')),created_at timestamptz not null default now(),unique(result_id,code),
 check(reference_low is null or reference_low between -1000000000000 and 1000000000000),check(reference_high is null or reference_high between -1000000000000 and 1000000000000),check(reference_low is null or reference_high is null or reference_low<=reference_high)
);
create index lab_patient_idx on public.laboratory_orders(patient_id,created_at desc);
create index lab_institution_idx on public.laboratory_orders(laboratory_institution_id,status);
create index lab_parameters_result_idx on public.laboratory_parameters(result_id);
do $$declare t text;begin foreach t in array array['laboratory_orders','laboratory_results','laboratory_parameters'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
end loop;end $$;
create trigger updated_at before update on public.laboratory_orders for each row execute function private.touch_updated_at();
create function private.lab_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.schedule_events(user_id,revision) select recipients.id,gen_random_uuid() from(
 select d.user_id id from public.doctors d where d.id=new.doctor_id union select r.user_id from public.user_roles r join public.institution_users u on u.user_id=r.user_id and u.institution_id=r.institution_id where r.role='LAB_TECHNICIAN' and r.institution_id=new.laboratory_institution_id and u.active
 union select ps.user_id from public.patient_staff ps where ps.patient_id=new.patient_id and ps.revoked_at is null)recipients on conflict(user_id) do update set revision=excluded.revision;return new;end $$;
create trigger lab_changed after insert or update on public.laboratory_orders for each row execute function private.lab_changed();
create function private.preserve_lab_result() returns trigger language plpgsql set search_path='' as $$begin
 if TG_TABLE_NAME='laboratory_parameters' or (to_jsonb(new)-'superseded_by') is distinct from (to_jsonb(old)-'superseded_by') or old.superseded_by is not null then raise exception 'Published results are immutable';end if;return new;end $$;
create trigger preserve_result before update on public.laboratory_results for each row execute function private.preserve_lab_result();
create trigger preserve_parameter before update on public.laboratory_parameters for each row execute function private.preserve_lab_result();
create function public.laboratory_context() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name)),'[]') from public.institutions i where i.active and auth.uid() is not null and exists(select 1 from public.user_roles r join public.institution_users u on u.user_id=r.user_id and u.institution_id=r.institution_id where r.institution_id=i.id and r.role='LAB_TECHNICIAN' and u.active);
$$;
create function public.order_laboratory(patient_id uuid,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);lid uuid:=(data->>'laboratory_institution_id')::uuid;result uuid;begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 if not exists(select 1 from public.institutions i where i.id=lid and i.active and exists(select 1 from public.user_roles r join public.institution_users u on u.user_id=r.user_id and u.institution_id=r.institution_id where r.institution_id=lid and r.role='LAB_TECHNICIAN' and u.active)) then raise exception 'Laboratory unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,41));
 select id into result from public.laboratory_orders o where o.created_by=auth.uid() and o.request_id=order_laboratory.request_id;if result is not null then return result;end if;
 insert into public.laboratory_orders(patient_id,doctor_id,laboratory_institution_id,requested_tests,clinical_question,priority,request_id,created_by) values(patient_id,did,lid,trim(data->>'requested_tests'),coalesce(data->>'clinical_question',''),data->>'priority',request_id,auth.uid()) returning id into result;
 perform private.audit_event('LAB_ORDER_CREATED','laboratory_orders',result);return result;
end $$;
create function public.list_laboratory(mode text,patient_filter uuid default null,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null or mode is null or mode not in ('CARE','PERSONAL','LAB') or (mode='PERSONAL' and not private.has_role('PATIENT')) then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number<0 or page_number>10000 then raise exception 'Invalid page';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]') into result from(
 select o.*,p.first_name||' '||p.last_name patient_name,p.patient_number,p.birth_date,d.display_name doctor_name,i.name laboratory_name,
 mode='LAB' and private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) can_publish,
 mode='CARE' and d.user_id=auth.uid() and private.treating_doctor(o.patient_id) is not null can_cancel,
 (select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object('author',pr.first_name||' '||pr.last_name,'parameters',(select coalesce(jsonb_agg(to_jsonb(v) order by v.code),'[]') from public.laboratory_parameters v where v.result_id=r.id)) order by r.version desc),'[]') from public.laboratory_results r join public.profiles pr on pr.id=r.created_by where r.order_id=o.id) results
 from public.laboratory_orders o join public.patients p on p.id=o.patient_id join public.doctors d on d.id=o.doctor_id join public.institutions i on i.id=o.laboratory_institution_id
 where (patient_filter is null or o.patient_id=patient_filter) and case mode when 'LAB' then private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) when 'PERSONAL' then p.user_id=auth.uid() and p.archived_at is null else private.can_read_patient(o.patient_id) end
 order by o.created_at desc,o.id limit 50 offset page_number*50)x;
 perform private.audit_event('LABORATORY_VIEWED','laboratory_orders',patient_filter);return result;
end $$;
create function public.set_lab_order_status(order_id uuid,expected_version integer,new_status text,reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare o public.laboratory_orders;begin select * into o from public.laboratory_orders where id=order_id for update;
 if o.id is null or not(private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) or (o.created_by=auth.uid() and private.treating_doctor(o.patient_id) is not null)) then raise exception 'Forbidden' using errcode='42501';end if;
 if o.version is distinct from expected_version then raise exception 'Order changed' using errcode='40001';end if;
 if new_status='IN_PROGRESS' and o.status='ORDERED' and private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then null;
 elsif new_status='CANCELLED' and o.status in ('ORDERED','IN_PROGRESS') and length(trim(coalesce(reason,''))) between 5 and 500 then null;
 else raise exception 'Invalid order transition';end if;
 update public.laboratory_orders set status=new_status,version=version+1,cancellation_reason=case when new_status='CANCELLED' then trim(reason) else null end where id=order_id;
 perform private.audit_event('LAB_ORDER_'||new_status,'laboratory_orders',order_id);
end $$;
create function public.publish_laboratory_result(order_id uuid,previous_result uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.laboratory_orders;last_result public.laboratory_results;rid uuid;row_data jsonb;val numeric;lo numeric;hi numeric;flag text;sample_time timestamptz:=(data->>'sampled_at')::timestamptz;begin
 select * into o from public.laboratory_orders where id=order_id for update;
 if o.id is null or not private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if o.status not in ('IN_PROGRESS','COMPLETED') then raise exception 'Order must be in progress';end if;
 select * into last_result from public.laboratory_results r where r.order_id=publish_laboratory_result.order_id and superseded_by is null order by version desc limit 1;
 if last_result.id is distinct from previous_result then raise exception 'Result changed' using errcode='40001';end if;
 if last_result.id is not null and length(trim(coalesce(data->>'correction_reason',''))) not between 5 and 1000 then raise exception 'Correction reason required';end if;
 if sample_time is null or sample_time>now()+interval '5 minutes' or sample_time<o.created_at-interval '30 days' then raise exception 'Invalid sampling time';end if;
 if jsonb_typeof(data->'parameters') is distinct from 'array' or jsonb_array_length(data->'parameters') not between 1 and 100 then raise exception 'Parameters required';end if;
 insert into public.laboratory_results(order_id,sampled_at,summary,version,correction_reason,created_by) values(order_id,sample_time,coalesce(data->>'summary',''),coalesce(last_result.version,0)+1,coalesce(data->>'correction_reason',''),auth.uid()) returning id into rid;
 for row_data in select * from jsonb_array_elements(data->'parameters') loop
 val:=(row_data->>'value')::numeric;lo:=nullif(row_data->>'reference_low','')::numeric;hi:=nullif(row_data->>'reference_high','')::numeric;
 flag:=case when coalesce((row_data->>'critical')::boolean,false) then 'CRITICAL' when lo is not null and val<lo then 'LOW' when hi is not null and val>hi then 'HIGH' when lo is not null or hi is not null then 'NORMAL' else null end;
 insert into public.laboratory_parameters(result_id,code,name,value,unit,reference_low,reference_high,flag) values(rid,upper(trim(row_data->>'code')),trim(row_data->>'name'),val,coalesce(row_data->>'unit',''),lo,hi,flag);
 end loop;
 if last_result.id is not null then update public.laboratory_results set superseded_by=rid where id=last_result.id;end if;
 update public.laboratory_orders set status='COMPLETED',version=version+1 where id=order_id;
 insert into public.notifications(user_id,message) select p.user_id,case when last_result.id is null then 'Objavljen je novi laboratorijski nalaz: ' else 'Objavljen je ispravak laboratorijskog nalaza: ' end||o.number from public.patients p where p.id=o.patient_id and p.user_id is not null;
 perform private.audit_event('LAB_RESULT_PUBLISHED','laboratory_results',rid);return rid;
end $$;
revoke all on function private.preserve_lab_result(),private.lab_changed() from public,anon,authenticated;
revoke all on function public.laboratory_context(),public.order_laboratory(uuid,jsonb,uuid),public.list_laboratory(text,uuid,integer),public.set_lab_order_status(uuid,integer,text,text),public.publish_laboratory_result(uuid,uuid,jsonb) from public,anon;
grant execute on function public.laboratory_context(),public.order_laboratory(uuid,jsonb,uuid),public.list_laboratory(text,uuid,integer),public.set_lab_order_status(uuid,integer,text,text),public.publish_laboratory_result(uuid,uuid,jsonb) to authenticated;
commit;

begin;

alter table public.laboratory_orders
 add column hospital_booking_id uuid unique references public.hospital_bookings(id),
 add column sample_status text not null default 'EXPECTED' check(sample_status in('EXPECTED','ARRIVED','COLLECTED','PROCESSING','RECOLLECT','COMPLETED')),
 add column sample_status_at timestamptz,
 add column sample_collected_at timestamptz,
 add column sample_note text not null default '' check(length(sample_note)<=500),
 add column sample_attempt integer not null default 0 check(sample_attempt>=0);
alter table public.laboratory_orders alter column sample_status_at set default now();
create index laboratory_unlinked_work_day on public.laboratory_orders(laboratory_institution_id,created_at) where hospital_booking_id is null;
create table public.laboratory_sample_events(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.laboratory_orders(id),
 status text not null,attempt integer not null,reason text not null default '',created_at timestamptz not null default now(),created_by uuid references public.profiles(id)
);
create index laboratory_sample_events_order on public.laboratory_sample_events(order_id,created_at,id);
alter table public.laboratory_sample_events enable row level security;
revoke all on public.laboratory_sample_events from public,anon,authenticated;
grant all on public.laboratory_sample_events to service_role;
create trigger no_delete before delete on public.laboratory_sample_events for each row execute function private.no_clinical_delete();
create function private.preserve_sample_event() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Sample history is immutable';end $$;
create trigger no_update before update on public.laboratory_sample_events for each row execute function private.preserve_sample_event();

-- Existing untracked orders can still be published through the previous interface.
-- Once reception is recorded, processing must follow specimen collection.
create function private.guard_laboratory_workflow() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.hospital_booking_id is distinct from old.hospital_booking_id then raise exception 'Booking link is immutable';end if;
 if new.status='IN_PROGRESS' and new.sample_status not in('EXPECTED','PROCESSING') then raise exception 'Collect the sample and start processing first';end if;
 if new.status='COMPLETED' and old.status<>'COMPLETED' then
  if old.sample_status not in('EXPECTED','PROCESSING') then raise exception 'Sample must be in processing';end if;
  new.sample_status:='COMPLETED';new.sample_status_at:=now();new.sample_note:='';
 end if;
 return new;
end $$;
create trigger laboratory_workflow_guard before update on public.laboratory_orders for each row execute function private.guard_laboratory_workflow();
create function private.record_laboratory_sample_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.sample_status is distinct from old.sample_status then
  insert into public.laboratory_sample_events(order_id,status,attempt,reason,created_by) values(new.id,new.sample_status,new.sample_attempt,new.sample_note,auth.uid());
 end if;return new;
end $$;
create trigger laboratory_sample_event after insert or update on public.laboratory_orders for each row execute function private.record_laboratory_sample_event();

create function public.laboratory_worklist(work_day date,institution_filter uuid default null,search_term text default '',stage_filter text default null,page_number integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.has_role('LAB_TECHNICIAN') then raise exception 'Forbidden' using errcode='42501';end if;
 if work_day is null or search_term is null or length(search_term)>200 or page_number is null or page_number not between 0 and 10000
 or (stage_filter is not null and stage_filter not in('EXPECTED','ARRIVED','COLLECTED','PROCESSING','RECOLLECT','COMPLETED','CANCELLED','NO_SHOW','CLOSED')) then raise exception 'Invalid worklist filters';end if;
 if institution_filter is not null and not private.has_role('LAB_TECHNICIAN',institution_filter) then raise exception 'Forbidden' using errcode='42501';end if;
 with entries as materialized (
  select 'BOOKING'::text source_kind,b.id source_id,o.id order_id,b.id booking_id,coalesce(o.number,'Narudžba '||left(b.id::text,8)) number,
   p.first_name||' '||p.last_name patient_name,p.patient_number,s.institution_id,i.name institution_name,s.name service_name,s.location,d.display_name doctor_name,
   sl.starts_at,b.priority,coalesce(o.version,b.version) version,
   case when b.status='CANCELLED' or o.status='CANCELLED' then 'CANCELLED' when b.status='NO_SHOW' then 'NO_SHOW' when o.status='COMPLETED' then 'COMPLETED' when b.status='COMPLETED' and o.id is null then 'CLOSED' else coalesce(o.sample_status,'EXPECTED') end stage,
   coalesce(o.sample_attempt,0) attempt,o.sample_status_at stage_at,coalesce(o.sample_note,'') sample_note,
   coalesce(o.requested_tests,(select string_agg(t->>'name',', ' order by t->>'name') from jsonb_array_elements(b.laboratory_details->'tests')t),'') requested_tests,
   coalesce(b.laboratory_details->'specimens','[]'::jsonb) specimens,b.laboratory_details->>'sampling_method' sampling_method
  from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id
   join public.institutions i on i.id=s.institution_id join public.patients p on p.id=b.patient_id join public.doctors d on d.id=b.referring_doctor_id
   left join public.laboratory_orders o on o.hospital_booking_id=b.id
  where b.laboratory_details is not null and private.has_role('LAB_TECHNICIAN',s.institution_id)
   and (institution_filter is null or s.institution_id=institution_filter)
   and sl.starts_at>=work_day::timestamp at time zone 'Europe/Zagreb' and sl.starts_at<(work_day+1)::timestamp at time zone 'Europe/Zagreb'
  union all
  select 'ORDER',o.id,o.id,null,o.number,p.first_name||' '||p.last_name,p.patient_number,o.laboratory_institution_id,i.name,'Zahtjev bez zakazanog termina','',d.display_name,
   null,o.priority='URGENT',o.version,
   case when o.status='CANCELLED' then 'CANCELLED' when o.status='COMPLETED' then 'COMPLETED' when o.status='IN_PROGRESS' and o.sample_status='EXPECTED' then 'PROCESSING' else o.sample_status end,
   o.sample_attempt,o.sample_status_at,o.sample_note,o.requested_tests,coalesce(o.catalog_details->'specimens','[]'::jsonb),null
  from public.laboratory_orders o join public.patients p on p.id=o.patient_id join public.institutions i on i.id=o.laboratory_institution_id join public.doctors d on d.id=o.doctor_id
  where o.hospital_booking_id is null and private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id)
   and (institution_filter is null or o.laboratory_institution_id=institution_filter)
   and o.created_at>=work_day::timestamp at time zone 'Europe/Zagreb' and o.created_at<(work_day+1)::timestamp at time zone 'Europe/Zagreb'
 ), matched as materialized (
  select e.* from entries e where trim(search_term)='' or position(lower(trim(search_term)) in lower(concat_ws(' ',e.patient_name,e.patient_number,e.number,e.requested_tests,e.service_name)))>0
 ), filtered as materialized (select * from matched where stage_filter is null or stage=stage_filter), paged as (
  select * from filtered order by starts_at nulls last,source_id limit 50 offset page_number*50
 )
 select jsonb_build_object('institutions',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name) order by i.name),'[]') from public.institutions i where private.has_role('LAB_TECHNICIAN',i.id)),'total',(select count(*) from filtered),'counts',(select coalesce(jsonb_object_agg(stage,n),'{}') from(select stage,count(*) n from matched group by stage)c),
 'items',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('history',(select coalesce(jsonb_agg(h order by h.created_at desc,h.id desc),'[]') from (
  select v.id,v.status,v.attempt,v.reason,v.created_at,pr.first_name||' '||pr.last_name actor from public.laboratory_sample_events v left join public.profiles pr on pr.id=v.created_by where v.order_id=e.order_id order by v.created_at desc,v.id desc limit 100
 )h)) order by e.starts_at nulls last,e.source_id),'[]') from paged e)) into result;
 perform private.audit_event('LABORATORY_WORKLIST_VIEWED','laboratory_orders',institution_filter);return result;
end $$;

create function public.advance_laboratory_workflow(source_kind text,source_id uuid,expected_version integer,new_stage text,reason text default '') returns uuid
language plpgsql security definer set search_path='' as $$
declare b public.hospital_bookings;sl public.hospital_slots;s public.hospital_services;o public.laboratory_orders;current_stage text;orders jsonb;tests text;
begin
 if auth.uid() is null or not private.has_role('LAB_TECHNICIAN') then raise exception 'Forbidden' using errcode='42501';end if;
 if source_kind is null or source_kind not in('BOOKING','ORDER') or source_id is null or expected_version is null or new_stage is null or new_stage not in('ARRIVED','COLLECTED','PROCESSING','RECOLLECT') or reason is null or length(reason)>500 then raise exception 'Invalid workflow request';end if;
 if source_kind='BOOKING' then
  select * into b from public.hospital_bookings where id=source_id for update;
  select * into sl from public.hospital_slots where id=b.slot_id;
  select * into s from public.hospital_services where id=sl.service_id;
  if b.id is null or b.laboratory_details is null or not private.has_role('LAB_TECHNICIAN',s.institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if b.status not in('BOOKED','ARRIVED') then raise exception 'Booking is closed';end if;
  if (sl.starts_at at time zone 'Europe/Zagreb')::date>(now() at time zone 'Europe/Zagreb')::date then raise exception 'Patient cannot arrive before the booked day';end if;
  select * into o from public.laboratory_orders where hospital_booking_id=b.id for update;
  if o.id is null then
   if b.version is distinct from expected_version then raise exception 'Work item changed' using errcode='40001';end if;
   if new_stage<>'ARRIVED' then raise exception 'Receive the patient first';end if;
   select coalesce(jsonb_agg(jsonb_build_object('code',t->>'code','name',t->>'name','catalog_list',t->>'catalog_list')),'[]'),string_agg(coalesce(t->>'code','')||' · '||(t->>'name'),'; ' order by t->>'name') into orders,tests from jsonb_array_elements(b.laboratory_details->'tests')t;
   insert into public.laboratory_orders(patient_id,doctor_id,laboratory_institution_id,requested_tests,priority,request_id,created_by,hospital_booking_id,catalog_details,sample_status,sample_status_at,version)
   values(b.patient_id,b.referring_doctor_id,s.institution_id,left(tests,2000),case when b.priority then 'URGENT' else 'REGULAR' end,gen_random_uuid(),auth.uid(),b.id,
    jsonb_build_object('orders',orders,'specimens',coalesce(b.laboratory_details->'specimens','[]'::jsonb)),'ARRIVED',now(),b.version+1) returning * into o;
   if b.status='BOOKED' then update public.hospital_bookings set status='ARRIVED',version=version+1 where id=b.id;end if;
   perform private.audit_event('LAB_PATIENT_RECEIVED','laboratory_orders',o.id);return o.id;
  end if;
 else
  select * into o from public.laboratory_orders where id=source_id for update;
  if o.id is null or o.hospital_booking_id is not null or not private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 if o.version is distinct from expected_version then raise exception 'Work item changed' using errcode='40001';end if;
 if o.status not in('ORDERED','IN_PROGRESS') then raise exception 'Order is closed';end if;
 current_stage:=case when o.status='IN_PROGRESS' and o.sample_status='EXPECTED' then 'PROCESSING' else o.sample_status end;
 if (current_stage='EXPECTED' and new_stage='ARRIVED') or (current_stage in('ARRIVED','RECOLLECT') and new_stage='COLLECTED') or (current_stage='COLLECTED' and new_stage='PROCESSING') then null;
 elsif current_stage in('COLLECTED','PROCESSING') and new_stage='RECOLLECT' and length(trim(reason)) between 5 and 500 then null;
 else raise exception 'Invalid specimen transition or missing recollection reason';end if;
 update public.laboratory_orders set sample_status=new_stage,sample_status_at=now(),sample_note=case when new_stage='RECOLLECT' then trim(reason) else '' end,
  sample_collected_at=case when new_stage='COLLECTED' then now() else sample_collected_at end,
  sample_attempt=sample_attempt+case when new_stage='COLLECTED' then 1 else 0 end,
  status=case when new_stage='PROCESSING' then 'IN_PROGRESS' when new_stage='RECOLLECT' then 'ORDERED' else status end,version=version+1 where id=o.id;
 perform private.audit_event('LAB_SAMPLE_'||new_stage,'laboratory_orders',o.id);return o.id;
end $$;
-- A draft prepared for an earlier sample attempt must not be published after recollection.
do $$declare definition text;begin
 select pg_get_functiondef('public.publish_laboratory_result(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position('if o.status not in' in definition)=0 then raise exception 'Laboratory publication guard not found';end if;
 definition:=replace(definition,'if o.status not in', 'if (data ? ''expected_order_version'' or o.hospital_booking_id is not null or o.sample_status=''PROCESSING'') and (data->>''expected_order_version'')::integer is distinct from o.version then raise exception ''Order changed'' using errcode=''40001'';end if; if o.status not in');
 execute definition;
end $$;
revoke all on function private.preserve_sample_event(),private.guard_laboratory_workflow(),private.record_laboratory_sample_event() from public,anon,authenticated;
revoke all on function public.laboratory_worklist(date,uuid,text,text,integer),public.advance_laboratory_workflow(text,uuid,integer,text,text) from public,anon;
grant execute on function public.laboratory_worklist(date,uuid,text,text,integer),public.advance_laboratory_workflow(text,uuid,integer,text,text) to authenticated;
commit;

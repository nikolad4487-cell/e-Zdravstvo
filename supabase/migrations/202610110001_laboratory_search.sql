begin;

-- Keep list_laboratory available to clients using the previous release.
create function public.search_laboratory(
 mode text,patient_filter uuid default null,page_number integer default 0,
 search_term text default '',status_filter text default null,priority_filter text default null,
 date_from date default null,date_to date default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;term text:=lower(trim(search_term));
begin
 if auth.uid() is null or mode is null or mode not in ('CARE','PERSONAL','LAB')
   or (mode='PERSONAL' and not private.has_role('PATIENT')) then
   raise exception 'Forbidden' using errcode='42501';
 end if;
 if page_number is null or page_number not between 0 and 10000 or search_term is null or length(search_term)>200
   or (status_filter is not null and status_filter not in ('ORDERED','IN_PROGRESS','COMPLETED','CANCELLED'))
   or (priority_filter is not null and priority_filter not in ('REGULAR','URGENT'))
   or (date_from is not null and date_to is not null and date_from>date_to) then
   raise exception 'Invalid laboratory search';
 end if;

 -- Filter and page orders before expanding immutable result history.
 with orders as materialized (
   select o.*,p.first_name||' '||p.last_name patient_name,p.patient_number,p.birth_date,
     d.display_name doctor_name,i.name laboratory_name,
     mode='LAB' and private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) can_publish,
     mode='CARE' and d.user_id=auth.uid() and private.treating_doctor(o.patient_id) is not null can_cancel
   from public.laboratory_orders o
   join public.patients p on p.id=o.patient_id
   join public.doctors d on d.id=o.doctor_id
   join public.institutions i on i.id=o.laboratory_institution_id
   where (patient_filter is null or o.patient_id=patient_filter)
     and case mode
       when 'LAB' then private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id)
       when 'PERSONAL' then p.user_id=auth.uid() and p.archived_at is null
       else private.can_read_patient(o.patient_id)
     end
     and (term='' or position(term in lower(concat_ws(' ',o.number,o.requested_tests,p.first_name,p.last_name,p.patient_number,d.display_name,i.name)))>0)
     and (status_filter is null or o.status=status_filter)
     and (priority_filter is null or o.priority=priority_filter)
     and (date_from is null or o.created_at >= (date_from::timestamp at time zone 'Europe/Zagreb'))
     and (date_to is null or o.created_at < ((date_to+1)::timestamp at time zone 'Europe/Zagreb'))
   order by o.created_at desc,o.id limit 50 offset page_number*50
 )
 select coalesce(jsonb_agg(to_jsonb(o)||jsonb_build_object('results',(
   select coalesce(jsonb_agg(to_jsonb(r)||jsonb_build_object(
     'author',pr.first_name||' '||pr.last_name,'parameters',(
       select coalesce(jsonb_agg(to_jsonb(v) order by v.code),'[]')
       from public.laboratory_parameters v where v.result_id=r.id
     )) order by r.version desc),'[]')
   from public.laboratory_results r join public.profiles pr on pr.id=r.created_by where r.order_id=o.id
 )) order by o.created_at desc,o.id),'[]') into result from orders o;
 perform private.audit_event('LABORATORY_VIEWED','laboratory_orders',patient_filter);
 return result;
end $$;

create index lab_patient_history_idx on public.laboratory_orders(patient_id,created_at desc,id);
create index lab_institution_history_idx on public.laboratory_orders(laboratory_institution_id,created_at desc,id);
revoke all on function public.search_laboratory(text,uuid,integer,text,text,text,date,date) from public,anon;
grant execute on function public.search_laboratory(text,uuid,integer,text,text,text,date,date) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 20261011$$;
commit;

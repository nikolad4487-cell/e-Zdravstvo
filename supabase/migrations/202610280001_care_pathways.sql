begin;
create table public.care_result_reviews(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),
 laboratory_result_id uuid references public.laboratory_results(id),medical_report_id uuid references public.medical_reports(id),
 reviewed_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 check(num_nonnulls(laboratory_result_id,medical_report_id)=1),unique(doctor_id,laboratory_result_id),unique(doctor_id,medical_report_id)
);
create table public.care_followups(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),
 source_kind text check(source_kind in('BOOKING','REFERRAL','LAB_ORDER','LAB_RESULT','MEDICAL_REPORT')),source_id uuid,check((source_kind is null)=(source_id is null)),
 due_on date not null,title text not null check(length(trim(title)) between 3 and 300),status text not null default 'OPEN' check(status in('OPEN','DONE','CANCELLED')),
 resolution text not null default '' check(length(resolution)<=1000),version integer not null default 1,
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),request_id uuid not null,unique(created_by,request_id)
);
create index care_followups_due on public.care_followups(doctor_id,status,due_on,id);
create index medical_report_booking_current on public.medical_reports(booking_id) where superseded_by is null;
do $$declare t text;begin foreach t in array array['care_result_reviews','care_followups'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
end loop;end $$;
create trigger no_update before update on public.care_result_reviews for each row execute function private.preserve_sample_event();

create function public.review_care_result(result_kind text,result_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid;did uuid;rid uuid;
begin
 if result_kind='LAB_RESULT' then select o.patient_id into pid from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.id=result_id and r.superseded_by is null;
 elsif result_kind='MEDICAL_REPORT' then select r.patient_id into pid from public.medical_reports r where r.id=result_id and r.superseded_by is null;
 else raise exception 'Invalid result kind';end if;
 did:=private.treating_doctor(pid);if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 if result_kind='LAB_RESULT' then
 if exists(select 1 from public.laboratory_parameters p where p.result_id=review_care_result.result_id and p.flag='CRITICAL') and not exists(select 1 from public.laboratory_acknowledgements a where a.result_id=review_care_result.result_id) then raise exception 'Najprije potvrdite preuzimanje kritičnog nalaza u laboratorijskim rezultatima.';end if;
 insert into public.care_result_reviews(patient_id,doctor_id,laboratory_result_id,created_by) values(pid,did,result_id,auth.uid()) on conflict(doctor_id,laboratory_result_id) do nothing;
 select id into rid from public.care_result_reviews where doctor_id=did and laboratory_result_id=result_id;
 else
 insert into public.care_result_reviews(patient_id,doctor_id,medical_report_id,created_by) values(pid,did,result_id,auth.uid()) on conflict(doctor_id,medical_report_id) do nothing;
 select id into rid from public.care_result_reviews where doctor_id=did and medical_report_id=result_id;
 end if;
 perform private.audit_event('CARE_RESULT_REVIEWED','care_result_reviews',rid);return rid;
end $$;
create function public.create_care_followup(patient_id uuid,due_on date,title text,request_id uuid,source_kind text default null,source_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);prior public.care_followups;rid uuid;source_patient uuid;
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 if due_on is null or due_on<(now() at time zone 'Europe/Zagreb')::date or due_on>(now() at time zone 'Europe/Zagreb')::date+730 or title is null or length(trim(title)) not between 3 and 300 or request_id is null then raise exception 'Invalid follow-up';end if;
 if source_kind is not null or source_id is not null then
 case source_kind
 when 'BOOKING' then select b.patient_id into source_patient from public.hospital_bookings b where b.id=source_id;
 when 'REFERRAL' then select d.patient_id into source_patient from public.documents d where d.id=source_id and d.kind='REFERRAL';
 when 'LAB_ORDER' then select o.patient_id into source_patient from public.laboratory_orders o where o.id=source_id;
 when 'LAB_RESULT' then select o.patient_id into source_patient from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.id=source_id;
 when 'MEDICAL_REPORT' then select r.patient_id into source_patient from public.medical_reports r where r.id=source_id;
 else raise exception 'Invalid follow-up source';end case;
 if source_patient is distinct from patient_id then raise exception 'Forbidden' using errcode='42501';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,281));
 select * into prior from public.care_followups f where f.created_by=auth.uid() and f.request_id=create_care_followup.request_id;
 if prior.id is not null then
 if prior.patient_id is distinct from patient_id or prior.due_on is distinct from due_on or prior.title is distinct from trim(title) or prior.source_kind is distinct from source_kind or prior.source_id is distinct from source_id then raise exception 'Request changed' using errcode='40001';end if;return prior.id;end if;
 insert into public.care_followups(patient_id,doctor_id,due_on,title,request_id,created_by,source_kind,source_id) values(patient_id,did,due_on,trim(title),request_id,auth.uid(),source_kind,source_id) returning id into rid;
 perform private.audit_event('CARE_FOLLOWUP_CREATED','care_followups',rid);return rid;
end $$;
create function public.resolve_care_followup(followup_id uuid,expected_version integer,new_status text,resolution text) returns void language plpgsql security definer set search_path='' as $$
declare f public.care_followups;
begin
 select * into f from public.care_followups where id=followup_id for update;
 if f.id is null or private.treating_doctor(f.patient_id) is distinct from f.doctor_id then raise exception 'Forbidden' using errcode='42501';end if;
 if f.version is distinct from expected_version then raise exception 'Follow-up changed' using errcode='40001';end if;
 if f.status<>'OPEN' or new_status is null or new_status not in('DONE','CANCELLED') or length(trim(coalesce(resolution,''))) not between 5 and 1000 then raise exception 'Invalid follow-up resolution';end if;
 update public.care_followups set status=new_status,resolution=trim(resolve_care_followup.resolution),version=version+1 where id=f.id;
 perform private.audit_event('CARE_FOLLOWUP_'||new_status,'care_followups',f.id);
end $$;

-- Use the same booking -> order lock order as specimen reception before closing a lab appointment.
do $$declare definition text;begin
 select pg_get_functiondef('public.publish_laboratory_result(uuid,uuid,jsonb)'::regprocedure) into definition;
 if position('select * into o from public.laboratory_orders where id=order_id for update;' in definition)=0 then raise exception 'Laboratory lock anchor missing';end if;
 definition:=replace(definition,'select * into o from public.laboratory_orders where id=order_id for update;',
 'perform 1 from public.hospital_bookings b where b.id=(select x.hospital_booking_id from public.laboratory_orders x where x.id=publish_laboratory_result.order_id) for update; select * into o from public.laboratory_orders where id=order_id for update;');execute definition;
end $$;
create function private.complete_result_booking() returns trigger language plpgsql security definer set search_path='' as $$
declare bid uuid;
begin
 if tg_table_name='medical_reports' then bid:=new.booking_id;
 elsif new.status='COMPLETED' and old.status<>'COMPLETED' then bid:=new.hospital_booking_id;
 else return new;end if;
 if bid is not null then update public.hospital_bookings set status='COMPLETED',version=version+1 where id=bid and status='ARRIVED';end if;return new;
end $$;
create trigger care_report_complete after insert on public.medical_reports for each row execute function private.complete_result_booking();
create trigger care_lab_complete after update on public.laboratory_orders for each row execute function private.complete_result_booking();
revoke all on function private.complete_result_booking() from public,anon,authenticated;

create function public.care_pathways(patient_filter uuid default null,search_term text default '',stage_filter text default null,include_closed boolean default false,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not private.has_role('DOCTOR') or (patient_filter is not null and private.treating_doctor(patient_filter) is null) then raise exception 'Forbidden' using errcode='42501';end if;
 if search_term is null or length(search_term)>200 or page_number is null or page_number not between 0 and 10000 or include_closed is null or (stage_filter is not null and stage_filter not in('WAITING_BOOKING','WAITING_VISIT','WAITING_RESULT','MISSING_RESULT','NEEDS_REVIEW','REVIEWED','FOLLOWUP_DUE','FOLLOWUP_PLANNED','CLOSED')) then raise exception 'Invalid pathway filters';end if;
 with care as materialized (
 select p.id,p.first_name||' '||p.last_name patient_name,p.patient_number,private.treating_doctor(p.id) doctor_id from public.patients p where (patient_filter is null or p.id=patient_filter) and p.archived_at is null and private.treating_doctor(p.id) is not null
 ), entries as materialized (
 select 'REFERRAL'::text source_kind,d.id source_id,c.id patient_id,c.patient_name,c.patient_number,d.number title,r.specialty detail,d.issued_at event_at,null::date due_on,'WAITING_BOOKING'::text stage,null::text result_kind,null::uuid result_id,1 version,null::uuid referral_id from public.documents d join public.referrals r on r.document_id=d.id join care c on c.id=d.patient_id
 where d.revoked_at is null and d.status not in('CANCELLED','REVOKED','EXPIRED','DRAFT') and d.expires_on>=(now() at time zone 'Europe/Zagreb')::date and not exists(select 1 from public.hospital_bookings b where b.referral_id=d.id and b.status<>'CANCELLED')
 union all
 select 'BOOKING',b.id,c.id,c.patient_name,c.patient_number,s.name,coalesce(l.number,'')||' · '||i.name,sl.starts_at,null,
 case when b.status in('CANCELLED','NO_SHOW') or l.status='CANCELLED' then 'CLOSED' when lr.id is not null then case when exists(select 1 from public.care_result_reviews v where v.doctor_id=c.doctor_id and v.laboratory_result_id=lr.id) then 'REVIEWED' else 'NEEDS_REVIEW' end when b.status='COMPLETED' then 'MISSING_RESULT' when b.status='ARRIVED' then 'WAITING_RESULT' else 'WAITING_VISIT' end,
 case when lr.id is not null then 'LAB_RESULT' end,lr.id,b.version,b.referral_id
 from public.hospital_bookings b join care c on c.id=b.patient_id join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.institutions i on i.id=s.institution_id
 left join lateral(select r.id,r.number from public.medical_reports r where r.booking_id=b.id and r.superseded_by is null order by r.created_at desc,r.id limit 1)m on true
 left join public.laboratory_orders l on l.hospital_booking_id=b.id
 left join lateral(select r.id from public.laboratory_results r where r.order_id=l.id and r.superseded_by is null order by r.version desc limit 1)lr on true
 where m.id is null or lr.id is not null
 union all
 select 'LAB_ORDER',l.id,c.id,c.patient_name,c.patient_number,l.number,l.requested_tests,l.created_at,null,
 case when l.status='CANCELLED' then 'CLOSED' when r.id is null then 'WAITING_RESULT' when exists(select 1 from public.care_result_reviews v where v.doctor_id=c.doctor_id and v.laboratory_result_id=r.id) then 'REVIEWED' else 'NEEDS_REVIEW' end,
 case when r.id is not null then 'LAB_RESULT' end,r.id,l.version,null from public.laboratory_orders l join care c on c.id=l.patient_id left join lateral(select r.id from public.laboratory_results r where r.order_id=l.id and r.superseded_by is null order by r.version desc limit 1)r on true where l.hospital_booking_id is null
 union all
 select 'MEDICAL_REPORT',m.id,c.id,c.patient_name,c.patient_number,m.number,m.specialty,m.created_at,null,
 case when exists(select 1 from public.care_result_reviews v where v.doctor_id=c.doctor_id and v.medical_report_id=m.id) then 'REVIEWED' else 'NEEDS_REVIEW' end,'MEDICAL_REPORT',m.id,m.version,null from public.medical_reports m join care c on c.id=m.patient_id where m.superseded_by is null
 union all
 select 'FOLLOWUP',f.id,c.id,c.patient_name,c.patient_number,f.title,f.resolution,f.created_at,f.due_on,
 case when f.status<>'OPEN' then 'CLOSED' when f.due_on<=(now() at time zone 'Europe/Zagreb')::date then 'FOLLOWUP_DUE' else 'FOLLOWUP_PLANNED' end,null,null,f.version,null from public.care_followups f join care c on c.id=f.patient_id and c.doctor_id=f.doctor_id
 ), matched as materialized (
 select * from entries e where (include_closed or e.stage not in('CLOSED','REVIEWED')) and (trim(search_term)='' or position(lower(trim(search_term)) in lower(concat_ws(' ',e.patient_name,e.patient_number,e.title,e.detail)))>0)
 ), filtered as materialized(select * from matched where stage_filter is null or stage=stage_filter), paged as (
 select * from filtered order by case when stage in('FOLLOWUP_DUE','NEEDS_REVIEW','MISSING_RESULT') then 0 else 1 end,due_on nulls last,event_at,source_kind,source_id limit 50 offset page_number*50
 )select jsonb_build_object('total',(select count(*) from filtered),'counts',(select coalesce(jsonb_object_agg(stage,n),'{}') from(select stage,count(*) n from matched group by stage)x),'items',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('critical',p.result_kind='LAB_RESULT' and exists(select 1 from public.laboratory_parameters v where v.result_id=p.result_id and v.flag='CRITICAL'),'acknowledged',exists(select 1 from public.laboratory_acknowledgements a where a.result_id=p.result_id),'origin',case when p.source_kind='FOLLOWUP' then (select jsonb_build_object('kind',f.source_kind,'id',f.source_id) from public.care_followups f where f.id=p.source_id and f.source_id is not null) else null end) order by case when stage in('FOLLOWUP_DUE','NEEDS_REVIEW','MISSING_RESULT') then 0 else 1 end,due_on nulls last,event_at,source_kind,source_id),'[]') from paged p)) into result;
 perform private.audit_event('CARE_PATHWAYS_VIEWED','patients',patient_filter);return result;
end $$;
revoke all on function public.care_pathways(uuid,text,text,boolean,integer),public.review_care_result(text,uuid),public.create_care_followup(uuid,date,text,uuid,text,uuid),public.resolve_care_followup(uuid,integer,text,text) from public,anon;
grant execute on function public.care_pathways(uuid,text,text,boolean,integer),public.review_care_result(text,uuid),public.create_care_followup(uuid,date,text,uuid,text,uuid),public.resolve_care_followup(uuid,integer,text,text) to authenticated;
commit;

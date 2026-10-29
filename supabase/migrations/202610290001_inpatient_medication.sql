begin;
-- Physician-authored orders and individual scheduled doses. No inferred doses or recurrence.
create table public.inpatient_medication_orders (
 id uuid primary key default gen_random_uuid(), admission_id uuid not null references public.inpatient_admissions(id),
 medication_id uuid not null references public.medications(id), medication_snapshot jsonb not null,
 dose text not null check(length(trim(dose)) between 1 and 200), route text not null check(length(trim(route)) between 1 and 200),
 instructions text not null default '' check(length(instructions)<=2000),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','STOPPED','DISCHARGED')),
 created_by uuid not null references public.profiles(id), author_name text not null, created_at timestamptz not null default now(),
 request_id uuid not null, request_payload jsonb not null, unique(created_by,request_id),
 version integer not null default 1, stopped_at timestamptz, stopped_by uuid references public.profiles(id), stop_author text, stop_reason text,
 check((status='ACTIVE' and stopped_at is null and stopped_by is null and stop_reason is null) or (status<>'ACTIVE' and stopped_at is not null and stopped_by is not null and stop_reason is not null and length(trim(stop_reason))>=5))
);
create index inpatient_medication_episode on public.inpatient_medication_orders(admission_id,created_at desc,id);
create table public.inpatient_medication_doses (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.inpatient_medication_orders(id),
 scheduled_at timestamptz not null, unique(order_id,scheduled_at)
);
create table public.inpatient_medication_records (
 id uuid primary key default gen_random_uuid(), dose_id uuid not null references public.inpatient_medication_doses(id),
 outcome text not null check(outcome in ('GIVEN','NOT_GIVEN')), actual_at timestamptz not null,
 actual_dose text, patient_confirmed boolean not null,
 note text not null default '' check(length(note)<=2000),
 created_by uuid not null references public.profiles(id), author_name text not null, created_at timestamptz not null default now(),
 request_id uuid not null, unique(created_by,request_id),
 corrects_record_id uuid unique references public.inpatient_medication_records(id),
 superseded_by uuid references public.inpatient_medication_records(id), correction_reason text not null default '',
 check((outcome='GIVEN' and patient_confirmed and actual_dose is not null and length(trim(actual_dose)) between 1 and 200) or (outcome='NOT_GIVEN' and actual_dose is null and length(trim(note))>=5)),
 check((corrects_record_id is null and correction_reason='') or (corrects_record_id is not null and length(trim(correction_reason)) between 5 and 1000))
);
create unique index inpatient_medication_one_current_record on public.inpatient_medication_records(dose_id) where superseded_by is null;
create index inpatient_medication_record_history on public.inpatient_medication_records(dose_id,created_at desc,id);
do $$declare t text;begin
 foreach t in array array['inpatient_medication_orders','inpatient_medication_doses','inpatient_medication_records'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
 execute format('create policy verified_mfa_session on public.%I as restrictive for all to authenticated using((select not private.mfa_challenge_required())) with check((select not private.mfa_challenge_required()))',t);
 end loop;
end $$;
create function private.preserve_medication_order() returns trigger language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-array['status','stopped_at','stopped_by','stop_author','stop_reason','version']) is distinct from (to_jsonb(old)-array['status','stopped_at','stopped_by','stop_author','stop_reason','version']) or old.status<>'ACTIVE' or new.status='ACTIVE' or new.version<>old.version+1 then raise exception 'Medication orders are immutable; stop and issue a new order';end if;return new;
end $$;
create trigger preserve_order before update on public.inpatient_medication_orders for each row execute function private.preserve_medication_order();
create trigger preserve_dose before update on public.inpatient_medication_doses for each row execute function private.preserve_sample_event();
create function private.preserve_medication_record() returns trigger language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-'superseded_by') is distinct from (to_jsonb(old)-'superseded_by') or old.superseded_by is not null or new.superseded_by is null then raise exception 'Medication records are immutable; create a correction';end if;return new;
end $$;
create trigger preserve_record before update on public.inpatient_medication_records for each row execute function private.preserve_medication_record();
create function private.can_record_inpatient_medication(a public.inpatient_admissions) returns boolean language sql stable security definer set search_path='' as $$
 select private.manage_inpatient(a) or (private.read_inpatient(a) and private.has_role('NURSE',a.institution_id) and exists(select 1 from public.patient_staff s where s.patient_id=a.patient_id and s.user_id=auth.uid() and s.institution_id=a.institution_id and s.revoked_at is null))
$$;
-- All times are entered explicitly in Zagreb, independent of browser/server time zone.
-- Reject nonexistent and ambiguous DST local times; user must select a distinct time.
create function private.medication_local_time(value text) returns timestamptz language plpgsql stable set search_path='' as $$declare local_time timestamp;instant timestamptz;begin
 if value is null or value !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$' then raise exception 'Invalid Zagreb date and time';end if;
 local_time:=value::timestamp;instant:=local_time at time zone 'Europe/Zagreb';
 if (instant at time zone 'Europe/Zagreb')<>local_time or ((instant-interval '1 hour') at time zone 'Europe/Zagreb')=local_time or ((instant+interval '1 hour') at time zone 'Europe/Zagreb')=local_time then raise exception 'Ambiguous or nonexistent Zagreb time';end if;
 return instant;
end $$;
create function public.create_inpatient_medication_order(admission_id uuid, medication_id uuid, dose text, route text, instructions text, scheduled_times text[], request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.inpatient_admissions;m public.medications;prior public.inpatient_medication_orders;payload jsonb;rid uuid;stamp timestamptz;times timestamptz[]:='{}';value text;
begin
 select * into a from public.inpatient_admissions where id=admission_id for update;
 if a.id is null or not private.manage_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null then raise exception 'Request required';end if;
 payload:=jsonb_build_object('admission_id',admission_id,'medication_id',medication_id,'dose',trim(dose),'route',trim(route),'instructions',coalesce(trim(instructions),''),'times',scheduled_times);
 select * into prior from public.inpatient_medication_orders o where o.created_by=auth.uid() and o.request_id=create_inpatient_medication_order.request_id;
 if prior.id is not null then if prior.request_payload is distinct from payload then raise exception 'Request changed' using errcode='40001';end if;return prior.id;end if;
 if a.status<>'ADMITTED' then raise exception 'Admission is closed';end if;
 select * into m from public.medications where id=medication_id and active and (catalog_list is null or trim(catalog_metadata->'fields'->>'R/RS') in ('R','RS','RSf'));
 if m.id is null then raise exception 'Medication unavailable';end if;
 if scheduled_times is null or cardinality(scheduled_times) not between 1 and 48 then raise exception 'Choose between 1 and 48 individual dose times';end if;
 foreach value in array scheduled_times loop
 stamp:=private.medication_local_time(value);
 if stamp<a.admitted_at or stamp>now()+interval '366 days' or stamp=any(times) then raise exception 'Invalid or duplicate dose time';end if;
 times:=array_append(times,stamp);
 end loop;
 insert into public.inpatient_medication_orders(admission_id,medication_id,medication_snapshot,dose,route,instructions,created_by,author_name,request_id,request_payload)
 values(a.id,m.id,to_jsonb(m)-array['created_at','active'],trim(dose),trim(route),coalesce(trim(instructions),''),auth.uid(),private.inpatient_actor_name(a.institution_id),request_id,payload) returning id into rid;
 insert into public.inpatient_medication_doses(order_id,scheduled_at) select rid,unnest(times);
 perform private.audit_event('INPATIENT_MEDICATION_ORDERED','inpatient_medication_orders',rid);return rid;
end $$;
create function public.stop_inpatient_medication_order(order_id uuid,expected_version integer,reason text) returns void language plpgsql security definer set search_path='' as $$declare a public.inpatient_admissions;o public.inpatient_medication_orders;begin
 select a0.* into a from public.inpatient_admissions a0 join public.inpatient_medication_orders o0 on o0.admission_id=a0.id where o0.id=order_id for update of a0;
 if a.id is null or not private.manage_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into o from public.inpatient_medication_orders where id=order_id for update;
 if o.status='STOPPED' and o.stopped_by=auth.uid() and o.stop_reason=trim(reason) and o.version=expected_version+1 then return;end if;
 if a.status<>'ADMITTED' or o.status<>'ACTIVE' then raise exception 'Medication order is closed';end if;
 if o.version is distinct from expected_version then raise exception 'Order changed' using errcode='40001';end if;
 if reason is null or length(trim(reason)) not between 5 and 1000 then raise exception 'Stop reason required';end if;
 update public.inpatient_medication_orders set status='STOPPED',version=version+1,stopped_at=now(),stopped_by=auth.uid(),stop_author=private.inpatient_actor_name(a.institution_id),stop_reason=trim(reason) where id=o.id;
 perform private.audit_event('INPATIENT_MEDICATION_STOPPED','inpatient_medication_orders',o.id);
end $$;
create function public.record_inpatient_medication(dose_id uuid,outcome text,actual_time text,actual_dose text,patient_confirmed boolean,note text,request_id uuid,corrects_record_id uuid default null,correction_reason text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare a public.inpatient_admissions;o public.inpatient_medication_orders;d public.inpatient_medication_doses;prior public.inpatient_medication_records;existing public.inpatient_medication_records;stamp timestamptz;rid uuid:=gen_random_uuid();clean_dose text;clean_note text:=coalesce(trim(note),'');
begin
 select a0.* into a from public.inpatient_admissions a0 join public.inpatient_medication_orders o0 on o0.admission_id=a0.id join public.inpatient_medication_doses d0 on d0.order_id=o0.id where d0.id=dose_id for update of a0;
 if a.id is null or not private.can_record_inpatient_medication(a) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null then raise exception 'Request required';end if;
 select * into d from public.inpatient_medication_doses where id=dose_id for update;
 select * into o from public.inpatient_medication_orders where id=d.order_id;
 stamp:=private.medication_local_time(actual_time);clean_dose:=case when outcome='GIVEN' then trim(actual_dose) else null end;
 select * into existing from public.inpatient_medication_records r where r.created_by=auth.uid() and r.request_id=record_inpatient_medication.request_id;
 if existing.id is not null then
 if existing.dose_id is distinct from dose_id or existing.outcome is distinct from outcome or existing.actual_at is distinct from stamp or existing.actual_dose is distinct from clean_dose or existing.patient_confirmed is distinct from patient_confirmed or existing.note is distinct from clean_note or existing.corrects_record_id is distinct from corrects_record_id or existing.correction_reason is distinct from coalesce(trim(correction_reason),'') then raise exception 'Request changed' using errcode='40001';end if;return existing.id;
 end if;
 if corrects_record_id is null then
 if a.status<>'ADMITTED' or o.status<>'ACTIVE' then raise exception 'Medication order is closed';end if;
 if exists(select 1 from public.inpatient_medication_records r where r.dose_id=d.id and r.superseded_by is null) then raise exception 'Dose already recorded' using errcode='40001';end if;
 else
 select * into prior from public.inpatient_medication_records where id=record_inpatient_medication.corrects_record_id for update;
 if prior.id is null or prior.dose_id<>d.id or prior.created_by<>auth.uid() or prior.superseded_by is not null then raise exception 'Invalid record correction';end if;
 end if;
 if stamp<a.admitted_at or stamp>now() or (o.stopped_at is not null and stamp>o.stopped_at) or (a.discharged_at is not null and stamp>a.discharged_at) then raise exception 'Invalid administration time';end if;
 if outcome='GIVEN' and clean_dose is distinct from o.dose and length(clean_note)<5 then raise exception 'Explain dose deviation';end if;
 -- Defer only the circular correction link, preserving the current-record unique index.
 if prior.id is not null then update public.inpatient_medication_records set superseded_by=rid where id=prior.id;end if;
 insert into public.inpatient_medication_records(id,dose_id,outcome,actual_at,actual_dose,patient_confirmed,note,created_by,author_name,request_id,corrects_record_id,correction_reason)
 values(rid,d.id,outcome,stamp,clean_dose,patient_confirmed,clean_note,auth.uid(),private.inpatient_actor_name(a.institution_id),request_id,corrects_record_id,coalesce(trim(correction_reason),''));
 perform private.audit_event('INPATIENT_MEDICATION_RECORDED','inpatient_medication_records',rid);return rid;
end $$;
alter table public.inpatient_medication_records drop constraint inpatient_medication_records_superseded_by_fkey;
alter table public.inpatient_medication_records add constraint inpatient_medication_records_superseded_by_fkey foreign key(superseded_by) references public.inpatient_medication_records(id) deferrable initially deferred;
create function public.inpatient_medications(admission_id uuid,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.inpatient_admissions;result jsonb;begin
 select * into a from public.inpatient_admissions where id=admission_id;
 if a.id is null or not private.read_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid page';end if;
 select jsonb_build_object('can_order',private.manage_inpatient(a),'can_record',private.can_record_inpatient_medication(a),'admission_status',a.status,'total',(select count(*) from public.inpatient_medication_orders o where o.admission_id=a.id),'orders',(select coalesce(jsonb_agg(to_jsonb(x)-'request_payload'||jsonb_build_object('doses',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('record',(select to_jsonb(r)||jsonb_build_object('can_correct',r.created_by=auth.uid()) from public.inpatient_medication_records r where r.dose_id=d.id and r.superseded_by is null)) order by d.scheduled_at,d.id),'[]') from public.inpatient_medication_doses d where d.order_id=x.id)) order by x.created_at desc,x.id),'[]') from (select * from public.inpatient_medication_orders o where o.admission_id=a.id order by o.created_at desc,o.id limit 20 offset page_number*20)x)) into result;
 perform private.audit_event('INPATIENT_MEDICATION_VIEWED','inpatient_admissions',a.id);return result;
end $$;
create function public.inpatient_medication_history(order_id uuid,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.inpatient_admissions;result jsonb;begin
 select a0.* into a from public.inpatient_admissions a0 join public.inpatient_medication_orders o on o.admission_id=a0.id where o.id=order_id;
 if a.id is null or not private.read_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid page';end if;
 select jsonb_build_object('total',(select count(*) from public.inpatient_medication_records r join public.inpatient_medication_doses d on d.id=r.dose_id where d.order_id=inpatient_medication_history.order_id),'records',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id),'[]') from(select r.*,d.scheduled_at from public.inpatient_medication_records r join public.inpatient_medication_doses d on d.id=r.dose_id where d.order_id=inpatient_medication_history.order_id order by r.created_at desc,r.id limit 50 offset page_number*50)x)) into result;
 perform private.audit_event('INPATIENT_MEDICATION_HISTORY_VIEWED','inpatient_admissions',a.id);return result;
end $$;
create function private.close_inpatient_medications() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.status='ADMITTED' and new.status='DISCHARGED' then
 update public.inpatient_medication_orders set status='DISCHARGED',version=version+1,stopped_at=new.discharged_at,stopped_by=auth.uid(),stop_author=private.inpatient_actor_name(new.institution_id),stop_reason='Bolnički otpust' where admission_id=new.id and status='ACTIVE';
 end if;return new;
end $$;
create trigger close_medications after update on public.inpatient_admissions for each row execute function private.close_inpatient_medications();
-- Reuse existing nonclinical revision notifications, mapping medication rows to their episode.
create function private.inpatient_medication_revision() returns trigger language plpgsql security definer set search_path='' as $$declare episode uuid;begin
 if tg_table_name='inpatient_medication_orders' then episode:=new.admission_id;
 else select o.admission_id into episode from public.inpatient_medication_orders o join public.inpatient_medication_doses d on d.order_id=o.id where d.id=new.dose_id;end if;
 insert into public.schedule_events(user_id,revision)
 select distinct p.user_id,gen_random_uuid() from (
 select d.user_id from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=(select patient_id from public.inpatient_admissions where id=episode) and pd.revoked_at is null and d.active
 union select s.user_id from public.patient_staff s join public.inpatient_admissions a on a.patient_id=s.patient_id and a.institution_id=s.institution_id where a.id=episode and s.revoked_at is null
 )p where exists(select 1 from public.institution_users u where u.user_id=p.user_id and u.active) on conflict(user_id) do update set revision=excluded.revision;
 return new;
end $$;
create trigger medication_order_revision after insert or update on public.inpatient_medication_orders for each row execute function private.inpatient_medication_revision();
create trigger medication_record_revision after insert or update on public.inpatient_medication_records for each row execute function private.inpatient_medication_revision();
revoke all on function private.preserve_medication_order(),private.preserve_medication_record(),private.can_record_inpatient_medication(public.inpatient_admissions),private.medication_local_time(text),private.close_inpatient_medications(),private.inpatient_medication_revision() from public,anon,authenticated;
revoke all on function public.create_inpatient_medication_order(uuid,uuid,text,text,text,text[],uuid),public.stop_inpatient_medication_order(uuid,integer,text),public.record_inpatient_medication(uuid,text,text,text,boolean,text,uuid,uuid,text),public.inpatient_medications(uuid,integer),public.inpatient_medication_history(uuid,integer) from public,anon;
grant execute on function public.create_inpatient_medication_order(uuid,uuid,text,text,text,text[],uuid),public.stop_inpatient_medication_order(uuid,integer,text),public.record_inpatient_medication(uuid,text,text,text,boolean,text,uuid,uuid,text),public.inpatient_medications(uuid,integer),public.inpatient_medication_history(uuid,integer) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102901$$;
notify pgrst,'reload schema';
commit;

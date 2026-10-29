begin;
create table public.inpatient_wards(id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.institutions(id),name text not null check(length(trim(name)) between 2 and 150),active boolean not null default true,unique(institution_id,name),unique(id,institution_id));
create table public.inpatient_beds(id uuid primary key default gen_random_uuid(),ward_id uuid not null references public.inpatient_wards(id),institution_id uuid not null references public.institutions(id),label text not null check(length(trim(label)) between 1 and 100),active boolean not null default true,unique(ward_id,label),unique(id,institution_id),foreign key(ward_id,institution_id) references public.inpatient_wards(id,institution_id));
alter table public.doctors add constraint inpatient_doctor_institution_identity unique(id,institution_id);
create table public.inpatient_admissions(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),institution_id uuid not null references public.institutions(id),bed_id uuid not null references public.inpatient_beds(id),initial_bed_id uuid not null references public.inpatient_beds(id),
 reason text not null check(length(trim(reason)) between 5 and 4000),status text not null default 'ADMITTED' check(status in('ADMITTED','DISCHARGED')),admitted_at timestamptz not null default now(),discharged_at timestamptz,discharge_report_id uuid unique references public.medical_reports(id),version integer not null default 1,
 created_by uuid not null references public.profiles(id),request_id uuid not null,unique(created_by,request_id),
 foreign key(bed_id,institution_id) references public.inpatient_beds(id,institution_id),foreign key(doctor_id,institution_id) references public.doctors(id,institution_id),
 check((status='ADMITTED' and discharged_at is null and discharge_report_id is null) or(status='DISCHARGED' and discharged_at>=admitted_at and discharge_report_id is not null))
);
alter table public.medical_reports add column inpatient_admission_id uuid references public.inpatient_admissions(id),add constraint report_single_episode check(num_nonnulls(booking_id,inpatient_admission_id)<=1);
create unique index inpatient_one_active_bed on public.inpatient_admissions(bed_id) where status='ADMITTED';
create unique index inpatient_one_active_patient on public.inpatient_admissions(patient_id) where status='ADMITTED';
create index inpatient_institution_status on public.inpatient_admissions(institution_id,status,admitted_at,id);
create index inpatient_patient_history on public.inpatient_admissions(patient_id,admitted_at desc,id);
create table public.inpatient_movements(id uuid primary key default gen_random_uuid(),admission_id uuid not null references public.inpatient_admissions(id),kind text not null check(kind in('ADMITTED','TRANSFERRED','DISCHARGED')),from_bed text,to_bed text,reason text not null default '',author_name text not null,created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id));
create index inpatient_movement_history on public.inpatient_movements(admission_id,created_at,id);
create table public.inpatient_notes(id uuid primary key default gen_random_uuid(),admission_id uuid not null references public.inpatient_admissions(id),kind text not null check(kind in('PROGRESS','NURSING')),content text not null check(length(trim(content)) between 5 and 8000),corrects_note_id uuid unique references public.inpatient_notes(id),superseded_by uuid references public.inpatient_notes(id),correction_reason text not null default '' check(length(correction_reason)<=1000),author_name text not null,created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),request_id uuid not null,unique(created_by,request_id));
create index inpatient_notes_history on public.inpatient_notes(admission_id,created_at desc,id);
do $$declare t text;begin foreach t in array array['inpatient_wards','inpatient_beds','inpatient_admissions','inpatient_movements','inpatient_notes'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);
 execute format('create policy verified_mfa_session on public.%I as restrictive for all to authenticated using((select not private.mfa_challenge_required())) with check((select not private.mfa_challenge_required()))',t);
end loop;end $$;
create trigger no_update before update on public.inpatient_movements for each row execute function private.preserve_sample_event();
create function private.preserve_inpatient_note() returns trigger language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-'superseded_by') is distinct from(to_jsonb(old)-'superseded_by') or old.superseded_by is not null then raise exception 'Create a correction; inpatient notes are immutable';end if;return new;end $$;
create trigger immutable_note before update on public.inpatient_notes for each row execute function private.preserve_inpatient_note();
create function private.preserve_inpatient_admission() returns trigger language plpgsql set search_path='' as $$begin
 if (to_jsonb(new)-array['bed_id','status','discharged_at','discharge_report_id','version']) is distinct from (to_jsonb(old)-array['bed_id','status','discharged_at','discharge_report_id','version']) or old.status='DISCHARGED' then raise exception 'Admission identity and discharged episodes are immutable';end if;return new;end $$;
create trigger preserve_admission before update on public.inpatient_admissions for each row execute function private.preserve_inpatient_admission();
create function private.read_inpatient(a public.inpatient_admissions) returns boolean language sql stable security definer set search_path='' as $$
 select private.can_read_patient(a.patient_id) and ((private.has_role('DOCTOR',a.institution_id) and exists(select 1 from public.doctors d where d.institution_id=a.institution_id and d.active and d.user_id=auth.uid())) or(private.has_role('NURSE',a.institution_id) and exists(select 1 from public.patient_staff s where s.patient_id=a.patient_id and s.user_id=auth.uid() and s.institution_id=a.institution_id and s.revoked_at is null)))
$$;
create function private.manage_inpatient(a public.inpatient_admissions) returns boolean language sql stable security definer set search_path='' as $$select private.read_inpatient(a) and private.has_role('DOCTOR',a.institution_id) and private.treating_doctor(a.patient_id) is not null$$;
create function private.inpatient_actor_name(org uuid,prefer_doctor boolean default true) returns text language sql stable security definer set search_path='' as $$
 select coalesce(case when prefer_doctor then (select nullif(trim(d.display_name),'') from public.doctors d where d.user_id=auth.uid() and d.institution_id=org and d.active) end,(select nullif(trim(p.first_name||' '||p.last_name),'') from public.profiles p where p.id=auth.uid()),'Djelatnik')
$$;
revoke all on function private.inpatient_actor_name(uuid,boolean) from public,anon,authenticated;
create function public.inpatient_context() returns jsonb language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null or not(private.has_role('DOCTOR') or private.has_role('NURSE') or private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN')) then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object('institutions',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'can_manage',private.hospital_admin(i.id)) order by i.name),'[]') from public.institutions i where i.active and (private.is_member(i.id) or private.hospital_admin(i.id))),
 'wards',(select coalesce(jsonb_agg(to_jsonb(w) order by w.name),'[]') from public.inpatient_wards w where private.is_member(w.institution_id) or private.hospital_admin(w.institution_id)),
 'beds',(select coalesce(jsonb_agg(to_jsonb(b)||jsonb_build_object('institution_id',w.institution_id,'ward_name',w.name,'occupied',exists(select 1 from public.inpatient_admissions a where a.bed_id=b.id and a.status='ADMITTED')) order by w.name,b.label),'[]') from public.inpatient_beds b join public.inpatient_wards w on w.id=b.ward_id where private.is_member(w.institution_id) or private.hospital_admin(w.institution_id)));
end $$;
create function public.save_inpatient_ward(ward_id uuid,institution_id uuid,name text,active boolean) returns uuid language plpgsql security definer set search_path='' as $$declare rid uuid;begin
 if not private.hospital_admin(institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if active is null then raise exception 'Active flag required';end if;
 perform pg_advisory_xact_lock(hashtextextended(institution_id::text,284));
 if ward_id is null then insert into public.inpatient_wards(institution_id,name,active) values(institution_id,trim(name),active) returning id into rid;
 else
 if not active and exists(select 1 from public.inpatient_admissions a join public.inpatient_beds b on b.id=a.bed_id where b.ward_id=save_inpatient_ward.ward_id and a.status='ADMITTED') then raise exception 'Occupied ward cannot be disabled';end if;
 update public.inpatient_wards w set name=trim(save_inpatient_ward.name),active=save_inpatient_ward.active where w.id=ward_id and w.institution_id=save_inpatient_ward.institution_id returning id into rid;if rid is null then raise exception 'Ward unavailable';end if;
 end if;perform private.audit_event('INPATIENT_WARD_SAVED','inpatient_wards',rid);return rid;
end $$;
create function public.save_inpatient_bed(bed_id uuid,ward_id uuid,label text,active boolean) returns uuid language plpgsql security definer set search_path='' as $$declare w public.inpatient_wards;rid uuid;begin
 select * into w from public.inpatient_wards where id=ward_id;
 if w.id is null or not private.hospital_admin(w.institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if active is null then raise exception 'Active flag required';end if;perform pg_advisory_xact_lock(hashtextextended(w.institution_id::text,284));
 if bed_id is null then insert into public.inpatient_beds(ward_id,institution_id,label,active) values(ward_id,w.institution_id,trim(label),active) returning id into rid;
 else
 if not active and exists(select 1 from public.inpatient_admissions a where a.bed_id=save_inpatient_bed.bed_id and a.status='ADMITTED') then raise exception 'Occupied bed cannot be disabled';end if;
 update public.inpatient_beds b set label=trim(save_inpatient_bed.label),active=save_inpatient_bed.active where b.id=bed_id and b.ward_id=save_inpatient_bed.ward_id returning id into rid;if rid is null then raise exception 'Bed unavailable';end if;
 end if;perform private.audit_event('INPATIENT_BED_SAVED','inpatient_beds',rid);return rid;
end $$;
create function public.admit_inpatient(patient_id uuid,bed_id uuid,reason text,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare bed public.inpatient_beds;ward public.inpatient_wards;did uuid;prior public.inpatient_admissions;rid uuid;
begin
 select * into bed from public.inpatient_beds where id=bed_id;select * into ward from public.inpatient_wards where id=bed.ward_id;
 select d.id into did from public.doctors d where d.institution_id=ward.institution_id and d.active and d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id);
 if did is null or private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null then raise exception 'Request required';end if;
 perform pg_advisory_xact_lock(hashtextextended(ward.institution_id::text,284));
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,285));
 select * into prior from public.inpatient_admissions a where a.created_by=auth.uid() and a.request_id=admit_inpatient.request_id;
 if prior.id is not null then if prior.patient_id is distinct from patient_id or prior.reason is distinct from trim(reason) or prior.initial_bed_id is distinct from bed_id then raise exception 'Request changed' using errcode='40001';end if;return prior.id;end if;
 select * into bed from public.inpatient_beds where id=admit_inpatient.bed_id;select * into ward from public.inpatient_wards where id=bed.ward_id;
 if not bed.active or not ward.active then raise exception 'Bed unavailable';end if;
 insert into public.inpatient_admissions(patient_id,doctor_id,institution_id,bed_id,initial_bed_id,reason,request_id,created_by) values(patient_id,did,ward.institution_id,bed.id,bed.id,trim(reason),request_id,auth.uid()) returning id into rid;
 insert into public.inpatient_movements(admission_id,kind,to_bed,reason,created_by,author_name) values(rid,'ADMITTED',ward.name||' / '||bed.label,trim(reason),auth.uid(),private.inpatient_actor_name(ward.institution_id));
 perform private.audit_event('INPATIENT_ADMITTED','inpatient_admissions',rid);return rid;
end $$;
create function public.list_inpatients(patient_filter uuid default null,search_term text default '',include_discharged boolean default false,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if auth.uid() is null or not(private.has_role('DOCTOR') or private.has_role('NURSE')) then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number not between 0 and 10000 or search_term is null or length(search_term)>200 or include_discharged is null then raise exception 'Invalid inpatient filters';end if;
 with filtered as materialized(select a.*,p.first_name||' '||p.last_name patient_name,p.patient_number,w.name ward_name,b.label bed_label,i.name institution_name,private.manage_inpatient(a) can_manage
 from public.inpatient_admissions a join public.patients p on p.id=a.patient_id join public.inpatient_beds b on b.id=a.bed_id join public.inpatient_wards w on w.id=b.ward_id join public.institutions i on i.id=a.institution_id
 where private.read_inpatient(a) and (patient_filter is null or a.patient_id=patient_filter) and (include_discharged or a.status='ADMITTED') and (trim(search_term)='' or position(lower(trim(search_term)) in lower(concat_ws(' ',p.first_name,p.last_name,p.patient_number,w.name,b.label)))>0)),paged as(select * from filtered order by admitted_at desc,id limit 50 offset page_number*50)
 select jsonb_build_object('total',(select count(*) from filtered),'items',(select coalesce(jsonb_agg(p order by p.admitted_at desc,p.id),'[]') from paged p)) into result;
 perform private.audit_event('INPATIENT_LIST_VIEWED','patients',patient_filter);return result;
end $$;
create function public.inpatient_details(admission_id uuid,notes_page integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare a public.inpatient_admissions;result jsonb;begin
 select * into a from public.inpatient_admissions where id=admission_id;
 if a.id is null or not private.read_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 if notes_page is null or notes_page not between 0 and 10000 then raise exception 'Invalid notes page';end if;
 select jsonb_build_object('admission',to_jsonb(a),'can_manage',private.manage_inpatient(a),'can_doctor_note',private.read_inpatient(a) and private.has_role('DOCTOR',a.institution_id),'can_nurse',private.has_role('NURSE',a.institution_id) and exists(select 1 from public.patient_staff s where s.patient_id=a.patient_id and s.user_id=auth.uid() and s.institution_id=a.institution_id and s.revoked_at is null),
 'notes_total',(select count(*) from public.inpatient_notes n where n.admission_id=a.id),'notes',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('author',x.author_name,'can_correct',x.created_by=auth.uid() and x.superseded_by is null) order by x.created_at desc,x.id),'[]') from(select * from public.inpatient_notes n where n.admission_id=a.id order by n.created_at desc,n.id limit 50 offset notes_page*50)x join public.profiles p on p.id=x.created_by),
 'movements',(select coalesce(jsonb_agg(to_jsonb(m)||jsonb_build_object('author',m.author_name) order by m.created_at,m.id),'[]') from public.inpatient_movements m join public.profiles p on p.id=m.created_by where m.admission_id=a.id),
 'discharge_reports',case when private.manage_inpatient(a) then (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'number',r.number,'reported_on',r.reported_on) order by r.created_at desc),'[]') from public.medical_reports r where r.patient_id=a.patient_id and r.inpatient_admission_id=a.id and r.report_type='DISCHARGE' and r.superseded_by is null and r.created_at>=a.admitted_at and r.reported_on>=(a.admitted_at at time zone 'Europe/Zagreb')::date) else '[]'::jsonb end) into result;
 perform private.audit_event('INPATIENT_DETAILS_VIEWED','inpatient_admissions',a.id);return result;
end $$;
create function public.move_inpatient(admission_id uuid,bed_id uuid,expected_version integer,reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.inpatient_admissions;b public.inpatient_beds;w public.inpatient_wards;old_label text;
begin
 select * into a from public.inpatient_admissions where id=admission_id;
 if a.id is null or not private.manage_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.institution_id::text,284));select * into a from public.inpatient_admissions where id=admission_id for update;
 if a.version is distinct from expected_version then raise exception 'Admission changed' using errcode='40001';end if;
 select * into b from public.inpatient_beds where id=move_inpatient.bed_id;select * into w from public.inpatient_wards where id=b.ward_id;
 if a.status<>'ADMITTED' or b.id is null or b.id=a.bed_id or not b.active or not w.active or w.institution_id<>a.institution_id or length(trim(coalesce(reason,''))) not between 5 and 1000 then raise exception 'Invalid transfer';end if;
 select ward.name||' / '||bed.label into old_label from public.inpatient_beds bed join public.inpatient_wards ward on ward.id=bed.ward_id where bed.id=a.bed_id;
 update public.inpatient_admissions set bed_id=b.id,version=version+1 where id=a.id;
 insert into public.inpatient_movements(admission_id,kind,from_bed,to_bed,reason,created_by,author_name) values(a.id,'TRANSFERRED',old_label,w.name||' / '||b.label,trim(reason),auth.uid(),private.inpatient_actor_name(a.institution_id));
 perform private.audit_event('INPATIENT_TRANSFERRED','inpatient_admissions',a.id);
end $$;
create function public.add_inpatient_note(admission_id uuid,kind text,content text,request_id uuid,corrects_note_id uuid default null,correction_reason text default '') returns uuid language plpgsql security definer set search_path='' as $$
declare a public.inpatient_admissions;prior public.inpatient_notes;existing public.inpatient_notes;rid uuid;
begin
 select * into a from public.inpatient_admissions where id=admission_id for update;
 if a.id is null or not private.read_inpatient(a) or (kind='PROGRESS' and not private.has_role('DOCTOR',a.institution_id)) or (kind='NURSING' and not(private.has_role('NURSE',a.institution_id) and exists(select 1 from public.patient_staff s where s.patient_id=a.patient_id and s.user_id=auth.uid() and s.institution_id=a.institution_id and s.revoked_at is null))) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null or kind is null or kind not in('PROGRESS','NURSING') then raise exception 'Invalid note';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,286));
 select * into existing from public.inpatient_notes n where n.created_by=auth.uid() and n.request_id=add_inpatient_note.request_id;
 if existing.id is not null then if existing.admission_id is distinct from admission_id or existing.kind is distinct from kind or existing.content is distinct from trim(content) or existing.corrects_note_id is distinct from corrects_note_id or existing.correction_reason is distinct from coalesce(correction_reason,'') then raise exception 'Request changed' using errcode='40001';end if;return existing.id;end if;
 if corrects_note_id is not null then select * into prior from public.inpatient_notes n where n.id=add_inpatient_note.corrects_note_id for update;
 if prior.id is null or prior.admission_id<>a.id or prior.created_by<>auth.uid() or prior.kind<>kind or prior.superseded_by is not null or length(trim(coalesce(correction_reason,''))) not between 5 and 1000 then raise exception 'Invalid note correction';end if;
 elsif a.status<>'ADMITTED' then raise exception 'Admission is closed';end if;
 insert into public.inpatient_notes(admission_id,kind,content,corrects_note_id,correction_reason,created_by,request_id,author_name) values(a.id,kind,trim(content),corrects_note_id,coalesce(correction_reason,''),auth.uid(),request_id,private.inpatient_actor_name(a.institution_id,kind='PROGRESS')) returning id into rid;
 if prior.id is not null then update public.inpatient_notes set superseded_by=rid where id=prior.id;end if;
 perform private.audit_event('INPATIENT_NOTE_CREATED','inpatient_notes',rid);return rid;
end $$;
create function public.discharge_inpatient(admission_id uuid,expected_version integer,report_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.inpatient_admissions;r public.medical_reports;bed_label text;
begin
 select * into a from public.inpatient_admissions where id=admission_id;
 if a.id is null or not private.manage_inpatient(a) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.institution_id::text,284));select * into a from public.inpatient_admissions where id=admission_id for update;
 if a.version is distinct from expected_version then raise exception 'Admission changed' using errcode='40001';end if;
 select * into r from public.medical_reports where id=report_id;
 if a.status<>'ADMITTED' or r.id is null or r.patient_id<>a.patient_id or r.inpatient_admission_id is distinct from a.id or r.institution_id<>a.institution_id or r.report_type<>'DISCHARGE' or r.superseded_by is not null or r.created_at<a.admitted_at or r.reported_on<(a.admitted_at at time zone 'Europe/Zagreb')::date then raise exception 'Current discharge report for this admission required';end if;
 select w.name||' / '||b.label into bed_label from public.inpatient_beds b join public.inpatient_wards w on w.id=b.ward_id where b.id=a.bed_id;
 update public.inpatient_admissions set status='DISCHARGED',discharged_at=now(),discharge_report_id=r.id,version=version+1 where id=a.id;
 insert into public.inpatient_movements(admission_id,kind,from_bed,created_by,author_name) values(a.id,'DISCHARGED',bed_label,auth.uid(),private.inpatient_actor_name(a.institution_id));
 perform private.audit_event('INPATIENT_DISCHARGED','inpatient_admissions',a.id);
end $$;
create function private.inpatient_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;org uuid;
begin
 if tg_table_name='inpatient_notes' then select a.patient_id,a.institution_id into pid,org from public.inpatient_admissions a where a.id=new.admission_id;
 else pid:=new.patient_id;org:=new.institution_id;end if;
 insert into public.schedule_events(user_id,revision)
 select distinct people.user_id,gen_random_uuid() from (
  select d.user_id from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.institution_users u on u.user_id=d.user_id and u.institution_id=d.institution_id join public.user_roles r on r.user_id=d.user_id and r.institution_id=d.institution_id and r.role='DOCTOR' where pd.patient_id=pid and pd.revoked_at is null and d.active and u.active
  union
  select ps.user_id from public.patient_staff ps join public.institution_users u on u.user_id=ps.user_id and u.institution_id=ps.institution_id join public.user_roles r on r.user_id=ps.user_id and r.institution_id=ps.institution_id and r.role='NURSE' where ps.patient_id=pid and ps.institution_id=org and ps.revoked_at is null and u.active
 )people on conflict(user_id) do update set revision=excluded.revision;
 return new;
end $$;
create trigger inpatient_revision after insert or update on public.inpatient_admissions for each row execute function private.inpatient_revision();
create trigger inpatient_note_revision after insert or update on public.inpatient_notes for each row execute function private.inpatient_revision();
revoke all on function private.inpatient_revision() from public,anon,authenticated;

-- Explicit episode binding chooses the authenticated hospital physician profile.
do $$declare definition text;begin
 select pg_get_functiondef('public.publish_medical_report(uuid,uuid,uuid,jsonb,uuid)'::regprocedure) into definition;
 if position('if did is null then' in definition)=0 or position('report_type,reported_on,diagnosis' in definition)=0 then raise exception 'Medical report episode anchors missing';end if;
 definition:=replace(definition,'if did is null then',
 'if data->>''admission_id'' is not null then
 if booking_id is not null or not exists(select 1 from public.inpatient_admissions a where a.id=(data->>''admission_id'')::uuid and a.patient_id=publish_medical_report.patient_id and private.manage_inpatient(a)) then raise exception ''Forbidden'' using errcode=''42501'';end if;
 select hospital_doctor.id into did from public.doctors hospital_doctor join public.inpatient_admissions a on a.institution_id=hospital_doctor.institution_id where a.id=(data->>''admission_id'')::uuid and hospital_doctor.user_id=auth.uid() and hospital_doctor.active and private.has_role(''DOCTOR'',hospital_doctor.institution_id);
 end if; if did is null then');
 definition:=replace(definition,'if (data->>''reported_on'')::date','if previous_id is not null and prior.inpatient_admission_id is distinct from (data->>''admission_id'')::uuid then raise exception ''Invalid report correction episode'';end if; if (data->>''reported_on'')::date');
 definition:=replace(definition,'::date>current_date','::date>(now() at time zone ''Europe/Zagreb'')::date');
 definition:=replace(definition,'::date<current_date-3650','::date<(now() at time zone ''Europe/Zagreb'')::date-3650');
 definition:=replace(definition,'report_type,reported_on,diagnosis','inpatient_admission_id,report_type,reported_on,diagnosis');
 definition:=replace(definition,'booking_id,data->>''report_type''','booking_id,(data->>''admission_id'')::uuid,data->>''report_type''');
 execute definition;
end $$;

-- Show hospital stays in the same care overview without exposing internal notes there.
alter table public.care_followups drop constraint care_followups_source_kind_check;
alter table public.care_followups add constraint care_followups_source_kind_check check(source_kind in('BOOKING','REFERRAL','LAB_ORDER','LAB_RESULT','MEDICAL_REPORT','INPATIENT'));
do $$declare definition text;anchor text:=E' union all\n select ''FOLLOWUP''';begin
 select pg_get_functiondef('public.care_pathways(uuid,text,text,boolean,integer)'::regprocedure) into definition;
 if position(anchor in definition)=0 then raise exception 'Care pathway union anchor missing';end if;
 definition:=replace(definition,'''WAITING_BOOKING'',''WAITING_VISIT''','''HOSPITALIZED'',''WAITING_BOOKING'',''WAITING_VISIT''');
 definition:=replace(definition,'''critical'',p.result_kind','''can_inpatient_details'',case when p.source_kind=''INPATIENT'' then (select private.read_inpatient(a) from public.inpatient_admissions a where a.id=p.source_id) else false end,''critical'',p.result_kind');
 definition:=replace(definition,anchor,E' union all\n select ''INPATIENT'',a.id,c.id,c.patient_name,c.patient_number,''Bolnički prijam'',i.name,a.admitted_at,null,case when a.status=''ADMITTED'' then ''HOSPITALIZED'' else ''CLOSED'' end,null,null,a.version,null from public.inpatient_admissions a join care c on c.id=a.patient_id join public.institutions i on i.id=a.institution_id\n'||anchor);execute definition;
 select pg_get_functiondef('public.create_care_followup(uuid,date,text,uuid,text,uuid)'::regprocedure) into definition;
 if position('when ''BOOKING'' then' in definition)=0 then raise exception 'Follow-up source anchor missing';end if;
 definition:=replace(definition,'when ''BOOKING'' then','when ''INPATIENT'' then select a.patient_id into source_patient from public.inpatient_admissions a where a.id=source_id; when ''BOOKING'' then');execute definition;
end $$;

revoke all on function private.read_inpatient(public.inpatient_admissions),private.manage_inpatient(public.inpatient_admissions),private.preserve_inpatient_note(),private.preserve_inpatient_admission() from public,anon,authenticated;
revoke all on function public.inpatient_context(),public.save_inpatient_ward(uuid,uuid,text,boolean),public.save_inpatient_bed(uuid,uuid,text,boolean),public.admit_inpatient(uuid,uuid,text,uuid),public.list_inpatients(uuid,text,boolean,integer),public.inpatient_details(uuid,integer),public.move_inpatient(uuid,uuid,integer,text),public.add_inpatient_note(uuid,text,text,uuid,uuid,text),public.discharge_inpatient(uuid,integer,uuid) from public,anon;
grant execute on function public.inpatient_context(),public.save_inpatient_ward(uuid,uuid,text,boolean),public.save_inpatient_bed(uuid,uuid,text,boolean),public.admit_inpatient(uuid,uuid,text,uuid),public.list_inpatients(uuid,text,boolean,integer),public.inpatient_details(uuid,integer),public.move_inpatient(uuid,uuid,integer,text),public.add_inpatient_note(uuid,text,text,uuid,uuid,text),public.discharge_inpatient(uuid,integer,uuid) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 2026102804$$;
notify pgrst,'reload schema';
commit;

begin;
alter table public.doctors add column messaging_enabled boolean not null default false;
alter table public.patient_medications add column renewal_allowed boolean not null default false;
create table public.messages(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),sender_id uuid not null references public.profiles(id),body text not null check(length(trim(body)) between 1 and 4000),request_id uuid not null,created_at timestamptz not null default now(),unique(sender_id,request_id));
create index messages_thread_idx on public.messages(patient_id,doctor_id,created_at desc);
create table public.medication_renewals(id uuid primary key default gen_random_uuid(),therapy_id uuid not null references public.patient_medications(id),patient_id uuid not null references public.patients(id),note text not null default '' check(length(note)<=1000),status text not null default 'PENDING' check(status in ('PENDING','APPROVED','DECLINED')),response text,document_id uuid references public.documents(id),resolved_by uuid references public.profiles(id),resolved_at timestamptz,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now());
create unique index renewal_one_pending on public.medication_renewals(therapy_id) where status='PENDING';
do $$declare t text;begin foreach t in array array['messages','medication_renewals'] loop execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);execute format('create trigger audit_change after insert or update on public.%I for each row execute function private.audit_change()',t);end loop;end $$;
create trigger immutable_message before update on public.messages for each row execute function private.no_clinical_delete();
create function private.can_message(pid uuid,did uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.patients p on p.id=pd.patient_id join public.institution_users iu on iu.user_id=d.user_id and iu.institution_id=d.institution_id join public.user_roles r on r.user_id=d.user_id and r.institution_id=d.institution_id and r.role='DOCTOR' where pd.patient_id=pid and d.id=did and pd.revoked_at is null and d.active and iu.active and p.archived_at is null and ((p.user_id=auth.uid() and private.has_role('PATIENT')) or (d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id))))$$;
create function public.set_messaging_enabled(doctor_id uuid,enabled boolean) returns void language plpgsql security definer set search_path='' as $$begin
 if not exists(select 1 from public.doctors d where d.id=doctor_id and d.user_id=auth.uid() and d.active and private.has_role('DOCTOR',d.institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 update public.doctors set messaging_enabled=enabled where id=doctor_id;perform private.audit_event('MESSAGING_PREFERENCE_CHANGED','doctors',doctor_id);end $$;
create function public.message_threads(personal boolean,search_term text default '') returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if personal is null or not (case when personal then private.has_role('PATIENT') else private.has_role('DOCTOR') end) then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(x),'[]') into result from(select p.id patient_id,d.id doctor_id,p.first_name||' '||p.last_name patient_name,d.display_name doctor_name,d.messaging_enabled,
 (select max(m.created_at) from public.messages m where m.patient_id=p.id and m.doctor_id=d.id) last_message_at
 from public.patient_doctors pd join public.patients p on p.id=pd.patient_id join public.doctors d on d.id=pd.doctor_id where private.can_message(p.id,d.id) and pd.revoked_at is null and (case when personal then p.user_id=auth.uid() else d.user_id=auth.uid() end) and concat_ws(' ',p.first_name,p.last_name,d.display_name) ilike '%'||left(coalesce(search_term,''),100)||'%' order by last_message_at desc nulls last,p.last_name limit 100)x;
 perform private.audit_event('MESSAGE_THREADS_VIEWED','messages',null);return result;end $$;
create function public.read_messages(patient_id uuid,doctor_id uuid,before_time timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if not private.can_message(patient_id,doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(x order by x.created_at),'[]') into result from(select m.id,m.body,m.created_at,m.sender_id=auth.uid() own from public.messages m where m.patient_id=read_messages.patient_id and m.doctor_id=read_messages.doctor_id and (before_time is null or m.created_at<before_time) order by m.created_at desc,m.id limit 100)x;
 perform private.audit_event('MESSAGES_VIEWED','patients',patient_id);return result;end $$;
create function public.send_patient_message(patient_id uuid,doctor_id uuid,body text,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$declare recipient uuid;mid uuid;prior public.messages;begin
 if not private.can_message(patient_id,doctor_id) or not exists(select 1 from public.doctors d where d.id=doctor_id and d.messaging_enabled) then raise exception 'Communication unavailable' using errcode='42501';end if;
 if request_id is null or length(trim(coalesce(body,''))) not between 1 and 4000 then raise exception 'Message required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,81));select * into prior from public.messages m where m.sender_id=auth.uid() and m.request_id=send_patient_message.request_id;
 if prior.id is not null then if prior.patient_id<>patient_id or prior.doctor_id<>doctor_id or prior.body<>trim(body) then raise exception 'Request reused';end if;return prior.id;end if;
 insert into public.messages(patient_id,doctor_id,sender_id,body,request_id) values(patient_id,doctor_id,auth.uid(),trim(body),request_id) returning id into mid;
 select case when d.user_id=auth.uid() then p.user_id else d.user_id end into recipient from public.doctors d cross join public.patients p where d.id=doctor_id and p.id=patient_id;
 if recipient is not null then insert into public.notifications(user_id,message) values(recipient,'Primljena je nova poruka u komunikaciji.');end if;
 perform private.audit_event('MESSAGE_SENT','patients',patient_id);return mid;end $$;
create function public.set_renewal_allowed(therapy_id uuid,allowed boolean) returns void language plpgsql security definer set search_path='' as $$declare pid uuid;begin select patient_id into pid from public.patient_medications where id=therapy_id;
 if private.treating_doctor(pid) is null then raise exception 'Forbidden' using errcode='42501';end if;
 update public.patient_medications set renewal_allowed=allowed where id=therapy_id;perform private.audit_event('RENEWAL_PERMISSION_CHANGED','patients',pid);end $$;
create function public.renewal_overview(personal boolean,patient_filter uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;begin
 if personal is null or not (case when personal then private.has_role('PATIENT') else private.has_role('DOCTOR') end) then raise exception 'Forbidden' using errcode='42501';end if;
 select jsonb_build_object('therapies',(select coalesce(jsonb_agg(x),'[]') from(select pm.id,pm.patient_id,pm.medication_id,m.name,m.strength,m.route,pm.dosage,pm.frequency,pm.renewal_allowed,pm.status,pm.end_date,p.first_name||' '||p.last_name patient_name from public.patient_medications pm join public.medications m on m.id=pm.medication_id join public.patients p on p.id=pm.patient_id where (patient_filter is null or pm.patient_id=patient_filter) and case when personal then p.user_id=auth.uid() else private.treating_doctor(p.id) is not null end order by pm.created_at desc limit 100)x),
 'requests',(select coalesce(jsonb_agg(x),'[]') from(select r.*,m.name medication_name,p.first_name||' '||p.last_name patient_name from public.medication_renewals r join public.patient_medications pm on pm.id=r.therapy_id join public.medications m on m.id=pm.medication_id join public.patients p on p.id=r.patient_id where (patient_filter is null or r.patient_id=patient_filter) and case when personal then p.user_id=auth.uid() else private.treating_doctor(p.id) is not null end order by r.created_at desc limit 100)x)) into result;
 perform private.audit_event('RENEWALS_VIEWED','patients',patient_filter);return result;end $$;
create function public.request_medication_renewal(therapy_id uuid,note text default '') returns uuid language plpgsql security definer set search_path='' as $$declare t public.patient_medications;rid uuid;begin
 select * into t from public.patient_medications where id=therapy_id for update;
 if not private.has_role('PATIENT') or not exists(select 1 from public.patients p where p.id=t.patient_id and p.user_id=auth.uid() and p.archived_at is null) then raise exception 'Forbidden' using errcode='42501';end if;
 if not t.renewal_allowed or t.status<>'ACTIVE' or t.start_date>current_date or (t.end_date is not null and t.end_date<current_date) then raise exception 'Renewal not permitted';end if;
 if not exists(select 1 from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=t.patient_id and pd.revoked_at is null and d.active) then raise exception 'No care doctor';end if;
 select id into rid from public.medication_renewals r where r.therapy_id=request_medication_renewal.therapy_id and r.status='PENDING';if rid is not null then return rid;end if;
 insert into public.medication_renewals(therapy_id,patient_id,note,created_by) values(therapy_id,t.patient_id,left(coalesce(note,''),1000),auth.uid()) returning id into rid;
 insert into public.notifications(user_id,message) select d.user_id,'Zaprimljen je zahtjev za obnovu terapije.' from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=t.patient_id and pd.revoked_at is null and d.active;
 perform private.audit_event('RENEWAL_REQUESTED','patients',t.patient_id);return rid;end $$;
create function public.resolve_medication_renewal(renewal_id uuid,approve boolean,response text,prescription_data jsonb default null) returns uuid language plpgsql security definer set search_path='' as $$declare r public.medication_renewals;t public.patient_medications;document uuid;begin
 select * into r from public.medication_renewals where id=renewal_id for update;
 if r.id is null or private.treating_doctor(r.patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if r.status<>'PENDING' or approve is null then raise exception 'Request already resolved';end if;
 select * into t from public.patient_medications where id=r.therapy_id for update;
 if approve then
 if not t.renewal_allowed or t.status<>'ACTIVE' or (t.end_date is not null and t.end_date<current_date) or jsonb_array_length(prescription_data->'items') is distinct from 1 or (prescription_data->'items'->0->>'medication_id')::uuid is distinct from t.medication_id then raise exception 'Invalid renewal prescription';end if;
 document:=public.issue_document(r.patient_id,'PRESCRIPTION',prescription_data,r.id);
 elsif length(trim(coalesce(response,''))) not between 5 and 1000 then raise exception 'Reason required';end if;
 update public.medication_renewals set status=case when approve then 'APPROVED' else 'DECLINED' end,response=left(coalesce(resolve_medication_renewal.response,''),1000),document_id=document,resolved_by=auth.uid(),resolved_at=now() where id=renewal_id;
 insert into public.notifications(user_id,message) select p.user_id,case when approve then 'Odobrena je obnova terapije i izdan novi recept.' else 'Liječnik je odgovorio na zahtjev za obnovu terapije.' end from public.patients p where p.id=r.patient_id and p.user_id is not null;
 perform private.audit_event('RENEWAL_RESOLVED','patients',r.patient_id);return document;end $$;
revoke all on function private.can_message(uuid,uuid) from public,anon,authenticated;
revoke all on function public.set_messaging_enabled(uuid,boolean),public.message_threads(boolean,text),public.read_messages(uuid,uuid,timestamptz),public.send_patient_message(uuid,uuid,text,uuid),public.set_renewal_allowed(uuid,boolean),public.renewal_overview(boolean,uuid),public.request_medication_renewal(uuid,text),public.resolve_medication_renewal(uuid,boolean,text,jsonb) from public,anon;
grant execute on function public.set_messaging_enabled(uuid,boolean),public.message_threads(boolean,text),public.read_messages(uuid,uuid,timestamptz),public.send_patient_message(uuid,uuid,text,uuid),public.set_renewal_allowed(uuid,boolean),public.renewal_overview(boolean,uuid),public.request_medication_renewal(uuid,text),public.resolve_medication_renewal(uuid,boolean,text,jsonb) to authenticated;
commit;



begin;
create table private.document_counters(kind text not null,year integer not null,value bigint not null,primary key(kind,year));
create table public.documents(
 id uuid primary key default gen_random_uuid(),request_id uuid not null,patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),institution_id uuid not null references public.institutions(id),
 kind text not null check(kind in ('PRESCRIPTION','REFERRAL','SCHOOL_EXCUSE')),number text not null unique,
 status text not null check(status in ('DRAFT','ISSUED','VALID','DISPENSED','CANCELLED','REVOKED','EXPIRED','BOOKED','IN_PROGRESS','COMPLETED')),
 issued_at timestamptz not null default now(),expires_on date not null,payload jsonb not null,revoked_at timestamptz,revocation_reason text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),unique(created_by,request_id)
);
create table public.prescriptions(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),encounter_id uuid references public.medical_encounters(id),created_at timestamptz not null default now(),created_by uuid references public.profiles(id));
create table public.prescription_items(id uuid primary key default gen_random_uuid(),prescription_id uuid not null references public.prescriptions(id),medication_id uuid not null references public.medications(id),dosage text not null check(length(trim(dosage)) between 1 and 500),quantity integer not null check(quantity between 1 and 999),route text not null check(length(trim(route)) between 1 and 200),duration text not null check(length(trim(duration)) between 1 and 300),notes text not null default '',created_at timestamptz not null default now());
create table public.referrals(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),encounter_id uuid references public.medical_encounters(id),referral_type text not null check(referral_type in ('SPECIALIST','LABORATORY','DIAGNOSTICS','HOSPITAL','FOLLOW_UP','PHYSICAL_THERAPY','OTHER')),specialty text not null check(length(trim(specialty)) between 1 and 200),reason text not null check(length(trim(reason)) between 1 and 4000),diagnosis_id uuid references public.diagnoses(id),priority text not null check(priority in ('REGULAR','URGENT')),notes text not null default '',created_at timestamptz not null default now(),created_by uuid references public.profiles(id));
create table public.school_excuses(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),encounter_id uuid references public.medical_encounters(id),date_from date not null,date_to date not null,category text not null check(length(trim(category)) between 1 and 200),school text,notes text not null default '',created_at timestamptz not null default now(),created_by uuid references public.profiles(id),check(date_to>=date_from and date_to-date_from<=365));
create table public.digital_signatures(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),signed_by uuid not null references public.profiles(id),signed_at timestamptz not null default now(),signature_hash text not null,signature_method text not null default 'DEMO_SHA256',certificate_name text not null default 'e-Zdravstvo razvojna potvrda',status text not null default 'VALID' check(status in ('VALID','REVOKED')),created_at timestamptz not null default now());
create table public.document_verifications(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),created_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id),document_id uuid references public.documents(id),message text not null,read_at timestamptz,created_at timestamptz not null default now());
create index documents_patient_idx on public.documents(patient_id,issued_at desc);
create index documents_doctor_idx on public.documents(doctor_id,issued_at desc);
create index prescription_items_parent_idx on public.prescription_items(prescription_id);
create index notifications_user_idx on public.notifications(user_id,created_at desc);
do $$ declare t text;begin foreach t in array array['documents','prescriptions','prescription_items','referrals','school_excuses','digital_signatures','document_verifications','notifications'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
end loop;end $$;
create policy document_read on public.documents for select to authenticated using(private.can_read_patient(patient_id));
create policy notification_read on public.notifications for select to authenticated using(user_id=auth.uid() and private.has_role('PATIENT'));
grant select on public.notifications to authenticated;
create trigger updated_at before update on public.documents for each row execute function private.touch_updated_at();
create function private.preserve_document() returns trigger language plpgsql set search_path='' as $$
begin if(to_jsonb(new)-'status'-'revoked_at'-'revocation_reason'-'updated_at') is distinct from(to_jsonb(old)-'status'-'revoked_at'-'revocation_reason'-'updated_at') then raise exception 'Issued document content is immutable';end if;return new;end $$;
create trigger preserve_content before update on public.documents for each row execute function private.preserve_document();
create function private.next_document_number(doc_kind text) returns text language plpgsql security definer set search_path='' as $$
declare y integer:=extract(year from now());n bigint;prefix text;begin
 prefix:=case doc_kind when 'PRESCRIPTION' then 'REC' when 'REFERRAL' then 'UPU' when 'SCHOOL_EXCUSE' then 'ISP' else null end;
 if prefix is null then raise exception 'Unknown document kind';end if;
 insert into private.document_counters(kind,year,value) values(doc_kind,y,1) on conflict(kind,year) do update set value=document_counters.value+1 returning value into n;
 if n>99999999 then raise exception 'Document number range exhausted';end if;
 return 'EZ-'||prefix||'-'||y||'-'||lpad(n::text,8,'0');end $$;
create function private.document_status(d public.documents) returns text language sql stable set search_path='' as $$
 select case when d.status in ('REVOKED','CANCELLED','DISPENSED','COMPLETED') then d.status when d.expires_on<current_date then 'EXPIRED' else d.status end;
$$;
create function private.document_card(d public.documents) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'patient_id',d.patient_id,'kind',d.kind,'number',d.number,'status',private.document_status(d),'issued_at',d.issued_at,'expires_on',d.expires_on,'payload',d.payload,'revocation_reason',d.revocation_reason,
 'can_revoke',d.created_by=auth.uid() and private.treating_doctor(d.patient_id) is not null and private.document_status(d) in ('ISSUED','VALID'),
 'verification_token',(select v.id from public.document_verifications v where v.document_id=d.id),
 'signature',(select jsonb_build_object('signed_at',s.signed_at,'signature_hash',s.signature_hash,'signature_method',s.signature_method,'certificate_name',s.certificate_name,'status',s.status,'integrity_valid',s.signature_hash=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex')) from public.digital_signatures s where s.document_id=d.id));
$$;
create function public.issue_document(patient_id uuid,document_kind text,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);doc_id uuid;existing public.documents;p public.patients;dr public.doctors;i public.institutions;doc_number text;expires date:=(data->>'expires_on')::date;enc uuid:=nullif(data->>'encounter_id','')::uuid;details jsonb;item jsonb;med public.medications;med_items jsonb:='[]';prescription_id uuid;payload jsonb;issued timestamptz:=now();
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 -- Serialize retries for a single issuer request key, including simultaneous clicks.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into existing from public.documents d where d.created_by=auth.uid() and d.request_id=issue_document.request_id;
 if existing.id is not null then if existing.patient_id<>patient_id or existing.kind<>document_kind then raise exception 'Request key already used';end if;return existing.id;end if;
 if expires is null or expires<current_date or expires>current_date+730 then raise exception 'Invalid expiry date';end if;
 if enc is not null and not exists(select 1 from public.medical_encounters e where e.id=enc and e.patient_id=issue_document.patient_id and e.superseded_by is null) then raise exception 'Invalid encounter reference';end if;
 select * into p from public.patients where id=patient_id;select * into dr from public.doctors where id=did;select * into i from public.institutions where id=dr.institution_id;
 doc_number:=private.next_document_number(document_kind);
 if document_kind='PRESCRIPTION' then
 if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 20 then raise exception 'Prescription requires 1 to 20 items';end if;
 for item in select * from jsonb_array_elements(data->'items') loop
 select * into med from public.medications where id=(item->>'medication_id')::uuid and active;
 if med.id is null then raise exception 'Invalid medication';end if;
 med_items:=med_items||jsonb_build_array(jsonb_build_object('medication_id',med.id,'name',med.name,'active_ingredient',med.active_ingredient,'strength',med.strength,'form',med.form,'packaging',med.packaging,'dosage',left(item->>'dosage',500),'quantity',(item->>'quantity')::integer,'route',left(item->>'route',200),'duration',left(item->>'duration',300),'notes',left(coalesce(item->>'notes',''),2000)));
 end loop;
 details:=jsonb_build_object('items',med_items);
 elsif document_kind='REFERRAL' then
 details:=jsonb_build_object('referral_type',data->>'referral_type','specialty',left(data->>'specialty',200),'reason',left(data->>'reason',4000),'diagnosis_id',nullif(data->>'diagnosis_id',''),'diagnosis',(select code||' · '||name from public.diagnoses where id=nullif(data->>'diagnosis_id','')::uuid),'priority',data->>'priority','notes',left(coalesce(data->>'notes',''),4000));
 elsif document_kind='SCHOOL_EXCUSE' then
 if (data->>'date_from')::date<p.birth_date then raise exception 'Invalid absence dates';end if;
 details:=jsonb_build_object('date_from',data->>'date_from','date_to',data->>'date_to','category',left(data->>'category',200),'school',left(coalesce(data->>'school',''),300),'notes',left(coalesce(data->>'notes',''),4000));
 else raise exception 'Unsupported document kind';end if;
 payload:=jsonb_build_object('number',doc_number,'kind',document_kind,'issued_at',issued,'expires_on',expires,'patient',jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'birth_date',p.birth_date,'patient_number',p.patient_number),'doctor',dr.display_name,'institution',i.name,'institution_address',concat_ws(', ',i.address,i.city),'details',details,'signature_disclaimer','Razvojni digitalni potpis – nije kvalificirani elektronički potpis.');
 insert into public.documents(request_id,patient_id,doctor_id,institution_id,kind,number,status,issued_at,expires_on,payload,created_by) values(request_id,patient_id,did,i.id,document_kind,doc_number,case when document_kind='SCHOOL_EXCUSE' then 'VALID' else 'ISSUED' end,issued,expires,payload,auth.uid()) returning id into doc_id;
 if document_kind='PRESCRIPTION' then
 insert into public.prescriptions(document_id,encounter_id,created_by) values(doc_id,enc,auth.uid()) returning id into prescription_id;
 for item in select * from jsonb_array_elements(med_items) loop insert into public.prescription_items(prescription_id,medication_id,dosage,quantity,route,duration,notes) values(prescription_id,(item->>'medication_id')::uuid,item->>'dosage',(item->>'quantity')::integer,item->>'route',item->>'duration',item->>'notes');end loop;
 elsif document_kind='REFERRAL' then
 insert into public.referrals(document_id,encounter_id,referral_type,specialty,reason,diagnosis_id,priority,notes,created_by) values(doc_id,enc,details->>'referral_type',details->>'specialty',details->>'reason',nullif(details->>'diagnosis_id','')::uuid,details->>'priority',details->>'notes',auth.uid());
 else
 insert into public.school_excuses(document_id,encounter_id,date_from,date_to,category,school,notes,created_by) values(doc_id,enc,(details->>'date_from')::date,(details->>'date_to')::date,details->>'category',details->>'school',details->>'notes',auth.uid());end if;
 insert into public.digital_signatures(document_id,signed_by,signature_hash) values(doc_id,auth.uid(),encode(sha256(convert_to(payload::text,'UTF8')),'hex'));
 insert into public.document_verifications(document_id) values(doc_id);
 if p.user_id is not null then insert into public.notifications(user_id,document_id,message) values(p.user_id,doc_id,dr.display_name||' izdao/la je '||case document_kind when 'PRESCRIPTION' then 'recept' when 'REFERRAL' then 'uputnicu' else 'ispričnicu' end||' '||doc_number);end if;
 perform private.audit_event(document_kind||'_ISSUED','documents',doc_id);return doc_id;
end $$;
create function public.list_documents(patient_id uuid default null,kind_filter text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if patient_id is not null and not private.can_read_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.document_card(x) order by x.issued_at desc),'[]') into result from (select d.* from public.documents d where private.can_read_patient(d.patient_id) and (list_documents.patient_id is null or d.patient_id=list_documents.patient_id) and (kind_filter is null or d.kind=kind_filter) order by d.issued_at desc limit 100) x;
 perform private.audit_event('DOCUMENT_LIST_VIEWED','documents',patient_id);return result;end $$;
create function public.get_document(document_id uuid,purpose text default 'VIEW') returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;begin select * into d from public.documents where id=document_id;
 if d.id is null or not private.can_read_patient(d.patient_id) or purpose not in ('VIEW','DOWNLOAD') then raise exception 'Forbidden' using errcode='42501';end if;
 perform private.audit_event(case when purpose='DOWNLOAD' then 'DOCUMENT_DOWNLOADED' else 'DOCUMENT_VIEWED' end,'documents',d.id);return private.document_card(d);end $$;
create function public.revoke_document(document_id uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;begin select * into d from public.documents where id=document_id for update;
 if d.id is null or d.created_by<>auth.uid() or private.treating_doctor(d.patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if private.document_status(d) not in ('ISSUED','VALID') or length(trim(reason))<5 then raise exception 'Document cannot be revoked or reason missing';end if;
 update public.documents set status=case when kind='SCHOOL_EXCUSE' then 'REVOKED' else 'CANCELLED' end,revoked_at=now(),revocation_reason=left(reason,2000) where id=document_id;
 update public.digital_signatures s set status='REVOKED' where s.document_id=revoke_document.document_id;
 insert into public.notifications(user_id,document_id,message) select p.user_id,d.id,'Dokument '||d.number||' je opozvan.' from public.patients p where p.id=d.patient_id and p.user_id is not null;
 perform private.audit_event(d.kind||'_CANCELLED','documents',d.id);end $$;
create function public.verify_document(verification_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;valid_hash boolean;code text:=trim(verification_code);begin
 if code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
 select doc.* into d from public.document_verifications v join public.documents doc on doc.id=v.document_id where v.id=code::uuid;
 elsif private.has_role('SCHOOL_ADMIN') and code ~ '^EZ-ISP-[0-9]{4}-[0-9]{8}$' then select * into d from public.documents where number=code and kind='SCHOOL_EXCUSE';
 else return null;end if;
 if d.id is null then return null;end if;
 select s.signature_hash=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex') into valid_hash from public.digital_signatures s where s.document_id=d.id;
 perform private.audit_event('DOCUMENT_VERIFIED','documents',d.id);
 return jsonb_build_object('number',d.number,'kind',d.kind,'issuer',d.payload->>'doctor','institution',d.payload->>'institution','issued_at',d.issued_at,'expires_on',d.expires_on,'status',case when not coalesce(valid_hash,false) then 'INVALID' else private.document_status(d) end,'signature_method','DEMO_SHA256');
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_role(public.app_role,uuid),private.is_member(uuid),private.can_read_patient(uuid) to authenticated;
revoke all on function public.issue_document(uuid,text,jsonb,uuid),public.list_documents(uuid,text),public.get_document(uuid,text),public.revoke_document(uuid,text),public.verify_document(text) from public,anon;
grant execute on function public.issue_document(uuid,text,jsonb,uuid),public.list_documents(uuid,text),public.get_document(uuid,text),public.revoke_document(uuid,text) to authenticated;
grant execute on function public.verify_document(text) to anon,authenticated;
-- Existing Supabase deployments have this publication; local SQL test engines may not.
do $$ begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then alter publication supabase_realtime add table public.notifications;end if;end $$;
commit;

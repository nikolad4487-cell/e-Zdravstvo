begin;
create table public.clinics(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.institutions(id),name text not null check(length(trim(name)) between 2 and 200),
 code text not null check(length(trim(code)) between 1 and 40),address text not null default '' check(length(address)<=300),city text not null default '' check(length(city)<=100),
 phone text not null default '' check(length(phone)<=50),email text not null default '' check(length(email)<=200),active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),unique(institution_id,code),unique(id,institution_id)
);
alter table public.doctors add column doctor_code text not null default '' check(length(doctor_code)<=40),add column clinic_id uuid;
alter table public.doctors add constraint doctor_clinic_institution_fk foreign key(clinic_id,institution_id) references public.clinics(id,institution_id);
create table public.excuse_reasons(id uuid primary key default gen_random_uuid(),code text not null unique check(length(code) between 1 and 40),name text not null check(length(trim(name)) between 2 and 200),active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id));
create table public.excuse_templates(
 id uuid primary key default gen_random_uuid(),institution_id uuid not null references public.institutions(id),excuse_type text not null check(excuse_type in ('REGULAR','PE')),version integer not null check(version>0),
 title text not null check(length(trim(title)) between 2 and 100),body_text text not null check(length(trim(body_text)) between 2 and 300),footer_text text not null default '' check(length(footer_text)<=300),
 font_family text not null check(font_family in ('SERIF','SANS')),font_size integer not null check(font_size between 10 and 13),header_align text not null check(header_align in ('CENTER','LEFT')),
 accent text not null check(accent in ('#16212b','#14566b','#087f8a')),show_separator boolean not null default true,
 created_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),unique(institution_id,excuse_type,version)
);
do $$ declare t text;begin foreach t in array array['clinics','excuse_reasons','excuse_templates'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
end loop;end $$;
create trigger updated_at before update on public.clinics for each row execute function private.touch_updated_at();
create trigger updated_at before update on public.excuse_reasons for each row execute function private.touch_updated_at();
create function private.immutable_template() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Template versions are immutable';end $$;
create trigger immutable before update on public.excuse_templates for each row execute function private.immutable_template();

-- Per-doctor internal MAC keys never leave the database. These are internal
-- electronic confirmations, not qualified certificates or asymmetric signatures.
create table private.doctor_signing_keys(doctor_id uuid primary key references public.doctors(id),secret bytea not null check(octet_length(secret)=32),created_at timestamptz not null default now());
revoke all on private.doctor_signing_keys from public,anon,authenticated,service_role;
create function private.init_doctor_signer() returns trigger language plpgsql security definer set search_path='' as $$ begin
 insert into private.doctor_signing_keys(doctor_id,secret) values(new.id,decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex')) on conflict do nothing;return new;end $$;
create trigger doctor_signer after insert on public.doctors for each row execute function private.init_doctor_signer();
insert into private.doctor_signing_keys(doctor_id,secret) select id,decode(replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),'hex') from public.doctors;
create function private.hmac_sha256(message bytea,key bytea) returns bytea language plpgsql immutable set search_path='' as $$
declare k bytea:=key;ip bytea:=decode(repeat('36',64),'hex');op bytea:=decode(repeat('5c',64),'hex');idx integer;
begin if octet_length(k)>64 then k:=sha256(k);end if;for idx in 0..octet_length(k)-1 loop ip:=set_byte(ip,idx,get_byte(ip,idx)#get_byte(k,idx));op:=set_byte(op,idx,get_byte(op,idx)#get_byte(k,idx));end loop;return sha256(op||sha256(ip||message));end $$;
create function private.signer_fingerprint(did uuid) returns text language sql stable security definer set search_path='' as $$select 'EZ-L-'||upper(substr(encode(sha256(secret),'hex'),1,12)) from private.doctor_signing_keys where doctor_id=did$$;
create function private.sign_document(did uuid,payload jsonb) returns text language sql stable security definer set search_path='' as $$select encode(private.hmac_sha256(convert_to(payload::text,'UTF8'),secret),'hex') from private.doctor_signing_keys where doctor_id=did$$;
create function private.signature_valid(doc_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select case s.signature_method when 'DEMO_SHA256' then s.signature_hash=encode(sha256(convert_to(d.payload::text,'UTF8')),'hex') when 'HMAC_SHA256_INTERNAL' then s.signature_hash=private.sign_document(d.doctor_id,d.payload) else false end from public.documents d join public.digital_signatures s on s.document_id=d.id where d.id=doc_id;
$$;

create function private.excuse_template(org uuid,kind text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce((select to_jsonb(t) from public.excuse_templates t where institution_id=org and excuse_type=kind order by version desc limit 1),jsonb_build_object('id',null,'institution_id',org,'excuse_type',kind,'version',0,'title','ISPRIČNICA za školu','body_text',case kind when 'PE' then 'Molim osloboditi od nastave tjelesne i zdravstvene kulture' else 'Molim opravdati izostanak s redovne nastave' end,'footer_text','','font_family','SERIF','font_size',11,'header_align','CENTER','accent','#16212b','show_separator',true));
$$;
create function public.admin_configuration() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if not(private.has_role('SYSTEM_ADMIN') or exists(select 1 from public.institutions i where private.has_role('INSTITUTION_ADMIN',i.id))) then raise exception 'Forbidden' using errcode='42501';end if;
 select jsonb_build_object('institutions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'code',i.code)) from public.institutions i where private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',i.id)),'[]'),
 'clinics',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.clinics c where private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',c.institution_id)),'[]'),
 'doctors',coalesce((select jsonb_agg(to_jsonb(d)||jsonb_build_object('signer_fingerprint',private.signer_fingerprint(d.id)) order by d.display_name) from public.doctors d where private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',d.institution_id)),'[]'),
 'templates',coalesce((select jsonb_agg(private.excuse_template(i.id,k.kind)) from public.institutions i cross join (values('REGULAR'),('PE')) k(kind) where private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',i.id)),'[]'),
 'reasons',coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from public.excuse_reasons r),'[]'),
 'diagnoses',coalesce((select jsonb_agg(to_jsonb(d) order by d.code) from public.diagnoses d),'[]')) into result;
 perform private.audit_event('ADMIN_CONFIGURATION_VIEWED','institutions',null);return result;
end $$;
create function public.save_clinic(institution_id uuid,clinic_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if clinic_id is null then
 insert into public.clinics(institution_id,name,code,address,city,phone,email,created_by) values(institution_id,trim(data->>'name'),trim(data->>'code'),coalesce(data->>'address',''),coalesce(data->>'city',''),coalesce(data->>'phone',''),coalesce(data->>'email',''),auth.uid()) returning id into cid;
 else
 update public.clinics c set name=trim(data->>'name'),code=trim(data->>'code'),address=coalesce(data->>'address',''),city=coalesce(data->>'city',''),phone=coalesce(data->>'phone',''),email=coalesce(data->>'email',''),active=coalesce((data->>'active')::boolean,true) where c.id=clinic_id and c.institution_id=save_clinic.institution_id returning id into cid;
 if cid is null then raise exception 'Clinic not found';end if;end if;return cid;
end $$;
create function public.save_doctor_identity(doctor_id uuid,data jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d public.doctors;cid uuid:=nullif(data->>'clinic_id','')::uuid;begin
 select * into d from public.doctors where id=doctor_id;
 if d.id is null or not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',d.institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if cid is not null and not exists(select 1 from public.clinics where id=cid and institution_id=d.institution_id and active) then raise exception 'Clinic not available';end if;
 if length(trim(coalesce(data->>'display_name','')))<3 then raise exception 'Doctor name required';end if;
 update public.doctors set display_name=left(trim(data->>'display_name'),200),doctor_code=trim(coalesce(data->>'doctor_code','')),clinic_id=cid,specialty=left(coalesce(data->>'specialty',d.specialty),200) where id=d.id;
end $$;
create function public.save_excuse_template(institution_id uuid,excuse_type text,expected_version integer,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare v integer;result uuid;begin
 if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if excuse_type is null or excuse_type not in ('REGULAR','PE') then raise exception 'Invalid type';end if;
 perform pg_advisory_xact_lock(hashtextextended(institution_id::text||excuse_type,9));
 select coalesce(max(t.version),0) into v from public.excuse_templates t where t.institution_id=save_excuse_template.institution_id and t.excuse_type=save_excuse_template.excuse_type;
 if expected_version is distinct from v then raise exception 'Template changed; reload' using errcode='40001';end if;
 insert into public.excuse_templates(institution_id,excuse_type,version,title,body_text,footer_text,font_family,font_size,header_align,accent,show_separator,created_by) values(institution_id,excuse_type,v+1,trim(data->>'title'),trim(data->>'body_text'),coalesce(data->>'footer_text',''),data->>'font_family',(data->>'font_size')::int,data->>'header_align',data->>'accent',coalesce((data->>'show_separator')::boolean,true),auth.uid()) returning id into result;return result;
end $$;
create function public.save_excuse_catalog(catalog text,entry_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if catalog='reason' then
 if entry_id is null then insert into public.excuse_reasons(code,name,created_by) values(upper(trim(data->>'code')),trim(data->>'name'),auth.uid()) returning id into result;
 else update public.excuse_reasons set name=trim(data->>'name'),active=coalesce((data->>'active')::boolean,true) where id=entry_id returning id into result;end if;
 elsif catalog='diagnosis' then
 if entry_id is null then insert into public.diagnoses(code,name,coding_system) values(upper(trim(data->>'code')),trim(data->>'name'),coalesce(nullif(data->>'coding_system',''),'LOCAL')) returning id into result;
 else update public.diagnoses set name=trim(data->>'name'),active=coalesce((data->>'active')::boolean,true) where id=entry_id returning id into result;end if;
 else raise exception 'Invalid catalog';end if;if result is null then raise exception 'Entry not found';end if;return result;
end $$;
create function public.central_overview() returns jsonb language plpgsql security definer set search_path='' as $$
begin if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 perform private.audit_event('CENTRAL_DASHBOARD_VIEWED','system',null);
 return jsonb_build_object('institutions',(select count(*) from public.institutions where active),'users',(select count(*) from public.profiles),'doctors',(select count(*) from public.doctors where active),'patients',(select count(*) from public.patients where archived_at is null),'encounters_today',(select count(*) from public.medical_encounters where encountered_at>=(now() at time zone 'Europe/Zagreb')::date::timestamp at time zone 'Europe/Zagreb'),'prescriptions',(select count(*) from public.documents where kind='PRESCRIPTION'),'referrals',(select count(*) from public.documents where kind='REFERRAL'),'audit_today',(select count(*) from public.audit_logs where created_at>=current_date),'active_users_7d',(select count(distinct user_id) from public.audit_logs where created_at>now()-interval '7 days'));
end $$;
create function public.admin_users(search_term text default '',page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number<0 or page_number>10000 then raise exception 'Invalid page';end if;
 select coalesce(jsonb_agg(x),'[]') into result from(select p.id,p.first_name,p.last_name,p.is_demo,u.email,
 (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'role',r.role,'institution_id',r.institution_id,'institution_name',i.name)),'[]') from public.user_roles r left join public.institutions i on i.id=r.institution_id where r.user_id=p.id) roles
 from public.profiles p join auth.users u on u.id=p.id where concat_ws(' ',p.first_name,p.last_name,u.email) ilike '%'||left(search_term,100)||'%' order by p.last_name,p.id limit 50 offset page_number*50)x;
 perform private.audit_event('ADMIN_USERS_VIEWED','profiles',null);return result;
end $$;
create function public.admin_grant_role(target_user uuid,requested public.app_role,target_institution uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if target_institution is not null then perform public.set_membership(target_user,target_institution,true);end if;
 perform public.assign_role(target_user,requested,target_institution);
end $$;
insert into public.excuse_reasons(code,name) values('ILLNESS','Bolest'),('EXAMINATION','Liječnički pregled'),('RECOVERY','Oporavak nakon bolesti ili zahvata'),('INJURY','Ozljeda'),('OTHER','Drugi zdravstveni razlog') on conflict do nothing;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_role(public.app_role,uuid),private.is_member(uuid),private.can_read_patient(uuid) to authenticated;
revoke all on function public.admin_configuration(),public.save_clinic(uuid,uuid,jsonb),public.save_doctor_identity(uuid,jsonb),public.save_excuse_template(uuid,text,integer,jsonb),public.save_excuse_catalog(text,uuid,jsonb),public.central_overview(),public.admin_users(text,integer),public.admin_grant_role(uuid,public.app_role,uuid) from public,anon;
grant execute on function public.admin_configuration(),public.save_clinic(uuid,uuid,jsonb),public.save_doctor_identity(uuid,jsonb),public.save_excuse_template(uuid,text,integer,jsonb),public.save_excuse_catalog(text,uuid,jsonb),public.central_overview(),public.admin_users(text,integer),public.admin_grant_role(uuid,public.app_role,uuid) to authenticated;
commit;

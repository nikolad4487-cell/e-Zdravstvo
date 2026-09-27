begin;
create table public.doctors (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 institution_id uuid not null references public.institutions(id), display_name text not null,
 specialty text not null default 'Obiteljska medicina', active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), created_by uuid references public.profiles(id),
 unique(user_id,institution_id), foreign key(institution_id,user_id) references public.institution_users(institution_id,user_id)
);
create sequence private.patient_number;
create table public.patients (
 id uuid primary key default gen_random_uuid(), user_id uuid unique references public.profiles(id), institution_id uuid not null references public.institutions(id),
 patient_number text not null unique default ('EZ-PAC-'||lpad(nextval('private.patient_number')::text,8,'0')),
 first_name text not null check(length(trim(first_name)) between 1 and 100), last_name text not null check(length(trim(last_name)) between 1 and 100),
 birth_date date not null check(birth_date between '1900-01-01'::date and current_date), sex text not null check(sex in ('F','M','OTHER','UNKNOWN')),
 address text,city text,postal_code text,phone text,email text, emergency_contact text,insurance text,
 archived_at timestamptz, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id)
);
create table public.patient_doctors (
 id uuid primary key default gen_random_uuid(), patient_id uuid not null references public.patients(id), doctor_id uuid not null references public.doctors(id),
 is_primary boolean not null default false, revoked_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id), unique(patient_id,doctor_id)
);
create unique index patient_primary_doctor_idx on public.patient_doctors(patient_id) where is_primary and revoked_at is null;
create table public.patient_staff (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),user_id uuid not null references public.profiles(id),
 institution_id uuid not null references public.institutions(id),revoked_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),unique(patient_id,user_id),
 foreign key(institution_id,user_id) references public.institution_users(institution_id,user_id)
);
create table public.medical_records (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null unique references public.patients(id),
 blood_group text check(blood_group in ('A+','A-','B+','B-','AB+','AB-','O+','O-')), warnings text not null default '',
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id)
);
create table public.allergies(id uuid primary key default gen_random_uuid(),name text not null unique,created_at timestamptz not null default now());
create table public.patient_allergies (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),allergy_id uuid not null references public.allergies(id),
 reaction text not null default '',severity text not null default 'UNKNOWN' check(severity in ('MILD','MODERATE','SEVERE','UNKNOWN')),
 archived_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id)
);
create index patients_names_idx on public.patients(lower(last_name),lower(first_name));
create index patients_birth_idx on public.patients(birth_date);
create index patients_institution_idx on public.patients(institution_id);
create index patient_doctors_doctor_idx on public.patient_doctors(doctor_id,patient_id);
create index patient_staff_user_idx on public.patient_staff(user_id,patient_id);
create index patient_allergies_patient_idx on public.patient_allergies(patient_id);

create function private.can_read_patient(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.patients p where p.id=pid and p.archived_at is null and (
 (p.user_id=auth.uid() and private.has_role('PATIENT')) or
 exists(select 1 from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=p.id and pd.revoked_at is null and d.active and d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id)) or
 exists(select 1 from public.patient_staff ps where ps.patient_id=p.id and ps.user_id=auth.uid() and ps.revoked_at is null and private.has_role('NURSE',ps.institution_id))));
$$;
create function private.treating_doctor(pid uuid) returns uuid language sql stable security definer set search_path='' as $$
 select d.id from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.patients p on p.id=pd.patient_id
 where pd.patient_id=pid and p.archived_at is null and pd.revoked_at is null and d.active and d.user_id=auth.uid() and private.has_role('DOCTOR',d.institution_id) order by pd.is_primary desc,d.id limit 1;
$$;
create function private.audit_event(action_name text,entity text,entity_uuid uuid) returns void language sql security definer set search_path='' as $$
 insert into public.audit_logs(user_id,action,entity_type,entity_id,metadata) values(auth.uid(),action_name,entity,entity_uuid,'{"source":"authorized_rpc"}');
$$;
create function private.no_clinical_delete() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'Clinical records cannot be deleted'; end $$;
do $$ declare t text; begin foreach t in array array['doctors','patients','patient_doctors','patient_staff','medical_records','allergies','patient_allergies'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 if t<>'allergies' then execute format('create trigger updated_at before update on public.%I for each row execute function private.touch_updated_at()',t); end if;
end loop; end $$;
-- Clinical reads go through audited RPCs, not PostgREST table SELECT.
create policy patient_read on public.patients for select to authenticated using(private.can_read_patient(id));
create policy record_read on public.medical_records for select to authenticated using(private.can_read_patient(patient_id));
create policy allergy_read on public.patient_allergies for select to authenticated using(private.can_read_patient(patient_id));
create policy doctor_read on public.doctors for select to authenticated using(private.is_member(institution_id));

create function public.clinical_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('doctors',coalesce((select jsonb_agg(to_jsonb(d)) from public.doctors d where d.active and private.is_member(d.institution_id)),'[]'),
 'allergies',coalesce((select jsonb_agg(to_jsonb(a)) from public.allergies a where auth.uid() is not null),'[]'));
$$;
create function public.search_patients(search_term text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; term text := lower(trim(left(search_term,100)));
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501'; end if;
 select coalesce(jsonb_agg(x),'[]') into result from (
 select p.id,p.patient_number,p.first_name,p.last_name,p.birth_date,p.sex,
 (select d.display_name from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=p.id and pd.is_primary and pd.revoked_at is null limit 1) as primary_doctor
 from public.patients p where private.can_read_patient(p.id) and (term='' or position(term in lower(p.first_name||' '||p.last_name||' '||p.patient_number||' '||p.birth_date::text||' '||to_char(p.birth_date,'DD.MM.YYYY')))>0)
 order by p.last_name,p.first_name limit 50) x;
 perform private.audit_event('PATIENT_SEARCHED','patients',null); return result;
end $$;
create function private.patient_chart(pid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('patient',to_jsonb(p),'record',(select to_jsonb(r) from public.medical_records r where r.patient_id=p.id),
 'doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'display_name',d.display_name,'specialty',d.specialty,'is_primary',pd.is_primary,'institution_id',d.institution_id)) from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id where pd.patient_id=p.id and pd.revoked_at is null),'[]'),
 'allergies',coalesce((select jsonb_agg(to_jsonb(pa)||jsonb_build_object('name',a.name)) from public.patient_allergies pa join public.allergies a on a.id=pa.allergy_id where pa.patient_id=p.id and pa.archived_at is null),'[]'),
 'can_write',private.treating_doctor(p.id) is not null)
 from public.patients p where p.id=pid;
$$;
create function public.get_patient_chart(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not private.can_read_patient(patient_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 perform private.audit_event('PATIENT_RECORD_VIEWED','patients',patient_id); return private.patient_chart(patient_id); end $$;
create function public.create_patient(data jsonb,doctor_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare d public.doctors; pid uuid;
begin
 select * into d from public.doctors where id=doctor_id and user_id=auth.uid() and active;
 if d.id is null or not private.has_role('DOCTOR',d.institution_id) then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.patients(institution_id,first_name,last_name,birth_date,sex,address,city,postal_code,phone,email,emergency_contact,insurance,created_by)
 values(d.institution_id,trim(data->>'first_name'),trim(data->>'last_name'),(data->>'birth_date')::date,data->>'sex',left(data->>'address',300),left(data->>'city',100),left(data->>'postal_code',20),left(data->>'phone',50),left(data->>'email',200),left(data->>'emergency_contact',500),left(data->>'insurance',300),auth.uid()) returning id into pid;
 insert into public.patient_doctors(patient_id,doctor_id,is_primary,created_by) values(pid,d.id,true,auth.uid());
 insert into public.medical_records(patient_id,created_by) values(pid,auth.uid()); return pid;
end $$;
create function public.update_patient_record(patient_id uuid,blood_group text,warnings text) returns void language plpgsql security definer set search_path='' as $$
begin if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.medical_records set blood_group=nullif(update_patient_record.blood_group,''),warnings=left(update_patient_record.warnings,4000) where medical_records.patient_id=update_patient_record.patient_id;
end $$;
create function public.add_patient_allergy(patient_id uuid,allergy_id uuid,reaction text,severity text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin if private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.patient_allergies(patient_id,allergy_id,reaction,severity,created_by) values(patient_id,allergy_id,left(reaction,1000),severity,auth.uid()) returning id into result; return result; end $$;
create function public.institution_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('departments',coalesce((select jsonb_agg(to_jsonb(d)) from public.institution_departments d where d.institution_id=i.id and d.archived_at is null),'[]'),
 'staff',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'first_name',p.first_name,'last_name',p.last_name,'active',m.active,'roles',(select jsonb_agg(r.role) from public.user_roles r where r.user_id=m.user_id and r.institution_id=i.id))) from public.institution_users m join public.profiles p on p.id=m.user_id where m.institution_id=i.id),'[]'))),'[]') into result from public.institutions i where private.has_role('INSTITUTION_ADMIN',i.id) or private.has_role('SYSTEM_ADMIN');
 perform private.audit_event('INSTITUTION_VIEWED','institutions',null); return result;
end $$;
create function public.save_institution(institution_id uuid,data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501'; end if;
 update public.institutions set name=trim(data->>'name'),address=left(data->>'address',300),city=left(data->>'city',100),phone=left(data->>'phone',50),postal_code=left(data->>'postal_code',20) where id=institution_id;
end $$;
create function public.add_department(institution_id uuid,name text,code text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501'; end if;
 insert into public.institution_departments(institution_id,name,code,created_by) values(institution_id,trim(name),upper(trim(code)),auth.uid()) returning id into result; return result; end $$;
create function public.register_doctor(target_user uuid,institution_id uuid,specialty text) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid; begin
 if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501'; end if;
 if not exists(select 1 from public.user_roles r join public.institution_users m on m.institution_id=r.institution_id and m.user_id=r.user_id where r.user_id=target_user and r.institution_id=register_doctor.institution_id and r.role='DOCTOR' and m.active) then raise exception 'Active doctor role required'; end if;
 insert into public.doctors(user_id,institution_id,display_name,specialty,created_by) select p.id,institution_id,'dr. '||p.first_name||' '||p.last_name,left(specialty,200),auth.uid() from public.profiles p where p.id=target_user
 on conflict on constraint doctors_user_id_institution_id_key do update set specialty=excluded.specialty returning id into result; return result;
end $$;
revoke all on all functions in schema private from public,anon,authenticated;
grant execute on function private.has_role(public.app_role,uuid),private.is_member(uuid),private.can_read_patient(uuid) to authenticated;
revoke all on function public.clinical_context(),public.search_patients(text),public.get_patient_chart(uuid),public.create_patient(jsonb,uuid),public.update_patient_record(uuid,text,text),public.add_patient_allergy(uuid,uuid,text,text),public.institution_overview(),public.save_institution(uuid,jsonb),public.add_department(uuid,text,text),public.register_doctor(uuid,uuid,text) from public,anon;
grant execute on function public.clinical_context(),public.search_patients(text),public.get_patient_chart(uuid),public.create_patient(jsonb,uuid),public.update_patient_record(uuid,text,text),public.add_patient_allergy(uuid,uuid,text,text),public.institution_overview(),public.save_institution(uuid,jsonb),public.add_department(uuid,text,text),public.register_doctor(uuid,uuid,text) to authenticated;
commit;

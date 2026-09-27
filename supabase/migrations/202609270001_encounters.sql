begin;
create table public.diagnoses(id uuid primary key default gen_random_uuid(),code text not null,name text not null,coding_system text not null default 'LOCAL',active boolean not null default true,created_at timestamptz not null default now(),unique(coding_system,code));
create table public.medications(id uuid primary key default gen_random_uuid(),name text not null,active_ingredient text not null,strength text not null,form text not null,packaging text not null,route text not null,active boolean not null default true,created_at timestamptz not null default now());
create table public.medical_encounters (
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),institution_id uuid not null references public.institutions(id),
 encountered_at timestamptz not null,kind text not null check(length(trim(kind)) between 1 and 100),reason text not null check(length(trim(reason)) between 1 and 2000),
 anamnesis text not null default '',symptoms text not null default '',objective_status text not null default '',
 systolic integer check(systolic between 40 and 300),diastolic integer check(diastolic between 20 and 200),pulse integer check(pulse between 20 and 250),temperature numeric(4,1) check(temperature between 25 and 45),spo2 integer check(spo2 between 0 and 100),height_cm numeric(5,1) check(height_cm between 20 and 250),weight_kg numeric(6,2) check(weight_kg between 1 and 500),
 bmi numeric generated always as (round(weight_kg/nullif((height_cm/100)^2,0),1)) stored,
 therapy text not null default '',recommendations text not null default '',follow_up date,notes text not null default '',
 supersedes_id uuid unique references public.medical_encounters(id),superseded_by uuid unique references public.medical_encounters(id),amendment_reason text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid not null references public.profiles(id),
 check(systolic is null or diastolic is null or systolic>diastolic)
);
create table public.encounter_diagnoses(id uuid primary key default gen_random_uuid(),encounter_id uuid not null references public.medical_encounters(id),diagnosis_id uuid not null references public.diagnoses(id),is_primary boolean not null default false,created_at timestamptz not null default now(),unique(encounter_id,diagnosis_id));
create unique index encounter_primary_diagnosis_idx on public.encounter_diagnoses(encounter_id) where is_primary;
create table public.patient_diagnoses(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),diagnosis_id uuid not null references public.diagnoses(id),doctor_id uuid not null references public.doctors(id),diagnosed_at date not null default current_date,status text not null default 'ACTIVE' check(status in ('ACTIVE','RESOLVED','CHRONIC','SUSPECTED')),notes text not null default '',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id));
create table public.patient_medications(id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),medication_id uuid not null references public.medications(id),doctor_id uuid not null references public.doctors(id),dosage text not null check(length(trim(dosage)) between 1 and 500),frequency text not null check(length(trim(frequency)) between 1 and 300),start_date date not null,end_date date,notes text not null default '',status text not null default 'ACTIVE' check(status in ('ACTIVE','STOPPED','COMPLETED')),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),created_by uuid references public.profiles(id),check(end_date is null or end_date>=start_date));
create index encounters_patient_idx on public.medical_encounters(patient_id,encountered_at desc);
create index patient_diagnoses_patient_idx on public.patient_diagnoses(patient_id);
create index patient_medications_patient_idx on public.patient_medications(patient_id);
do $$ declare t text; begin foreach t in array array['diagnoses','medications','medical_encounters','encounter_diagnoses','patient_diagnoses','patient_medications'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
 if t in ('medical_encounters','patient_diagnoses','patient_medications') then
 execute format('create trigger updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
 execute format('create policy clinical_read on public.%I for select to authenticated using(private.can_read_patient(patient_id))',t);
 end if;
end loop;end $$;
create function private.preserve_encounter() returns trigger language plpgsql set search_path='' as $$
begin if (to_jsonb(new)-'superseded_by'-'updated_at'-'bmi') is distinct from (to_jsonb(old)-'superseded_by'-'updated_at'-'bmi') then raise exception 'Create an amended version instead of overwriting an encounter';end if;return new;end $$;
create trigger preserve_content before update on public.medical_encounters for each row execute function private.preserve_encounter();
create or replace function public.clinical_context() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('doctors',coalesce((select jsonb_agg(to_jsonb(d)) from public.doctors d where d.active and private.is_member(d.institution_id)),'[]'),
 'allergies',coalesce((select jsonb_agg(to_jsonb(a)) from public.allergies a where auth.uid() is not null),'[]'),
 'diagnoses',coalesce((select jsonb_agg(to_jsonb(d) order by d.code) from public.diagnoses d where d.active and auth.uid() is not null),'[]'),
 'medications',coalesce((select jsonb_agg(to_jsonb(m) order by m.name) from public.medications m where m.active and auth.uid() is not null),'[]'));
$$;
create function private.clinical_details(pid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'encounters',coalesce((select jsonb_agg(to_jsonb(e)||jsonb_build_object('doctor_name',d.display_name,'diagnoses',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'code',x.code,'name',x.name,'is_primary',ed.is_primary)) from public.encounter_diagnoses ed join public.diagnoses x on x.id=ed.diagnosis_id where ed.encounter_id=e.id),'[]')) order by e.encountered_at desc) from public.medical_encounters e join public.doctors d on d.id=e.doctor_id where e.patient_id=pid),'[]'),
 'diagnoses',coalesce((select jsonb_agg(to_jsonb(pd)||jsonb_build_object('code',d.code,'name',d.name,'doctor_name',dr.display_name) order by pd.created_at desc) from public.patient_diagnoses pd join public.diagnoses d on d.id=pd.diagnosis_id join public.doctors dr on dr.id=pd.doctor_id where pd.patient_id=pid),'[]'),
 'therapy',coalesce((select jsonb_agg(to_jsonb(pm)||jsonb_build_object('name',m.name,'strength',m.strength,'doctor_name',d.display_name) order by pm.created_at desc) from public.patient_medications pm join public.medications m on m.id=pm.medication_id join public.doctors d on d.id=pm.doctor_id where pm.patient_id=pid),'[]'));
$$;
create or replace function public.get_patient_chart(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin if not private.can_read_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 perform private.audit_event('PATIENT_RECORD_VIEWED','patients',patient_id);return private.patient_chart(patient_id)||private.clinical_details(patient_id);end $$;
create function public.create_encounter(patient_id uuid,data jsonb,supersedes_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);eid uuid;previous public.medical_encounters;diag jsonb;at_time timestamptz:=(data->>'encountered_at')::timestamptz;
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 if at_time>now()+interval '5 minutes' or at_time::date<(select birth_date from public.patients where id=patient_id) then raise exception 'Invalid encounter date';end if;
 if supersedes_id is not null then
 select * into previous from public.medical_encounters where id=create_encounter.supersedes_id for update;
 if previous.id is null or previous.patient_id<>patient_id or previous.superseded_by is not null or length(trim(coalesce(data->>'amendment_reason','')))<5 then raise exception 'Invalid amendment';end if;
 end if;
 insert into public.medical_encounters(patient_id,doctor_id,institution_id,encountered_at,kind,reason,anamnesis,symptoms,objective_status,systolic,diastolic,pulse,temperature,spo2,height_cm,weight_kg,therapy,recommendations,follow_up,notes,supersedes_id,amendment_reason,created_by)
 select patient_id,did,d.institution_id,at_time,data->>'kind',data->>'reason',left(coalesce(data->>'anamnesis',''),10000),left(coalesce(data->>'symptoms',''),10000),left(coalesce(data->>'objective_status',''),10000),nullif(data->>'systolic','')::int,nullif(data->>'diastolic','')::int,nullif(data->>'pulse','')::int,nullif(data->>'temperature','')::numeric,nullif(data->>'spo2','')::int,nullif(data->>'height_cm','')::numeric,nullif(data->>'weight_kg','')::numeric,left(coalesce(data->>'therapy',''),10000),left(coalesce(data->>'recommendations',''),10000),nullif(data->>'follow_up','')::date,left(coalesce(data->>'notes',''),10000),supersedes_id,data->>'amendment_reason',auth.uid() from public.doctors d where d.id=did returning id into eid;
 if jsonb_typeof(data->'diagnoses')='array' then
 for diag in select * from jsonb_array_elements(data->'diagnoses') loop
 insert into public.encounter_diagnoses(encounter_id,diagnosis_id,is_primary) values(eid,(diag->>'id')::uuid,coalesce((diag->>'is_primary')::boolean,false));end loop;end if;
 if supersedes_id is not null then update public.medical_encounters set superseded_by=eid where id=create_encounter.supersedes_id;end if;
 perform private.audit_event('MEDICAL_RECORD_CREATED','medical_encounters',eid);return eid;
end $$;
create function public.add_patient_diagnosis(patient_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);result uuid;
begin if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 if (data->>'diagnosed_at')::date>current_date then raise exception 'Invalid diagnosis date';end if;
 insert into public.patient_diagnoses(patient_id,diagnosis_id,doctor_id,diagnosed_at,status,notes,created_by) values(patient_id,(data->>'diagnosis_id')::uuid,did,(data->>'diagnosed_at')::date,data->>'status',left(coalesce(data->>'notes',''),4000),auth.uid()) returning id into result;return result;end $$;
create function public.add_patient_therapy(patient_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);result uuid;
begin if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 insert into public.patient_medications(patient_id,medication_id,doctor_id,dosage,frequency,start_date,end_date,notes,created_by) values(patient_id,(data->>'medication_id')::uuid,did,data->>'dosage',data->>'frequency',(data->>'start_date')::date,nullif(data->>'end_date','')::date,left(coalesce(data->>'notes',''),4000),auth.uid()) returning id into result;return result;end $$;
create function public.set_clinical_status(entity_type text,entity_id uuid,new_status text) returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;begin
 if entity_type='diagnosis' then select patient_id into pid from public.patient_diagnoses where id=entity_id;
 elsif entity_type='therapy' then select patient_id into pid from public.patient_medications where id=entity_id;
 else raise exception 'Unknown entity';end if;
 if private.treating_doctor(pid) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if entity_type='diagnosis' then update public.patient_diagnoses set status=new_status where id=entity_id;
 else update public.patient_medications set status=new_status where id=entity_id;end if;
end $$;
revoke all on function private.clinical_details(uuid),private.preserve_encounter() from public,anon,authenticated;
revoke all on function public.create_encounter(uuid,jsonb,uuid),public.add_patient_diagnosis(uuid,jsonb),public.add_patient_therapy(uuid,jsonb),public.set_clinical_status(text,uuid,text) from public,anon;
grant execute on function public.create_encounter(uuid,jsonb,uuid),public.add_patient_diagnosis(uuid,jsonb),public.add_patient_therapy(uuid,jsonb),public.set_clinical_status(text,uuid,text) to authenticated;
commit;

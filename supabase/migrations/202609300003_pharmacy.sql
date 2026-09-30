begin;
create table public.prescription_dispensations(id uuid primary key default gen_random_uuid(),document_id uuid not null unique references public.documents(id),institution_id uuid not null references public.institutions(id),pharmacist_id uuid not null references public.profiles(id),institution_name text not null,pharmacist_name text not null,created_at timestamptz not null default now());
alter table public.prescription_dispensations enable row level security;revoke all on public.prescription_dispensations from anon,authenticated;
create trigger no_delete before delete or update on public.prescription_dispensations for each row execute function private.no_clinical_delete();
create trigger audit_change after insert on public.prescription_dispensations for each row execute function private.audit_change();
create function private.pharmacy_summary(d public.documents) returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('id',d.id,'number',d.number,'status',private.document_status(d),'issued_at',d.issued_at,'expires_on',d.expires_on,'patient_name',concat_ws(' ',d.payload->'patient'->>'first_name',d.payload->'patient'->>'last_name'),'patient_number',d.payload->'patient'->>'patient_number','doctor_name',d.payload->>'doctor','items',d.payload->'details'->'items','dispensation',(select jsonb_build_object('institution_name',x.institution_name,'pharmacist_name',x.pharmacist_name,'created_at',x.created_at) from public.prescription_dispensations x where x.document_id=d.id))$$;
create function public.pharmacy_lookup(document_number text,patient_number text) returns jsonb language plpgsql security definer set search_path='' as $$declare d public.documents;begin
 if not private.has_role('PHARMACIST') then raise exception 'Forbidden' using errcode='42501';end if;
 select * into d from public.documents x where x.number=trim(document_number) and x.kind='PRESCRIPTION' and x.payload->'patient'->>'patient_number'=trim(patient_number);
 perform private.audit_event('PHARMACY_PRESCRIPTION_VIEWED','documents',d.id);if d.id is null then return null;end if;return private.pharmacy_summary(d);end $$;
create function public.dispense_prescription(document_id uuid,patient_number text,institution_id uuid) returns void language plpgsql security definer set search_path='' as $$declare d public.documents;begin
 if not private.has_role('PHARMACIST',institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into d from public.documents where id=document_id for update;
 if d.id is null or d.kind<>'PRESCRIPTION' or d.payload->'patient'->>'patient_number' is distinct from trim(patient_number) or private.document_status(d)<>'ISSUED' then raise exception 'Prescription cannot be dispensed';end if;
 insert into public.prescription_dispensations(document_id,institution_id,pharmacist_id,institution_name,pharmacist_name) select d.id,institution_id,auth.uid(),i.name,p.first_name||' '||p.last_name from public.institutions i,public.profiles p where i.id=institution_id and p.id=auth.uid();
 update public.documents set status='DISPENSED' where id=document_id;
 insert into public.notifications(user_id,document_id,message) select p.user_id,d.id,'Recept '||d.number||' realiziran je u ljekarni.' from public.patients p where p.id=d.patient_id and p.user_id is not null;
 perform private.audit_event('PRESCRIPTION_DISPENSED','documents',d.id);end $$;
create function public.pharmacy_institutions() returns jsonb language sql stable security definer set search_path='' as $$select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',i.name)),'[]') from public.institutions i where private.has_role('PHARMACIST',i.id)$$;
create function public.my_medications(active_only boolean default false,page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$declare result jsonb;pid uuid;begin
 if not private.has_role('PATIENT') or page_number is null or page_number not between 0 and 10000 then raise exception 'Forbidden' using errcode='42501';end if;
 select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 select coalesce(jsonb_agg(private.pharmacy_summary(x)),'[]') into result from(select d.* from public.documents d where d.patient_id=pid and d.kind='PRESCRIPTION' and (not active_only or private.document_status(d)='ISSUED') order by d.issued_at desc,d.id limit 50 offset page_number*50)x;
 perform private.audit_event('MEDICATIONS_VIEWED','patients',pid);return result;end $$;
revoke all on function private.pharmacy_summary(public.documents) from public,anon,authenticated;
revoke all on function public.pharmacy_lookup(text,text),public.dispense_prescription(uuid,text,uuid),public.pharmacy_institutions(),public.my_medications(boolean,integer) from public,anon;
grant execute on function public.pharmacy_lookup(text,text),public.dispense_prescription(uuid,text,uuid),public.pharmacy_institutions(),public.my_medications(boolean,integer) to authenticated;
commit;

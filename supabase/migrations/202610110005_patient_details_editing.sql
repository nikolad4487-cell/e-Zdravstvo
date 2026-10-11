begin;
-- Demographic edits use the same active treating-doctor authorization as clinical writes.
-- Compare the editable snapshot while holding the row lock to prevent lost updates,
-- including contact edits made by the patient in another session.
create function public.update_patient_details(patient_id uuid,data jsonb,expected_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 p public.patients;
 fields text[]:=array['first_name','last_name','birth_date','sex','address','city','postal_code','phone','email','insurance','emergency_contact'];
 current_data jsonb;
 field_name text;
begin
 if auth.uid() is null or private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 select * into p from public.patients where id=patient_id for update;
 if p.id is null or private.treating_doctor(patient_id) is null then raise exception 'Forbidden' using errcode='42501';end if;
 if data is null or jsonb_typeof(data)<>'object' or not(data ?& fields) or data-fields<>'{}'::jsonb then raise exception 'Invalid patient details';end if;
 foreach field_name in array fields loop
  if jsonb_typeof(data->field_name)<>'string' then raise exception 'Invalid patient field';end if;
 end loop;
 select jsonb_object_agg(k,to_jsonb(p)->k) into current_data from unnest(fields) k;
 if expected_data is distinct from current_data then raise exception 'Patient changed' using errcode='40001';end if;
 if length(trim(data->>'first_name')) not between 1 and 100 or length(trim(data->>'last_name')) not between 1 and 100
 or length(data->>'address')>300 or length(data->>'city')>150 or length(data->>'postal_code')>20
 or length(data->>'phone')>50 or length(data->>'email')>254 or length(data->>'insurance')>300 or length(data->>'emergency_contact')>500
 or data->>'sex' not in ('F','M','OTHER','UNKNOWN') then raise exception 'Invalid patient details';end if;
 if data->>'birth_date' !~ '^\d{4}-\d{2}-\d{2}$' or (data->>'birth_date')::date not between '1900-01-01'::date and current_date then raise exception 'Invalid birth date';end if;
 if trim(data->>'email')<>'' and trim(data->>'email') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email';end if;
 update public.patients set first_name=trim(data->>'first_name'),last_name=trim(data->>'last_name'),birth_date=(data->>'birth_date')::date,sex=data->>'sex',
 address=nullif(trim(data->>'address'),''),city=nullif(trim(data->>'city'),''),postal_code=nullif(trim(data->>'postal_code'),''),phone=nullif(trim(data->>'phone'),''),email=nullif(trim(data->>'email'),''),insurance=nullif(trim(data->>'insurance'),''),emergency_contact=nullif(trim(data->>'emergency_contact'),'')
 where id=patient_id;
 perform private.audit_event('PATIENT_DETAILS_UPDATED','patients',patient_id);
end $$;
revoke all on function public.update_patient_details(uuid,jsonb,jsonb) from public,anon;
grant execute on function public.update_patient_details(uuid,jsonb,jsonb) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 2026101103$$;
commit;

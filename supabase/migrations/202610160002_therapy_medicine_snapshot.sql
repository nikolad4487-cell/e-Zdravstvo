begin;
alter table public.patient_medications add column medication_snapshot jsonb;
create or replace function public.add_patient_therapy(patient_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);result uuid;med public.medications;
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 select * into med from public.medications where id=(data->>'medication_id')::uuid and active;
 if med.id is null then raise exception 'Invalid medication';end if;
 insert into public.patient_medications(patient_id,medication_id,doctor_id,dosage,frequency,start_date,end_date,notes,created_by,medication_snapshot)
 values(patient_id,med.id,did,data->>'dosage',data->>'frequency',(data->>'start_date')::date,nullif(data->>'end_date','')::date,left(coalesce(data->>'notes',''),4000),auth.uid(),jsonb_build_object('name',med.name,'strength',med.strength,'packaging',med.packaging,'active_ingredient',med.active_ingredient,'catalog_code',med.catalog_code,'catalog_list',med.catalog_list)) returning id into result;
 return result;
end $$;
do $$ declare definition text;begin
 select pg_get_functiondef('private.clinical_details(uuid)'::regprocedure) into definition;
 execute replace(definition,'''name'',m.name,''strength'',m.strength,''doctor_name'',d.display_name','''name'',coalesce(pm.medication_snapshot->>''name'',m.name),''strength'',coalesce(pm.medication_snapshot->>''strength'',m.strength),''packaging'',coalesce(pm.medication_snapshot->>''packaging'',m.packaging),''catalog_code'',coalesce(pm.medication_snapshot->>''catalog_code'',m.catalog_code),''doctor_name'',d.display_name');
 select pg_get_functiondef('public.patient_dashboard()'::regprocedure) into definition;
 execute replace(definition,'''name'',m.name,''strength'',m.strength','''name'',coalesce(pm.medication_snapshot->>''name'',m.name),''strength'',coalesce(pm.medication_snapshot->>''strength'',m.strength),''packaging'',coalesce(pm.medication_snapshot->>''packaging'',m.packaging)');
end $$;
commit;

begin;
create function public.export_patient_record(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.can_read_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
  result:=public.get_patient_chart(patient_id);
  perform private.audit_event('PATIENT_RECORD_EXPORTED','patients',patient_id);
  return result;
end $$;
revoke all on function public.export_patient_record(uuid) from public,anon;
grant execute on function public.export_patient_record(uuid) to authenticated;
commit;

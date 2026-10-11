begin;
create function private.trend_patient(patient_filter uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare pid uuid:=patient_filter;
begin
  if pid is null then
    if not private.has_role('PATIENT') then raise exception 'Patient selection required' using errcode='42501';end if;
    select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
  end if;
  if pid is null or not private.can_read_patient(pid) then raise exception 'Forbidden' using errcode='42501';end if;
  return pid;
end $$;
create function public.laboratory_trend_catalog(patient_filter uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid:=private.trend_patient(patient_filter);result jsonb;
begin
  select coalesce(jsonb_agg(x order by x.name,x.code,x.unit),'[]') into result from (
    select distinct on (p.code,p.unit) p.code,p.name,p.unit from public.laboratory_parameters p
    join public.laboratory_results r on r.id=p.result_id join public.laboratory_orders o on o.id=r.order_id
    where o.patient_id=pid and r.superseded_by is null order by p.code,p.unit,r.reported_at desc,r.id
  )x;
  perform private.audit_event('LABORATORY_TRENDS_VIEWED','patients',pid);return result;
end $$;
create function public.laboratory_trend_points(patient_filter uuid,parameter_code text,parameter_unit text,date_from date,date_to date,page_number integer default 0)
returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid:=private.trend_patient(patient_filter);result jsonb;
begin
  if parameter_code is null or length(parameter_code) not between 1 and 40 or parameter_unit is null or length(parameter_unit)>50
    or date_from is null or date_to is null or date_from>date_to or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid trend filters';end if;
  select coalesce(jsonb_agg(x order by x.sampled_at desc,x.id),'[]') into result from (
    select p.id,p.value,p.unit,p.reference_low,p.reference_high,p.flag,r.sampled_at,r.id result_id,i.name laboratory_name
    from public.laboratory_parameters p join public.laboratory_results r on r.id=p.result_id
    join public.laboratory_orders o on o.id=r.order_id join public.institutions i on i.id=o.laboratory_institution_id
    where o.patient_id=pid and r.superseded_by is null and p.code=parameter_code and p.unit=parameter_unit
      and (r.sampled_at at time zone 'Europe/Zagreb')::date between date_from and date_to
    order by r.sampled_at desc,p.id limit 50 offset page_number*50
  )x;
  perform private.audit_event('LABORATORY_TRENDS_VIEWED','patients',pid);return result;
end $$;
revoke all on function private.trend_patient(uuid) from public,anon,authenticated;
revoke all on function public.laboratory_trend_catalog(uuid),public.laboratory_trend_points(uuid,text,text,date,date,integer) from public,anon;
grant execute on function public.laboratory_trend_catalog(uuid),public.laboratory_trend_points(uuid,text,text,date,date,integer) to authenticated;
commit;

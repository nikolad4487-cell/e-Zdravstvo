begin;
create table public.message_reads(
  id uuid not null unique default gen_random_uuid(),patient_id uuid not null references public.patients(id),doctor_id uuid not null references public.doctors(id),
  user_id uuid not null references public.profiles(id),read_at timestamptz not null default now(),primary key(patient_id,doctor_id,user_id)
);
create table public.laboratory_acknowledgements(
  id uuid primary key default gen_random_uuid(),result_id uuid not null unique references public.laboratory_results(id),
  doctor_id uuid not null references public.doctors(id),acknowledged_by uuid not null references public.profiles(id),acknowledged_at timestamptz not null default now()
);
alter table public.message_reads enable row level security;
alter table public.laboratory_acknowledgements enable row level security;
revoke all on public.message_reads,public.laboratory_acknowledgements from anon,authenticated;
create trigger audit_change after insert or update on public.message_reads for each row execute function private.audit_change();
create trigger audit_change after insert on public.laboratory_acknowledgements for each row execute function private.audit_change();
create trigger immutable before update or delete on public.laboratory_acknowledgements for each row execute function private.no_clinical_delete();
create function public.mark_thread_read(patient_id uuid,doctor_id uuid,read_through timestamptz) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.can_message(patient_id,doctor_id) then raise exception 'Forbidden' using errcode='42501';end if;
  if read_through is null or read_through>now() then raise exception 'Invalid read timestamp';end if;
  insert into public.message_reads(patient_id,doctor_id,user_id,read_at) values(patient_id,doctor_id,auth.uid(),read_through)
  on conflict on constraint message_reads_pkey do update set read_at=greatest(message_reads.read_at,excluded.read_at);
end $$;
create function public.acknowledge_laboratory_result(result_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare pid uuid;did uuid;
begin
  select o.patient_id into pid from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.id=result_id and r.superseded_by is null;
  did:=private.treating_doctor(pid);
  if did is null then raise exception 'Forbidden' using errcode='42501';end if;
  if not exists(select 1 from public.laboratory_parameters p where p.result_id=acknowledge_laboratory_result.result_id and p.flag='CRITICAL') then raise exception 'Not a current critical result';end if;
  insert into public.laboratory_acknowledgements(result_id,doctor_id,acknowledged_by) values(result_id,did,auth.uid()) on conflict on constraint laboratory_acknowledgements_result_id_key do nothing;
  perform private.audit_event('CRITICAL_RESULT_ACKNOWLEDGED','laboratory_results',result_id);
end $$;
create function public.laboratory_acknowledgement(result_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;result jsonb;
begin
  select o.patient_id into pid from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.id=result_id;
  if pid is null or not private.can_read_patient(pid) then raise exception 'Forbidden' using errcode='42501';end if;
  select jsonb_build_object('name',d.display_name,'acknowledged_at',a.acknowledged_at) into result from public.laboratory_acknowledgements a join public.doctors d on d.id=a.doctor_id where a.result_id=laboratory_acknowledgement.result_id;
  perform private.audit_event('CRITICAL_ACKNOWLEDGEMENT_VIEWED','laboratory_results',result_id);return result;
end $$;
create function public.doctor_task_overview() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.has_role('DOCTOR') then raise exception 'Forbidden' using errcode='42501';end if;
  select jsonb_build_object(
    'waiting',(select count(*) from public.appointments a join public.doctors d on d.id=a.doctor_id where d.user_id=auth.uid() and a.status='ARRIVED' and private.can_read_patient(a.patient_id)),
    'unread_messages',(select count(*) from public.messages m join public.doctors d on d.id=m.doctor_id where d.user_id=auth.uid() and m.sender_id<>auth.uid() and private.can_message(m.patient_id,m.doctor_id) and m.created_at>coalesce((select r.read_at from public.message_reads r where r.patient_id=m.patient_id and r.doctor_id=m.doctor_id and r.user_id=auth.uid()),'-infinity'::timestamptz)),
    'renewals',(select count(*) from public.medication_renewals r where r.status='PENDING' and private.treating_doctor(r.patient_id) is not null),
    'critical_results',(select count(*) from public.laboratory_results r join public.laboratory_orders o on o.id=r.order_id where r.superseded_by is null and private.treating_doctor(o.patient_id) is not null and exists(select 1 from public.laboratory_parameters p where p.result_id=r.id and p.flag='CRITICAL') and not exists(select 1 from public.laboratory_acknowledgements a where a.result_id=r.id))
  ) into result;
  perform private.audit_event('DOCTOR_TASKS_VIEWED','doctors',null);return result;
end $$;
revoke all on function public.mark_thread_read(uuid,uuid,timestamptz),public.acknowledge_laboratory_result(uuid),public.laboratory_acknowledgement(uuid),public.doctor_task_overview() from public,anon;
grant execute on function public.mark_thread_read(uuid,uuid,timestamptz),public.acknowledge_laboratory_result(uuid),public.laboratory_acknowledgement(uuid),public.doctor_task_overview() to authenticated;
commit;

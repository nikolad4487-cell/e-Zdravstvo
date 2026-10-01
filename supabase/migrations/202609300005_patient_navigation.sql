begin;
create function public.my_next_hospital_booking() returns jsonb language plpgsql security definer set search_path='' as $$declare pid uuid;result jsonb;begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 select jsonb_build_object('id',b.id,'starts_at',sl.starts_at,'service_name',s.name,'institution_name',i.name,'location',s.location,'priority',b.priority) into result from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id join public.institutions i on i.id=s.institution_id where b.patient_id=pid and b.status='BOOKED' and sl.starts_at>now() order by sl.starts_at,b.id limit 1;
 perform private.audit_event('HOSPITAL_BOOKING_VIEWED','patients',pid);return result;end $$;
revoke all on function public.my_next_hospital_booking() from public,anon;grant execute on function public.my_next_hospital_booking() to authenticated;
commit;

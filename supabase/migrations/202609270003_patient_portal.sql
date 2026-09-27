begin;
-- Select the personal chart explicitly, even when a patient is also a doctor.
create function public.get_my_chart() returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;
begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 if pid is null then return null;end if;
 return public.get_patient_chart(pid);
end $$;
revoke all on function public.get_my_chart() from public,anon;
grant execute on function public.get_my_chart() to authenticated;
commit;

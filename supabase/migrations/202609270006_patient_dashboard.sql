begin;
create function public.patient_dashboard() returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;result jsonb;
begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 if pid is null then return null;end if;
 select jsonb_build_object('patient_id',pid,
 'active_prescriptions',(select count(*) from public.documents d where d.patient_id=pid and d.kind='PRESCRIPTION' and private.document_status(d)='ISSUED'),
 'active_referrals',(select count(*) from public.documents d where d.patient_id=pid and d.kind='REFERRAL' and private.document_status(d) in ('ISSUED','BOOKED','IN_PROGRESS')),
 'attachments',(select count(*) from public.document_attachments a where a.patient_id=pid and a.status='AVAILABLE'),
 'unread_notifications',(select count(*) from public.notifications n where n.user_id=auth.uid() and n.read_at is null),
 'active_therapy',coalesce((select jsonb_agg(jsonb_build_object('id',pm.id,'name',m.name,'strength',m.strength,'dosage',pm.dosage,'frequency',pm.frequency)) from public.patient_medications pm join public.medications m on m.id=pm.medication_id where pm.patient_id=pid and pm.status='ACTIVE' and pm.start_date<=current_date and (pm.end_date is null or pm.end_date>=current_date)),'[]'),
 'doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'specialty',d.specialty,'institution',i.name,'is_primary',pd.is_primary)) from public.patient_doctors pd join public.doctors d on d.id=pd.doctor_id join public.institutions i on i.id=d.institution_id where pd.patient_id=pid and pd.revoked_at is null and d.active and i.active),'[]'),
 'recent_documents',coalesce((select jsonb_agg(x) from (select d.id,d.number,d.kind,d.issued_at,private.document_status(d) status from public.documents d where d.patient_id=pid order by d.issued_at desc limit 5)x),'[]'),
 'recent_activity',coalesce((select jsonb_agg(x) from (select n.id,n.message,n.created_at,n.read_at from public.notifications n where n.user_id=auth.uid() order by n.created_at desc limit 5)x),'[]')) into result;
 perform private.audit_event('PATIENT_DASHBOARD_VIEWED','patients',pid);return result;
end $$;
revoke all on function public.patient_dashboard() from public,anon;
grant execute on function public.patient_dashboard() to authenticated;

create function private.notify_expiring_documents() returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
 insert into public.notifications(user_id,document_id,message,event_key)
 select p.user_id,d.id,case d.kind when 'PRESCRIPTION' then 'Recept ' else 'Uputnica ' end||d.number||' istječe '||to_char(d.expires_on,'DD.MM.YYYY.')||'.','expiry:'||d.id
 from public.documents d join public.patients p on p.id=d.patient_id
 where p.user_id is not null and p.archived_at is null and d.kind in ('PRESCRIPTION','REFERRAL') and d.status in ('ISSUED','BOOKED') and d.expires_on between current_date and current_date+7
 on conflict(event_key) do nothing;
 get diagnostics inserted=row_count;return inserted;
end $$;
revoke all on function private.notify_expiring_documents() from public,anon,authenticated;
-- Production Supabase supports pg_cron. Local SQL test engines may not.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute $job$select cron.schedule('ez-document-expiry','0 6 * * *','select private.notify_expiring_documents()')$job$;
 end if;
end $$;
commit;

begin;
-- The queue remains authoritative. pg_net sends only after the booking commits.
alter table private.notification_delivery_config add column dispatch_url text;
alter table private.notification_delivery_config add column dispatch_token_secret_name text;

create function public.configure_notification_dispatch(dispatch_url text,token_secret_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if dispatch_url is null and token_secret_name is null then
  update private.notification_delivery_config set dispatch_url=null,dispatch_token_secret_name=null where id;
  return;
 end if;
 if dispatch_url is null or dispatch_url !~ '^https://[a-z0-9]+\.supabase\.co/functions/v1/notifications-dispatch$'
  or token_secret_name is null or length(token_secret_name) not between 1 and 100 then
  raise exception 'Invalid notification dispatch configuration';
 end if;
 if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
  or to_regclass('vault.decrypted_secrets') is null then
  raise exception 'Notification dispatch prerequisites unavailable';
 end if;
 if not exists(select 1 from vault.decrypted_secrets s where s.name=token_secret_name and length(s.decrypted_secret)>=32) then
  raise exception 'Notification dispatch secret unavailable';
 end if;
 update private.notification_delivery_config c
 set dispatch_url=configure_notification_dispatch.dispatch_url,dispatch_token_secret_name=token_secret_name where c.id;
end $$;

create function private.dispatch_new_booking_emails() returns trigger
language plpgsql security definer set search_path='' as $$
declare endpoint text;secret_name text;job_token text;
begin
 -- Portal-only notifications and reminders do not recursively wake the worker.
 if not exists(
  select 1 from new_email_jobs o
  left join private.contact_appointment_email_events e on e.id=o.contact_event_id
  left join public.notifications n on n.id=o.notification_id
  where o.status='PENDING' and coalesce(e.event_type,n.email_event) in ('BOOKED','RESCHEDULED','CANCELLED')
 ) then return null;end if;
 select c.dispatch_url,c.dispatch_token_secret_name into endpoint,secret_name
 from private.notification_delivery_config c where c.id and c.email_available;
 if endpoint is null or secret_name is null then return null;end if;
 begin
  select s.decrypted_secret into job_token from vault.decrypted_secrets s where s.name=secret_name;
  if job_token is null then raise exception 'Dispatch unavailable';end if;
  perform net.http_post(url:=endpoint,body:='{}'::jsonb,
   headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||job_token),
   timeout_milliseconds:=10000);
 exception when others then
  -- Do not expose SQL errors, Vault values or recipient data. Cron will retry.
  raise log 'NOTIFICATION_IMMEDIATE_DISPATCH_FAILED';
 end;
 return null;
end $$;
create trigger dispatch_new_booking_emails after insert on private.notification_email_outbox
referencing new table as new_email_jobs for each statement execute function private.dispatch_new_booking_emails();
revoke all on function private.dispatch_new_booking_emails() from public,anon,authenticated;
revoke all on function public.configure_notification_dispatch(text,text) from public,anon,authenticated;
grant execute on function public.configure_notification_dispatch(text,text) to service_role;
commit;

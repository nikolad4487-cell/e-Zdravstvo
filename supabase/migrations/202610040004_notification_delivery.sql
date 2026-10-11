begin;
create table public.notification_preferences(
  id uuid not null unique default gen_random_uuid(),user_id uuid primary key references public.profiles(id),
  email_enabled boolean not null default false,appointment_reminders boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
revoke all on public.notification_preferences from anon,authenticated;
create trigger audit_change after insert or update on public.notification_preferences for each row execute function private.audit_change();
create table private.notification_delivery_config(id boolean primary key default true check(id),email_available boolean not null default false);
insert into private.notification_delivery_config(id) values(true);
create table private.notification_email_outbox(
  id uuid primary key default gen_random_uuid(),notification_id uuid not null unique references public.notifications(id),
  user_id uuid not null references public.profiles(id),status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','CANCELLED')),
  attempts integer not null default 0,next_attempt_at timestamptz not null default now(),locked_until timestamptz,lease_id uuid,
  sent_at timestamptz,provider_id text,created_at timestamptz not null default now()
);
create index notification_email_pending on private.notification_email_outbox(next_attempt_at) where status in ('PENDING','SENDING');
create table private.appointment_reminder_keys(
  kind text not null,entity_id uuid not null,starts_at timestamptz not null,user_id uuid not null references public.profiles(id),primary key(kind,entity_id,starts_at,user_id)
);
create function public.notification_preferences() returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
  return jsonb_build_object('email_enabled',coalesce((select p.email_enabled from public.notification_preferences p where p.user_id=auth.uid()),false),'appointment_reminders',coalesce((select p.appointment_reminders from public.notification_preferences p where p.user_id=auth.uid()),true),'email_available',(select c.email_available from private.notification_delivery_config c where c.id));
end $$;
create function public.save_notification_preferences(email_enabled boolean,appointment_reminders boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
  if email_enabled is null or appointment_reminders is null then raise exception 'Invalid preferences';end if;
  if email_enabled and not (select c.email_available from private.notification_delivery_config c where c.id) then raise exception 'Email service unavailable';end if;
  insert into public.notification_preferences(user_id,email_enabled,appointment_reminders) values(auth.uid(),email_enabled,appointment_reminders)
  on conflict on constraint notification_preferences_pkey do update set email_enabled=excluded.email_enabled,appointment_reminders=excluded.appointment_reminders,updated_at=now();
  if not email_enabled then update private.notification_email_outbox set status='CANCELLED' where user_id=auth.uid() and status='PENDING';end if;
end $$;
create function private.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (select c.email_available from private.notification_delivery_config c where c.id) and exists(select 1 from public.notification_preferences p where p.user_id=new.user_id and p.email_enabled) then
    insert into private.notification_email_outbox(notification_id,user_id) values(new.id,new.user_id) on conflict(notification_id) do nothing;
  end if;return new;
end $$;
create trigger queue_email after insert on public.notifications for each row execute function private.queue_notification_email();
create function public.configure_notification_delivery(enabled boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  if enabled is null then raise exception 'Invalid configuration';end if;
  update private.notification_delivery_config set email_available=enabled where id;
end $$;
create function public.generate_appointment_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare entry record;inserted integer;total integer:=0;
begin
  for entry in
    select 'CLINIC' kind,a.id,a.starts_at,p.user_id from public.appointments a join public.patients p on p.id=a.patient_id
    where a.status='SCHEDULED' and a.starts_at>now() and a.starts_at<=now()+interval '24 hours' and p.user_id is not null and p.archived_at is null
    union all
    select 'HOSPITAL',b.id,sl.starts_at,p.user_id from public.hospital_bookings b join public.hospital_slots sl on sl.id=b.slot_id join public.patients p on p.id=b.patient_id
    where b.status='BOOKED' and sl.starts_at>now() and sl.starts_at<=now()+interval '24 hours' and p.user_id is not null and p.archived_at is null
  loop
    if not coalesce((select appointment_reminders from public.notification_preferences where user_id=entry.user_id),true) then continue;end if;
    insert into private.appointment_reminder_keys(kind,entity_id,starts_at,user_id) values(entry.kind,entry.id,entry.starts_at,entry.user_id) on conflict do nothing;
    get diagnostics inserted=row_count;
    if inserted=1 then
      insert into public.notifications(user_id,message) values(entry.user_id,'Podsjetnik: imate zakazan termin '||to_char(entry.starts_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||'. Detalji su dostupni u vašem portalu.');
      total:=total+1;
    end if;
  end loop;return total;
end $$;
create function public.claim_notification_emails(batch_size integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if batch_size is null or batch_size not between 1 and 100 then raise exception 'Invalid batch';end if;
  if not (select c.email_available from private.notification_delivery_config c where c.id) then return '[]'::jsonb;end if;
  update private.notification_email_outbox set status='FAILED' where status='SENDING' and locked_until<now() and attempts>=5;
  update private.notification_email_outbox o set status='CANCELLED' where o.status in ('PENDING','SENDING') and not exists(select 1 from public.notification_preferences p where p.user_id=o.user_id and p.email_enabled);
  with picked as (
    select o.id from private.notification_email_outbox o join auth.users u on u.id=o.user_id
    where (o.status='PENDING' or (o.status='SENDING' and o.locked_until<now())) and o.next_attempt_at<=now() and o.attempts<5
      and u.email is not null and u.email_confirmed_at is not null
    order by o.created_at,o.id for update of o skip locked limit batch_size
  ), claimed as (
    update private.notification_email_outbox o set status='SENDING',attempts=o.attempts+1,locked_until=now()+interval '5 minutes',lease_id=gen_random_uuid()
    from picked where o.id=picked.id returning o.id,o.user_id,o.lease_id
  ) select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'lease_id',c.lease_id,'email',u.email)),'[]') into result from claimed c join auth.users u on u.id=c.user_id;
  return result;
end $$;
create function public.complete_notification_email(job_id uuid,lease_id uuid,succeeded boolean,provider_id text default null,retry_seconds integer default 60)
returns void language plpgsql security definer set search_path='' as $$
begin
  if succeeded is null or retry_seconds is null or retry_seconds not between 1 and 86400 then raise exception 'Invalid completion';end if;
  update private.notification_email_outbox o set status=case when succeeded then 'SENT' when o.attempts>=5 then 'FAILED' else 'PENDING' end,
    sent_at=case when succeeded then now() else null end,provider_id=case when succeeded then left(complete_notification_email.provider_id,200) else null end,
    next_attempt_at=now()+make_interval(secs=>retry_seconds),locked_until=null,lease_id=null
  where o.id=job_id and o.lease_id=complete_notification_email.lease_id and o.status='SENDING' and o.locked_until>=now();
end $$;
revoke all on function private.queue_notification_email() from public,anon,authenticated;
revoke all on function public.notification_preferences(),public.save_notification_preferences(boolean,boolean) from public,anon;
grant execute on function public.notification_preferences(),public.save_notification_preferences(boolean,boolean) to authenticated;
revoke all on function public.configure_notification_delivery(boolean),public.generate_appointment_reminders(),public.claim_notification_emails(integer),public.complete_notification_email(uuid,uuid,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.configure_notification_delivery(boolean),public.generate_appointment_reminders(),public.claim_notification_emails(integer),public.complete_notification_email(uuid,uuid,boolean,text,integer) to service_role;
commit;

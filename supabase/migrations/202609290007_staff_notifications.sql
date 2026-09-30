begin;
-- Deliver a content-free invalidation to staff as well as patient portals.
create function private.notification_schedule_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.schedule_events(user_id,revision) values(new.user_id,gen_random_uuid()) on conflict(user_id) do update set revision=excluded.revision;return new;end $$;
create trigger notification_schedule_event after insert on public.notifications for each row execute function private.notification_schedule_event();
revoke all on function private.notification_schedule_event() from public,anon,authenticated;
commit;

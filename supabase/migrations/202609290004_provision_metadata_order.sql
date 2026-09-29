begin;
-- Auth may persist trusted app metadata after inserting auth.users.
create function private.provision_metadata_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if new.raw_app_meta_data->>'admin_provisioned'='true'
 and new.raw_app_meta_data->>'provision_request_id' is not null
 and old.raw_app_meta_data->>'provision_request_id' is null then
 update public.profiles set must_change_password=true,is_demo=coalesce((new.raw_app_meta_data->>'is_demo')::boolean,false) where id=new.id;
 end if;return new;end $$;
create trigger account_provision_metadata_changed after update of raw_app_meta_data on auth.users for each row execute function private.provision_metadata_changed();
revoke all on function private.provision_metadata_changed() from public,anon,authenticated;
create or replace function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if coalesce(old.encrypted_password,'')<>'' and old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'' then
 update public.profiles set must_change_password=false where id=new.id and must_change_password;
 end if;return new;end $$;
-- Repair accounts provisioned before this ordering fix; require a password change.
update public.profiles p set must_change_password=true,is_demo=coalesce((u.raw_app_meta_data->>'is_demo')::boolean,false)
from auth.users u where u.id=p.id and u.raw_app_meta_data->>'admin_provisioned'='true'
and exists(select 1 from private.account_provision_requests r where r.id::text=u.raw_app_meta_data->>'provision_request_id');
commit;

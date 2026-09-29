begin;
alter table public.profiles add column must_change_password boolean not null default false;
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$begin
 insert into public.profiles(id,first_name,last_name,must_change_password,is_demo) values(new.id,left(coalesce(new.raw_user_meta_data->>'first_name',''),100),left(coalesce(new.raw_user_meta_data->>'last_name',''),100),coalesce((new.raw_app_meta_data->>'admin_provisioned')::boolean,false),coalesce((new.raw_app_meta_data->>'is_demo')::boolean,false));return new;end $$;
create function private.password_changed() returns trigger language plpgsql security definer set search_path='' as $$begin
 if old.encrypted_password is distinct from new.encrypted_password and coalesce(new.encrypted_password,'')<>'' then update public.profiles set must_change_password=false where id=new.id and must_change_password;end if;return new;end $$;
create trigger account_password_changed after update of encrypted_password on auth.users for each row execute function private.password_changed();
create or replace function private.has_role(requested public.app_role,scope uuid default null) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_roles r join public.profiles p on p.id=r.user_id where r.user_id=(select auth.uid()) and not p.must_change_password and r.role=requested and (scope is null or r.institution_id=scope)
 and (r.institution_id is null or exists(select 1 from public.institution_users m join public.institutions i on i.id=m.institution_id where m.user_id=r.user_id and m.institution_id=r.institution_id and m.active and i.active and i.archived_at is null)));
$$;
create table private.account_provision_requests(id uuid primary key default gen_random_uuid(),actor_id uuid not null references public.profiles(id),request_id uuid not null,email text not null,first_name text not null,last_name text not null,is_demo boolean not null,user_id uuid references public.profiles(id),completed_at timestamptz,created_at timestamptz not null default now(),unique(actor_id,request_id));
revoke all on private.account_provision_requests from public,anon,authenticated,service_role;
create function public.begin_account_provision(request_id uuid,email text,first_name text,last_name text,demo_account boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare job private.account_provision_requests;recovered uuid;begin
 if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null or length(trim(coalesce(first_name,''))) not between 1 and 100 or length(trim(coalesce(last_name,''))) not between 1 and 100 or length(coalesce(email,''))>254 or coalesce(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or demo_account is null then raise exception 'Invalid account details';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,61));
 select * into job from private.account_provision_requests r where r.actor_id=auth.uid() and r.request_id=begin_account_provision.request_id;
 if job.id is null then
 if (select count(*) from private.account_provision_requests where actor_id=auth.uid() and created_at>now()-interval '1 hour')>=20 then raise exception 'Account creation limit reached';end if;
 insert into private.account_provision_requests(actor_id,request_id,email,first_name,last_name,is_demo) values(auth.uid(),request_id,lower(trim(email)),trim(first_name),trim(last_name),demo_account) returning * into job;
 perform private.audit_event('ACCOUNT_CREATION_REQUESTED','profiles',null);
 elsif job.email<>lower(trim(email)) or job.first_name<>trim(first_name) or job.last_name<>trim(last_name) or job.is_demo<>demo_account then raise exception 'Request already used for another account';end if;
 select u.id into recovered from auth.users u where u.raw_app_meta_data->>'provision_request_id'=job.id::text and u.raw_app_meta_data->>'provision_actor_id'=auth.uid()::text and lower(u.email)=job.email;
 return to_jsonb(job)||jsonb_build_object('user_id',coalesce(job.user_id,recovered));
end $$;
create function public.finish_account_provision(provision_id uuid,target_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare job private.account_provision_requests;begin
 if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 select * into job from private.account_provision_requests where id=provision_id and actor_id=auth.uid() for update;
 if job.id is null or not exists(select 1 from auth.users u where u.id=target_user and lower(u.email)=job.email and u.raw_app_meta_data->>'provision_request_id'=job.id::text and u.raw_app_meta_data->>'provision_actor_id'=auth.uid()::text) then raise exception 'Invalid provisioned identity';end if;
 if job.completed_at is not null then if job.user_id is distinct from target_user then raise exception 'Account already completed';end if;return;end if;
 update private.account_provision_requests set user_id=target_user,completed_at=now() where id=job.id;
 perform private.audit_event('ACCOUNT_CREATED','profiles',target_user);
end $$;
revoke all on function private.password_changed() from public,anon,authenticated;
revoke all on function public.begin_account_provision(uuid,text,text,text,boolean),public.finish_account_provision(uuid,uuid) from public,anon;
grant execute on function public.begin_account_provision(uuid,text,text,text,boolean),public.finish_account_provision(uuid,uuid) to authenticated;
commit;

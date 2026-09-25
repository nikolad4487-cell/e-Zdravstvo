-- Phase 1: identity, institutions, scoped RBAC, audit. Clinical tables arrive
-- with their workflows, permissions and migration tests in subsequent phases.
begin;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

create type public.app_role as enum ('SYSTEM_ADMIN','INSTITUTION_ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECHNICIAN','PATIENT','SCHOOL_ADMIN');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  first_name text not null default '' check (length(first_name) <= 100),
  last_name text not null default '' check (length(last_name) <= 100),
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.institutions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 200),
  code text not null unique check (code ~ '^[A-Z0-9_-]{2,40}$'),
  address text, city text, postal_code text, phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  archived_at timestamptz
);
create table public.institution_departments (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  name text not null check (length(trim(name)) between 2 and 200),
  code text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict, archived_at timestamptz,
  unique(institution_id, code)
);
create table public.institution_users (
  id uuid primary key default gen_random_uuid(),
  institution_id uuid not null references public.institutions(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  unique(institution_id, user_id)
);
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.app_role not null,
  institution_id uuid references public.institutions(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict,
  constraint scoped_roles check ((role in ('SYSTEM_ADMIN','PATIENT','SCHOOL_ADMIN') and institution_id is null) or (role in ('INSTITUTION_ADMIN','DOCTOR','NURSE','PHARMACIST','LAB_TECHNICIAN') and institution_id is not null)),
  foreign key(institution_id, user_id) references public.institution_users(institution_id, user_id) on delete restrict,
  unique nulls not distinct(user_id, role, institution_id)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete restrict,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  created_at timestamptz not null default now(),
  ip inet,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);
create index institution_users_user_idx on public.institution_users(user_id, institution_id) where active;
create index user_roles_user_idx on public.user_roles(user_id, role);
create index user_roles_institution_idx on public.user_roles(institution_id);
create index departments_institution_idx on public.institution_departments(institution_id);
create index audit_logs_time_idx on public.audit_logs(created_at desc);
create index audit_logs_actor_idx on public.audit_logs(user_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs(entity_type, entity_id);

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
do $$ declare t text; begin foreach t in array array['profiles','institutions','institution_departments','institution_users','user_roles'] loop
  execute format('create trigger touch_updated_at before update on public.%I for each row execute function private.touch_updated_at()',t);
end loop; end $$;

-- Do not trust raw_user_meta_data for roles or admin flags.
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, first_name, last_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'first_name',''),100), left(coalesce(new.raw_user_meta_data->>'last_name',''),100));
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create function private.has_role(requested public.app_role, scope uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = requested
    and (scope is null or r.institution_id = scope)
    and (r.institution_id is null or exists(select 1 from public.institution_users m join public.institutions i on i.id = m.institution_id
      where m.user_id = r.user_id and m.institution_id = r.institution_id and m.active and i.active and i.archived_at is null)));
$$;
create function private.is_member(scope uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.institution_users m join public.institutions i on i.id=m.institution_id
    where m.user_id=(select auth.uid()) and m.institution_id=scope and m.active and i.active and i.archived_at is null);
$$;

alter table public.profiles enable row level security;
alter table public.institutions enable row level security;
alter table public.institution_departments enable row level security;
alter table public.institution_users enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;

-- Deny by default, including the anonymous role. No table accepts browser inserts.
revoke all on public.profiles, public.institutions, public.institution_departments, public.institution_users, public.user_roles, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.institutions, public.institution_departments, public.institution_users, public.user_roles, public.audit_logs to authenticated;
grant update(first_name,last_name) on public.profiles to authenticated;
grant all on public.profiles, public.institutions, public.institution_departments, public.institution_users, public.user_roles, public.audit_logs to service_role;
create policy profile_read on public.profiles for select to authenticated using (id=(select auth.uid()) or private.has_role('SYSTEM_ADMIN') or exists(select 1 from public.institution_users m where m.user_id=profiles.id and private.has_role('INSTITUTION_ADMIN',m.institution_id)));
create policy profile_update on public.profiles for update to authenticated using(id=(select auth.uid())) with check(id=(select auth.uid()));
create policy institution_read on public.institutions for select to authenticated using(private.has_role('SYSTEM_ADMIN') or private.is_member(id));
create policy department_read on public.institution_departments for select to authenticated using(private.has_role('SYSTEM_ADMIN') or private.is_member(institution_id));
create policy membership_read on public.institution_users for select to authenticated using(user_id=(select auth.uid()) or private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id));
create policy roles_read on public.user_roles for select to authenticated using(
  (user_id=(select auth.uid()) and (institution_id is null or private.is_member(institution_id)))
  or (user_id<>(select auth.uid()) and (private.has_role('SYSTEM_ADMIN') or (institution_id is not null and private.has_role('INSTITUTION_ADMIN',institution_id))))
);
create policy audit_read on public.audit_logs for select to authenticated using(private.has_role('SYSTEM_ADMIN'));

-- Store action metadata, never row snapshots containing personal or clinical data.
create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(user_id, action, entity_type, entity_id, metadata)
  values(auth.uid(), upper(tg_table_name)||'_'||tg_op, tg_table_name, coalesce(new.id,old.id), jsonb_build_object('source','database_trigger'));
  return coalesce(new,old);
end; $$;
do $$ declare t text; begin foreach t in array array['profiles','institutions','institution_departments','institution_users','user_roles'] loop
  execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
end loop; end $$;

create function private.prevent_audit_mutation() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Audit records are append-only'; end; $$;
create trigger audit_immutable before update or delete on public.audit_logs for each row execute function private.prevent_audit_mutation();
create trigger audit_no_truncate before truncate on public.audit_logs for each statement execute function private.prevent_audit_mutation();
revoke truncate on public.audit_logs from service_role;

-- Only trusted bootstrap scripts hold service_role. UI callers cannot forge actors.
create function public.create_institution(institution_name text, institution_code text, institution_city text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501'; end if;
  insert into public.institutions(name,code,city,created_by) values(institution_name,institution_code,institution_city,auth.uid()) returning id into result;
  return result;
end; $$;
create function public.set_membership(target_user uuid, target_institution uuid, enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',target_institution)) then raise exception 'Forbidden' using errcode='42501'; end if;
  if not private.has_role('SYSTEM_ADMIN') and exists(select 1 from public.user_roles where user_id=target_user and institution_id=target_institution and role='INSTITUTION_ADMIN') then raise exception 'Only system administrator can modify administrator membership' using errcode='42501'; end if;
  insert into public.institution_users(user_id,institution_id,active,created_by) values(target_user,target_institution,enabled,auth.uid())
  on conflict(institution_id,user_id) do update set active=excluded.active;
end; $$;
create function public.assign_role(target_user uuid, requested public.app_role, target_institution uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role('SYSTEM_ADMIN') then
    if target_institution is null or requested not in ('DOCTOR','NURSE','PHARMACIST','LAB_TECHNICIAN') or not private.has_role('INSTITUTION_ADMIN',target_institution) then raise exception 'Forbidden' using errcode='42501'; end if;
  end if;
  if target_institution is not null and not exists(select 1 from public.institution_users where institution_id=target_institution and user_id=target_user and active) then raise exception 'Active membership required'; end if;
  insert into public.user_roles(user_id,role,institution_id,created_by) values(target_user,requested,target_institution,auth.uid()) on conflict do nothing;
end; $$;
create function public.revoke_role(assignment_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare assignment public.user_roles;
begin
  select * into assignment from public.user_roles where id=assignment_id for update;
  if not found then raise exception 'Role not found'; end if;
  if not private.has_role('SYSTEM_ADMIN') and not (assignment.institution_id is not null and assignment.role in ('DOCTOR','NURSE','PHARMACIST','LAB_TECHNICIAN') and private.has_role('INSTITUTION_ADMIN',assignment.institution_id)) then raise exception 'Forbidden' using errcode='42501'; end if;
  if assignment.role='SYSTEM_ADMIN' and assignment.user_id=auth.uid() then raise exception 'Cannot revoke your own system administrator role'; end if;
  delete from public.user_roles where id=assignment_id;
end; $$;
create function public.record_session_event(event text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or event not in ('LOGIN_SUCCESS','LOGOUT') then raise exception 'Forbidden' using errcode='42501'; end if;
  insert into public.audit_logs(user_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),event,'session',auth.uid(),'{"source":"authenticated_client","authoritative_auth_log":"auth.audit_log_entries"}'::jsonb);
end; $$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.has_role(public.app_role,uuid), private.is_member(uuid) to authenticated;
revoke all on function public.create_institution(text,text,text), public.set_membership(uuid,uuid,boolean), public.assign_role(uuid,public.app_role,uuid), public.revoke_role(uuid), public.record_session_event(text) from public, anon;
grant execute on function public.create_institution(text,text,text), public.set_membership(uuid,uuid,boolean), public.assign_role(uuid,public.app_role,uuid), public.revoke_role(uuid), public.record_session_event(text) to authenticated;
commit;

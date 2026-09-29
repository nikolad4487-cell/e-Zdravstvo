begin;
create function private.can_admin_patient(pid uuid) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.patients p where p.id=pid and p.archived_at is null and (private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',p.institution_id)))$$;
create function public.admin_patients(search_term text default '',page_number integer default 0) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;begin
 if not(private.has_role('SYSTEM_ADMIN') or exists(select 1 from public.institutions i where private.has_role('INSTITUTION_ADMIN',i.id))) then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number<0 or page_number>10000 then raise exception 'Invalid page';end if;
 select coalesce(jsonb_agg(x),'[]') into result from(select p.id,p.patient_number,p.first_name,p.last_name,i.name institution,p.user_id is not null account_linked from public.patients p join public.institutions i on i.id=p.institution_id where private.can_admin_patient(p.id) and concat_ws(' ',p.first_name,p.last_name,p.patient_number) ilike '%'||left(search_term,100)||'%' order by p.last_name,p.id limit 50 offset page_number*50)x;
 perform private.audit_event('CARE_ADMIN_PATIENTS_VIEWED','patients',null);return result;
end $$;
create function public.admin_care_team(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare org uuid;result jsonb;begin
 if not private.can_admin_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;select institution_id into org from public.patients where id=patient_id;
 select jsonb_build_object('doctors',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.display_name,'assigned',pd.id is not null and pd.revoked_at is null,'primary',coalesce(pd.is_primary,false) and pd.revoked_at is null,'enabled',d.active and exists(select 1 from public.user_roles r join public.institution_users u on u.user_id=r.user_id and u.institution_id=r.institution_id where r.user_id=d.user_id and r.institution_id=org and r.role='DOCTOR' and u.active)) order by d.display_name) from public.doctors d left join public.patient_doctors pd on pd.doctor_id=d.id and pd.patient_id=admin_care_team.patient_id where d.institution_id=org),'[]'),
 'nurses',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.first_name||' '||p.last_name,'assigned',ps.id is not null and ps.revoked_at is null,'primary',false,'enabled',u.active and exists(select 1 from public.user_roles r where r.user_id=p.id and r.institution_id=org and r.role='NURSE')) order by p.last_name) from public.profiles p join public.institution_users u on u.user_id=p.id and u.institution_id=org left join public.patient_staff ps on ps.user_id=p.id and ps.patient_id=admin_care_team.patient_id where exists(select 1 from public.user_roles r where r.user_id=p.id and r.institution_id=org and r.role='NURSE') or ps.id is not null),'[]')) into result;
 perform private.audit_event('CARE_TEAM_VIEWED','patients',patient_id);return result;
end $$;
create function public.set_patient_care(patient_id uuid,kind text,target_id uuid,enabled boolean,primary_doctor boolean,reason text) returns void language plpgsql security definer set search_path='' as $$
declare org uuid;target_user uuid;begin
 if not private.can_admin_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if enabled is null or primary_doctor is null or length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Reason required';end if;
 select institution_id into org from public.patients where id=patient_id for update;
 if kind='DOCTOR' then
 select user_id into target_user from public.doctors where id=target_id and institution_id=org and (not enabled or active);
 if target_user is null or (enabled and not exists(select 1 from public.user_roles r join public.institution_users u on u.user_id=r.user_id and u.institution_id=r.institution_id where r.user_id=target_user and r.institution_id=org and r.role='DOCTOR' and u.active)) then raise exception 'Doctor unavailable';end if;
 if enabled and primary_doctor then update public.patient_doctors set is_primary=false where patient_doctors.patient_id=set_patient_care.patient_id and revoked_at is null and is_primary;end if;
 insert into public.patient_doctors(patient_id,doctor_id,is_primary,revoked_at,created_by) values(patient_id,target_id,enabled and primary_doctor,case when enabled then null else now() end,auth.uid()) on conflict on constraint patient_doctors_patient_id_doctor_id_key do update set is_primary=excluded.is_primary,revoked_at=excluded.revoked_at;
 elsif kind='NURSE' then
 if not exists(select 1 from public.institution_users u where u.user_id=target_id and u.institution_id=org and (not enabled or u.active)) or (enabled and not exists(select 1 from public.user_roles r where r.user_id=target_id and r.institution_id=org and r.role='NURSE')) then raise exception 'Nurse unavailable';end if;
 insert into public.patient_staff(patient_id,user_id,institution_id,revoked_at,created_by) values(patient_id,target_id,org,case when enabled then null else now() end,auth.uid()) on conflict on constraint patient_staff_patient_id_user_id_key do update set revoked_at=excluded.revoked_at;
 else raise exception 'Invalid care role';end if;
 insert into public.audit_logs(user_id,action,entity_type,entity_id,metadata) values(auth.uid(),case when enabled then 'CARE_ACCESS_GRANTED' else 'CARE_ACCESS_REVOKED' end,'patients',patient_id,jsonb_build_object('kind',kind,'target_id',target_id,'primary',enabled and primary_doctor,'reason',trim(reason)));
end $$;
create function public.link_patient_account(patient_id uuid,target_user uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare p public.patients;begin
 if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if length(trim(coalesce(reason,''))) not between 5 and 500 then raise exception 'Reason required';end if;
 select * into p from public.patients where id=patient_id and archived_at is null for update;
 if p.id is null or p.user_id is not null then raise exception 'Only unlinked records may be linked';end if;
 if not exists(select 1 from public.user_roles where user_id=target_user and role='PATIENT' and institution_id is null) then raise exception 'Patient role required';end if;
 update public.patients set user_id=target_user where id=patient_id;
 insert into public.audit_logs(user_id,action,entity_type,entity_id,metadata) values(auth.uid(),'PATIENT_ACCOUNT_LINKED','patients',patient_id,jsonb_build_object('target_user',target_user,'reason',trim(reason)));
end $$;
revoke all on function private.can_admin_patient(uuid) from public,anon,authenticated;
revoke all on function public.admin_patients(text,integer),public.admin_care_team(uuid),public.set_patient_care(uuid,text,uuid,boolean,boolean,text),public.link_patient_account(uuid,uuid,text) from public,anon;
grant execute on function public.admin_patients(text,integer),public.admin_care_team(uuid),public.set_patient_care(uuid,text,uuid,boolean,boolean,text),public.link_patient_account(uuid,uuid,text) to authenticated;
commit;

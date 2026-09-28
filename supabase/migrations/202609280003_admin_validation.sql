begin;
create or replace function public.save_clinic(institution_id uuid,clinic_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare cid uuid;begin
 if not(private.has_role('SYSTEM_ADMIN') or private.has_role('INSTITUTION_ADMIN',institution_id)) then raise exception 'Forbidden' using errcode='42501';end if;
 if clinic_id is null then
 insert into public.clinics(institution_id,name,code,address,city,phone,email,active,created_by) values(institution_id,trim(data->>'name'),trim(data->>'code'),coalesce(data->>'address',''),coalesce(data->>'city',''),coalesce(data->>'phone',''),coalesce(data->>'email',''),coalesce((data->>'active')::boolean,true),auth.uid()) returning id into cid;
 else
 update public.clinics c set name=trim(data->>'name'),code=trim(data->>'code'),address=coalesce(data->>'address',''),city=coalesce(data->>'city',''),phone=coalesce(data->>'phone',''),email=coalesce(data->>'email',''),active=coalesce((data->>'active')::boolean,true) where c.id=clinic_id and c.institution_id=save_clinic.institution_id returning id into cid;
 if cid is null then raise exception 'Clinic not found';end if;end if;return cid;
end $$;
create or replace function public.save_excuse_catalog(catalog text,entry_id uuid,data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;begin
 if not private.has_role('SYSTEM_ADMIN') then raise exception 'Forbidden' using errcode='42501';end if;
 if length(trim(coalesce(data->>'name',''))) not between 2 and 200 then raise exception 'Invalid catalog name';end if;
 if entry_id is null and (length(trim(coalesce(data->>'code',''))) not between 1 and 40 or length(coalesce(data->>'coding_system','LOCAL')) not between 1 and 40) then raise exception 'Invalid catalog code';end if;
 if catalog='reason' then
 if entry_id is null then insert into public.excuse_reasons(code,name,created_by) values(upper(trim(data->>'code')),trim(data->>'name'),auth.uid()) returning id into result;
 else update public.excuse_reasons set name=trim(data->>'name'),active=coalesce((data->>'active')::boolean,true) where id=entry_id returning id into result;end if;
 elsif catalog='diagnosis' then
 if entry_id is null then insert into public.diagnoses(code,name,coding_system) values(upper(trim(data->>'code')),trim(data->>'name'),coalesce(nullif(data->>'coding_system',''),'LOCAL')) returning id into result;
 else update public.diagnoses set name=trim(data->>'name'),active=coalesce((data->>'active')::boolean,true) where id=entry_id returning id into result;end if;
 else raise exception 'Invalid catalog';end if;if result is null then raise exception 'Entry not found';end if;return result;
end $$;
commit;

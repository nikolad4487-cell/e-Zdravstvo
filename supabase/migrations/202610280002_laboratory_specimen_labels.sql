begin;
create sequence private.laboratory_sample_number;
create table public.laboratory_samples(
 id uuid primary key default gen_random_uuid(),order_id uuid not null references public.laboratory_orders(id),
 code text not null unique default('EZ-UZ-'||extract(year from (now() at time zone 'Europe/Zagreb'))::text||'-'||lpad(nextval('private.laboratory_sample_number')::text,8,'0')),
 specimen_code text not null,specimen_name text not null,collection_round integer not null check(collection_round>0),
 status text not null default 'REGISTERED' check(status in('REGISTERED','ACCEPTED','REJECTED')),
 reason text not null default '' check(length(reason)<=500),version integer not null default 1,
 replaces_sample_id uuid unique references public.laboratory_samples(id),request_id uuid not null,created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),
 unique(created_by,request_id)
);
create index laboratory_samples_order on public.laboratory_samples(order_id,collection_round,id);
create table public.laboratory_sample_label_events(id uuid primary key default gen_random_uuid(),sample_id uuid not null references public.laboratory_samples(id),status text not null,reason text not null,created_at timestamptz not null default now(),created_by uuid references public.profiles(id));
do $$declare t text;begin foreach t in array array['laboratory_samples','laboratory_sample_label_events'] loop
 execute format('alter table public.%I enable row level security',t);execute format('revoke all on public.%I from public,anon,authenticated',t);execute format('grant all on public.%I to service_role',t);
 execute format('create trigger no_delete before delete on public.%I for each row execute function private.no_clinical_delete()',t);
end loop;end $$;
create trigger no_update before update on public.laboratory_sample_label_events for each row execute function private.preserve_sample_event();
create function private.record_sample_label_event() returns trigger language plpgsql security definer set search_path='' as $$begin
 if tg_op='INSERT' or new.status is distinct from old.status then insert into public.laboratory_sample_label_events(sample_id,status,reason,created_by) values(new.id,new.status,new.reason,auth.uid());end if;return new;end $$;
create trigger sample_label_event after insert or update on public.laboratory_samples for each row execute function private.record_sample_label_event();
create function private.guard_sample_label_processing() returns trigger language plpgsql security definer set search_path='' as $$begin
 if (new.sample_status='PROCESSING' or new.status='COMPLETED') and exists(select 1 from public.laboratory_samples any_sample where any_sample.order_id=new.id) and (not exists(select 1 from public.laboratory_samples current_sample where current_sample.order_id=new.id and current_sample.collection_round=new.sample_attempt) or exists(select 1 from public.laboratory_samples s where s.order_id=new.id and s.collection_round=new.sample_attempt and s.status<>'ACCEPTED' and not exists(select 1 from public.laboratory_samples next where next.replaces_sample_id=s.id))) then raise exception 'Svi uzorci ovog uzorkovanja moraju biti zaprimljeni prije obrade i izdavanja nalaza.';end if;return new;end $$;
create trigger z_sample_labels_guard before update on public.laboratory_orders for each row execute function private.guard_sample_label_processing();
create function public.list_laboratory_samples(order_id uuid,sample_code text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.laboratory_orders;result jsonb;
begin
 select * into o from public.laboratory_orders where id=order_id;
 if o.id is null or not private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if sample_code is null or length(sample_code)>80 then raise exception 'Invalid sample code';end if;
 select jsonb_build_object('order',jsonb_build_object('number',o.number,'patient_name',p.first_name||' '||p.last_name,'patient_number',p.patient_number,'status',o.status,'sample_status',o.sample_status,'attempt',o.sample_attempt),
 'items',(select coalesce(jsonb_agg(to_jsonb(s)||jsonb_build_object('replaced',exists(select 1 from public.laboratory_samples n where n.replaces_sample_id=s.id),'history',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor',pr.first_name||' '||pr.last_name) order by e.created_at desc,e.id desc),'[]') from public.laboratory_sample_label_events e left join public.profiles pr on pr.id=e.created_by where e.sample_id=s.id)) order by s.collection_round desc,s.created_at,s.id),'[]') from public.laboratory_samples s where s.order_id=o.id and (trim(sample_code)='' or s.code=upper(trim(sample_code))))) into result from public.patients p where p.id=o.patient_id;
 perform private.audit_event('LAB_SAMPLE_LABELS_VIEWED','laboratory_orders',o.id);return result;
end $$;
create function public.create_laboratory_sample(order_id uuid,specimen_code text,request_id uuid,replaces_sample_id uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o public.laboratory_orders;prior public.laboratory_samples;replaced public.laboratory_samples;canonical text;rid uuid;round integer;
begin
 perform 1 from public.hospital_bookings b where b.id=(select x.hospital_booking_id from public.laboratory_orders x where x.id=order_id) for update;
 select * into o from public.laboratory_orders where id=order_id for update;
 if o.id is null or not private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null then raise exception 'Request ID required';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,282));
 select * into prior from public.laboratory_samples s where s.created_by=auth.uid() and s.request_id=create_laboratory_sample.request_id;
 if prior.id is not null then if prior.order_id is distinct from order_id or prior.specimen_code is distinct from specimen_code or prior.replaces_sample_id is distinct from replaces_sample_id then raise exception 'Request changed' using errcode='40001';end if;return prior.id;end if;
 if o.sample_status='EXPECTED' then raise exception 'Najprije zaprimite pacijenta u dnevnom rasporedu.';end if;
 if o.status in('COMPLETED','CANCELLED') or o.sample_status='PROCESSING' then raise exception 'Zahtjev je zaključen ili u obradi. Prvo zatražite novo uzorkovanje.';end if;
 select c.name into canonical from public.medical_codes c where c.list_id='2.2.18' and c.code=specimen_code;
 if canonical is null then raise exception 'Odaberite vrstu uzorka iz šifrarnika.';end if;
 round:=case when o.sample_status='RECOLLECT' then o.sample_attempt+1 else greatest(1,o.sample_attempt) end;
 if replaces_sample_id is not null then
 select * into replaced from public.laboratory_samples where id=create_laboratory_sample.replaces_sample_id;
 if replaced.id is null or replaced.order_id<>o.id or replaced.status<>'REJECTED' or replaced.specimen_code<>specimen_code then raise exception 'Invalid replacement sample';end if;
 end if;
 insert into public.laboratory_samples(order_id,specimen_code,specimen_name,collection_round,replaces_sample_id,request_id,created_by) values(o.id,specimen_code,canonical,round,replaces_sample_id,request_id,auth.uid()) returning id into rid;
 perform private.audit_event('LAB_SAMPLE_LABEL_CREATED','laboratory_samples',rid);return rid;
end $$;
create function public.change_laboratory_sample(sample_id uuid,expected_version integer,new_status text,reason text default '') returns void language plpgsql security definer set search_path='' as $$
declare s public.laboratory_samples;o public.laboratory_orders;
begin
 select * into s from public.laboratory_samples where id=sample_id;
 perform 1 from public.hospital_bookings b where b.id=(select x.hospital_booking_id from public.laboratory_orders x where x.id=s.order_id) for update;
 select * into o from public.laboratory_orders where id=s.order_id for update;
 if o.id is null or not private.has_role('LAB_TECHNICIAN',o.laboratory_institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into s from public.laboratory_samples where id=sample_id for update;
 if s.version is distinct from expected_version then raise exception 'Sample changed' using errcode='40001';end if;
 if o.status in('COMPLETED','CANCELLED') or o.sample_status='PROCESSING' then raise exception 'Zahtjev je zaključen ili u obradi. Prvo zatražite novo uzorkovanje.';end if;
 if new_status is null or reason is null or length(reason)>500 or not ((s.status='REGISTERED' and new_status='ACCEPTED') or (s.status in('REGISTERED','ACCEPTED') and new_status='REJECTED' and length(trim(reason))>=5)) then raise exception 'Invalid sample transition or missing rejection reason';end if;
 update public.laboratory_samples set status=new_status,reason=case when new_status='REJECTED' then trim(change_laboratory_sample.reason) else '' end,version=version+1 where id=s.id;
 perform private.audit_event('LAB_SAMPLE_'||new_status,'laboratory_samples',s.id);
end $$;
create function public.laboratory_sample_label(sample_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.laboratory_samples;result jsonb;
begin
 select * into s from public.laboratory_samples where id=sample_id for share;
 if s.id is null then raise exception 'Forbidden' using errcode='42501';end if;
 result:=public.list_laboratory_samples(s.order_id,s.code);
 if s.status='REJECTED' or exists(select 1 from public.laboratory_samples n where n.replaces_sample_id=s.id) then raise exception 'Oznaka odbijenog ili zamijenjenog uzorka nije za ponovnu uporabu.';end if;
 perform private.audit_event('LAB_SAMPLE_LABEL_DOWNLOADED','laboratory_samples',s.id);return result;
end $$;
revoke all on function public.laboratory_sample_label(uuid) from public,anon;
grant execute on function public.laboratory_sample_label(uuid) to authenticated;
revoke all on function private.record_sample_label_event(),private.guard_sample_label_processing() from public,anon,authenticated;
revoke all on function public.list_laboratory_samples(uuid,text),public.create_laboratory_sample(uuid,text,uuid,uuid),public.change_laboratory_sample(uuid,integer,text,text) from public,anon;
grant execute on function public.list_laboratory_samples(uuid,text),public.create_laboratory_sample(uuid,text,uuid,uuid),public.change_laboratory_sample(uuid,integer,text,text) to authenticated;
commit;

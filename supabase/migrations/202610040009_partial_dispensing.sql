begin;
create table public.prescription_dispensing_events(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references public.documents(id),
 institution_id uuid not null references public.institutions(id),pharmacist_id uuid not null references public.profiles(id),
 institution_name text not null,pharmacist_name text not null,items jsonb not null,
 request_id uuid not null,created_at timestamptz not null default now(),unique(pharmacist_id,request_id)
);
alter table public.prescription_dispensing_events enable row level security;
revoke all on public.prescription_dispensing_events from anon,authenticated;
create trigger immutable before update or delete on public.prescription_dispensing_events for each row execute function private.no_clinical_delete();
create trigger audit_change after insert on public.prescription_dispensing_events for each row execute function private.audit_change();
create function private.dispensed_quantity(d public.documents,item_index integer) returns integer language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.prescription_dispensations x where x.document_id=d.id)
 then (d.payload->'details'->'items'->item_index->>'quantity')::integer
 else coalesce((select sum((i->>'quantity')::integer)::integer from public.prescription_dispensing_events e cross join lateral jsonb_array_elements(e.items) i where e.document_id=d.id and (i->>'index')::integer=item_index),0) end
$$;
create or replace function private.pharmacy_summary(d public.documents) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'number',d.number,'status',private.document_status(d),'issued_at',d.issued_at,'expires_on',d.expires_on,
 'patient_name',concat_ws(' ',d.payload->'patient'->>'first_name',d.payload->'patient'->>'last_name'),'patient_number',d.payload->'patient'->>'patient_number','doctor_name',d.payload->>'doctor',
 'items',(select jsonb_agg(i.value||jsonb_build_object('dispensed',private.dispensed_quantity(d,(i.ordinality-1)::integer),'remaining',(i.value->>'quantity')::integer-private.dispensed_quantity(d,(i.ordinality-1)::integer)) order by i.ordinality) from jsonb_array_elements(d.payload->'details'->'items') with ordinality i),
 'dispensation',(select jsonb_build_object('institution_name',x.institution_name,'pharmacist_name',x.pharmacist_name,'created_at',x.created_at) from public.prescription_dispensations x where x.document_id=d.id),
 'dispensing_events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'institution_name',e.institution_name,'pharmacist_name',e.pharmacist_name,'created_at',e.created_at,'items',e.items) order by e.created_at,e.id),'[]') from public.prescription_dispensing_events e where e.document_id=d.id))
$$;
create function public.dispense_prescription_items(document_id uuid,patient_number text,institution_id uuid,items jsonb,request_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare d public.documents;existing public.prescription_dispensing_events;item jsonb;idx integer;qty integer;seen integer[]:='{}';eid uuid;complete boolean;
begin
 if not private.has_role('PHARMACIST',institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if request_id is null or jsonb_typeof(items) is distinct from 'array' or jsonb_array_length(items) not between 1 and 20 then raise exception 'Invalid dispensing items';end if;
 perform pg_advisory_xact_lock(hashtext(auth.uid()::text),hashtext(request_id::text));
 select * into d from public.documents where id=document_id for update;
 if d.id is null or d.kind<>'PRESCRIPTION' or d.payload->'patient'->>'patient_number' is distinct from trim(patient_number) then raise exception 'Prescription not found';end if;
 select * into existing from public.prescription_dispensing_events e where e.pharmacist_id=auth.uid() and e.request_id=dispense_prescription_items.request_id;
 if existing.id is not null then
   if existing.document_id is distinct from document_id or existing.institution_id is distinct from institution_id or existing.items is distinct from items then raise exception 'Request already used with different data';end if;
   return existing.id;
 end if;
 if private.document_status(d)<>'ISSUED' then raise exception 'Prescription cannot be dispensed';end if;
 for item in select value from jsonb_array_elements(items) loop
   if jsonb_typeof(item->'index') is distinct from 'number' or jsonb_typeof(item->'quantity') is distinct from 'number'
     or (item->>'index')!~'^[0-9]{1,2}$' or (item->>'quantity')!~'^[0-9]{1,6}$' then raise exception 'Invalid dispensing quantity';end if;
   idx:=(item->>'index')::integer;qty:=(item->>'quantity')::integer;
   if idx>=jsonb_array_length(d.payload->'details'->'items') or idx=any(seen) or qty<1
      or qty>(d.payload->'details'->'items'->idx->>'quantity')::integer-private.dispensed_quantity(d,idx) then raise exception 'Quantity exceeds remaining prescription';end if;
   seen:=array_append(seen,idx);
 end loop;
 insert into public.prescription_dispensing_events(document_id,institution_id,pharmacist_id,institution_name,pharmacist_name,items,request_id)
 select d.id,dispense_prescription_items.institution_id,auth.uid(),i.name,p.first_name||' '||p.last_name,dispense_prescription_items.items,dispense_prescription_items.request_id
 from public.institutions i,public.profiles p where i.id=dispense_prescription_items.institution_id and p.id=auth.uid() returning id into eid;
 select not exists(select 1 from jsonb_array_elements(d.payload->'details'->'items') with ordinality i where private.dispensed_quantity(d,(i.ordinality-1)::integer)<(i.value->>'quantity')::integer) into complete;
 if complete then
   insert into public.prescription_dispensations(document_id,institution_id,pharmacist_id,institution_name,pharmacist_name)
   select e.document_id,e.institution_id,e.pharmacist_id,e.institution_name,e.pharmacist_name from public.prescription_dispensing_events e where e.id=eid;
   update public.documents set status='DISPENSED' where id=d.id;
 end if;
 insert into public.notifications(user_id,document_id,message) select p.user_id,d.id,case when complete then 'Recept je u cijelosti realiziran u ljekarni.' else 'Evidentirano je djelomično preuzimanje lijekova.' end from public.patients p where p.id=d.patient_id and p.user_id is not null;
 perform private.audit_event('PRESCRIPTION_ITEMS_DISPENSED','documents',d.id);return eid;
end $$;
create or replace function public.dispense_prescription(document_id uuid,patient_number text,institution_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare d public.documents;items jsonb;
begin
 if not private.has_role('PHARMACIST',institution_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select * into d from public.documents where id=document_id for update;
 if d.id is null or private.document_status(d)<>'ISSUED' then raise exception 'Prescription cannot be dispensed';end if;
 select jsonb_agg(jsonb_build_object('index',i.ordinality-1,'quantity',(i.value->>'quantity')::integer-private.dispensed_quantity(d,(i.ordinality-1)::integer)) order by i.ordinality) into items
 from jsonb_array_elements(d.payload->'details'->'items') with ordinality i where private.dispensed_quantity(d,(i.ordinality-1)::integer)<(i.value->>'quantity')::integer;
 perform public.dispense_prescription_items(document_id,patient_number,institution_id,items,gen_random_uuid());
end $$;
create function public.search_my_medications(active_only boolean default false,page_number integer default 0,search_term text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare pid uuid;result jsonb;
begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 if page_number is null or page_number not between 0 and 10000 or search_term is null or length(search_term)>100 then raise exception 'Invalid search';end if;
 select id into pid from public.patients where user_id=auth.uid() and archived_at is null;
 select coalesce(jsonb_agg(private.pharmacy_summary(x) order by x.issued_at desc,x.id),'[]') into result from(
 select d.* from public.documents d where d.patient_id=pid and d.kind='PRESCRIPTION' and (not active_only or private.document_status(d)='ISSUED')
 and (trim(search_term)='' or exists(select 1 from jsonb_array_elements(d.payload->'details'->'items') i where position(lower(trim(search_term)) in lower(i->>'name'))>0))
 order by d.issued_at desc,d.id limit 50 offset page_number*50)x;
 perform private.audit_event('MEDICATIONS_VIEWED','patients',pid);return result;
end $$;
revoke all on function private.dispensed_quantity(public.documents,integer) from public,anon,authenticated;
revoke all on function public.dispense_prescription_items(uuid,text,uuid,jsonb,uuid),public.search_my_medications(boolean,integer,text) from public,anon;
grant execute on function public.dispense_prescription_items(uuid,text,uuid,jsonb,uuid),public.search_my_medications(boolean,integer,text) to authenticated;
commit;

begin;
create function public.search_attachments(
 patient_filter uuid,include_archived boolean default false,search_term text default '',
 category_filter text default null,date_from date default null,date_to date default null,page_number integer default 0
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;term text:=lower(trim(search_term));
begin
 if not private.can_read_patient(patient_filter) then raise exception 'Forbidden' using errcode='42501';end if;
 if include_archived is null or search_term is null or length(search_term)>100 or page_number is null or page_number not between 0 and 10000
   or (category_filter is not null and category_filter not in ('REPORT','DISCHARGE','LAB','RADIOLOGY','CERTIFICATE','EXCUSE','OTHER'))
   or (date_from is not null and date_to is not null and date_from>date_to) then raise exception 'Invalid attachment search';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc,x.id),'[]') into result from(
 select a.id,a.patient_id,a.title,a.category,a.file_name,a.content_type,a.byte_size,a.sha256,a.status,a.created_at,a.archived_at,a.archive_reason,
 p.first_name||' '||p.last_name uploaded_by,a.created_by=auth.uid() and private.can_upload_attachment(a.patient_id) and a.status='AVAILABLE' can_archive
 from public.document_attachments a join public.profiles p on p.id=a.created_by
 where a.patient_id=patient_filter and (a.status='AVAILABLE' or (include_archived and a.status='ARCHIVED'))
 and (term='' or position(term in lower(concat_ws(' ',a.title,a.file_name,p.first_name,p.last_name)))>0)
 and (category_filter is null or a.category=category_filter)
 and (date_from is null or (a.created_at at time zone 'Europe/Zagreb')::date>=date_from)
 and (date_to is null or (a.created_at at time zone 'Europe/Zagreb')::date<=date_to)
 order by a.created_at desc,a.id limit 50 offset page_number*50)x;
 perform private.audit_event('DOCUMENT_LIST_VIEWED','document_attachments',patient_filter);return result;
end $$;
revoke all on function public.search_attachments(uuid,boolean,text,text,date,date,integer) from public,anon;
grant execute on function public.search_attachments(uuid,boolean,text,text,date,date,integer) to authenticated;
create or replace function public.application_schema_version() returns integer language sql immutable set search_path='' as $$select 20261007$$;
commit;

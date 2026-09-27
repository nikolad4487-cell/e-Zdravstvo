begin;
create table public.document_attachments(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),request_id uuid not null,
 title text not null check(length(trim(title)) between 1 and 200),category text not null check(category in ('REPORT','DISCHARGE','LAB','RADIOLOGY','CERTIFICATE','EXCUSE','OTHER')),
 file_name text not null check(length(file_name) between 1 and 200),content_type text not null check(content_type in ('application/pdf','image/jpeg','image/png')),
 byte_size bigint not null check(byte_size between 1 and 10485760),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
 storage_path text not null unique,status text not null default 'PENDING' check(status in ('PENDING','AVAILABLE','ARCHIVED')),
 created_by uuid not null references public.profiles(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 archived_at timestamptz,archive_reason text,unique(created_by,request_id),
 check(status<>'ARCHIVED' or (archived_at is not null and coalesce(length(trim(archive_reason)),0)>=5))
);
create index attachment_patient_idx on public.document_attachments(patient_id,created_at desc);
alter table public.document_attachments enable row level security;
revoke all on public.document_attachments from anon,authenticated;
grant all on public.document_attachments to service_role;
create policy attachment_read on public.document_attachments for select to authenticated using(private.can_read_patient(patient_id));
create trigger no_delete before delete on public.document_attachments for each row execute function private.no_clinical_delete();
create trigger audit_change after insert or update on public.document_attachments for each row execute function private.audit_change();
create trigger updated_at before update on public.document_attachments for each row execute function private.touch_updated_at();
create function private.preserve_attachment() returns trigger language plpgsql set search_path='' as $$
begin
 if (to_jsonb(new)-'status'-'archived_at'-'archive_reason'-'updated_at') is distinct from (to_jsonb(old)-'status'-'archived_at'-'archive_reason'-'updated_at') then raise exception 'Attachment content is immutable';end if;
 return new;
end $$;
create trigger preserve_content before update on public.document_attachments for each row execute function private.preserve_attachment();
alter table public.notifications add column attachment_id uuid references public.document_attachments(id),add column event_key text unique;

create function private.can_upload_attachment(pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.treating_doctor(pid) is not null or (private.has_role('PATIENT') and exists(select 1 from public.patients p where p.id=pid and p.user_id=auth.uid() and p.archived_at is null));
$$;
create function public.reserve_attachment(patient_id uuid,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare a public.document_attachments;aid uuid:=gen_random_uuid();
begin
 if not private.can_upload_attachment(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,1));
 select * into a from public.document_attachments d where d.created_by=auth.uid() and d.request_id=reserve_attachment.request_id;
 if a.id is not null then
  if a.patient_id<>patient_id or a.sha256 is distinct from data->>'sha256' or a.title is distinct from data->>'title' or a.category is distinct from data->>'category' or a.file_name is distinct from data->>'file_name' or a.content_type is distinct from data->>'content_type' or a.byte_size is distinct from (data->>'byte_size')::bigint or a.status='ARCHIVED' then raise exception 'Request key already used';end if;
  return a.id;
 end if;
 insert into public.document_attachments(id,patient_id,request_id,title,category,file_name,content_type,byte_size,sha256,storage_path,created_by)
 values(aid,patient_id,request_id,data->>'title',data->>'category',data->>'file_name',data->>'content_type',(data->>'byte_size')::bigint,data->>'sha256','uploads/'||aid::text,auth.uid());
 return aid;
end $$;
create function public.attachment_transfer(attachment_id uuid,operation text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.document_attachments;
begin
 select * into a from public.document_attachments where id=attachment_id;
 if a.id is null or operation is null or operation not in ('UPLOAD','DOWNLOAD') then raise exception 'Forbidden' using errcode='42501';end if;
 if operation='UPLOAD' then
  if a.created_by<>auth.uid() or not private.can_upload_attachment(a.patient_id) or a.status='ARCHIVED' then raise exception 'Forbidden' using errcode='42501';end if;
 else
  if a.status='PENDING' or not private.can_read_patient(a.patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
  perform private.audit_event('DOCUMENT_DOWNLOADED','document_attachments',a.id);
 end if;
 return jsonb_build_object('id',a.id,'storage_path',a.storage_path,'file_name',a.file_name,'content_type',a.content_type,'byte_size',a.byte_size,'sha256',a.sha256,'status',a.status);
end $$;
create function public.finish_attachment(attachment_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare a public.document_attachments;meta jsonb;
begin
 select * into a from public.document_attachments where id=attachment_id for update;
 if a.id is null or a.created_by<>auth.uid() or not private.can_upload_attachment(a.patient_id) or a.status='ARCHIVED' then raise exception 'Forbidden' using errcode='42501';end if;
 if a.status='AVAILABLE' then return;end if;
 select metadata into meta from storage.objects where bucket_id='medical-documents' and name=a.storage_path;
 if meta is null or coalesce((meta->>'size')::bigint,0)<>a.byte_size or meta->>'mimetype' is distinct from a.content_type then raise exception 'Upload not complete';end if;
 update public.document_attachments set status='AVAILABLE' where id=a.id;
 insert into public.notifications(user_id,attachment_id,message,event_key)
 select p.user_id,a.id,'Dostupan je novi učitani dokument.','attachment:'||a.id from public.patients p where p.id=a.patient_id and p.user_id is not null;
 perform private.audit_event('DOCUMENT_UPLOADED','document_attachments',a.id);
end $$;
create function public.list_attachments(patient_id uuid,include_archived boolean default false) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not private.can_read_patient(patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(x order by x.created_at desc),'[]') into result from (
 select a.id,a.patient_id,a.title,a.category,a.file_name,a.content_type,a.byte_size,a.sha256,a.status,a.created_at,a.archived_at,a.archive_reason,
 p.first_name||' '||p.last_name as uploaded_by,a.created_by=auth.uid() and private.can_upload_attachment(a.patient_id) and a.status='AVAILABLE' as can_archive
 from public.document_attachments a join public.profiles p on p.id=a.created_by where a.patient_id=list_attachments.patient_id and (a.status='AVAILABLE' or (include_archived and a.status='ARCHIVED')) order by a.created_at desc limit 100) x;
 perform private.audit_event('DOCUMENT_LIST_VIEWED','document_attachments',patient_id);return result;
end $$;
create function public.archive_attachment(attachment_id uuid,reason text) returns void language plpgsql security definer set search_path='' as $$
declare a public.document_attachments;
begin
 select * into a from public.document_attachments where id=attachment_id for update;
 if a.id is null or a.created_by<>auth.uid() or not private.can_upload_attachment(a.patient_id) then raise exception 'Forbidden' using errcode='42501';end if;
 if a.status<>'AVAILABLE' or coalesce(length(trim(reason)),0)<5 then raise exception 'Invalid archive request';end if;
 update public.document_attachments set status='ARCHIVED',archived_at=now(),archive_reason=left(reason,2000) where id=a.id;
 insert into public.notifications(user_id,attachment_id,message,event_key) select p.user_id,a.id,'Učitani dokument je arhiviran.','archived:'||a.id from public.patients p where p.id=a.patient_id and p.user_id is not null;
 perform private.audit_event('DOCUMENT_ARCHIVED','document_attachments',a.id);
end $$;
create function public.mark_notification_read(notification_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.has_role('PATIENT') then raise exception 'Forbidden' using errcode='42501';end if;
 update public.notifications n set read_at=now() where n.user_id=auth.uid() and n.read_at is null and (notification_id is null or n.id=notification_id);
end $$;
-- Objects have no authenticated SELECT/INSERT/UPDATE/DELETE policy. The Edge
-- function validates the caller through these RPCs before service-role I/O.
-- No public or signed URLs are issued, so every download rechecks care access.
revoke all on function private.can_upload_attachment(uuid),private.preserve_attachment() from public,anon,authenticated;
revoke all on function public.reserve_attachment(uuid,jsonb,uuid),public.attachment_transfer(uuid,text),public.finish_attachment(uuid),public.list_attachments(uuid,boolean),public.archive_attachment(uuid,text),public.mark_notification_read(uuid) from public,anon;
grant execute on function public.reserve_attachment(uuid,jsonb,uuid),public.attachment_transfer(uuid,text),public.finish_attachment(uuid),public.list_attachments(uuid,boolean),public.archive_attachment(uuid,text),public.mark_notification_read(uuid) to authenticated;
commit;

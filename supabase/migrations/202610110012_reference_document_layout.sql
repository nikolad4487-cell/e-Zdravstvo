begin;
-- A new layout version is stamped only on future jobs. Preserve previous retry PDFs.
create function private.use_reference_document_layout() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.payload->>'kind' in ('REFERRAL','MEDICAL_REPORT','LAB_RESULT') then
  new.payload:=jsonb_set(new.payload,'{layoutVersion}','3'::jsonb);
 end if;
 return new;
end $$;
-- PostgreSQL executes BEFORE triggers in name order, after snapshot_document_print_layout.
create trigger z_reference_document_layout before insert on private.document_email_outbox
 for each row execute function private.use_reference_document_layout();
revoke all on function private.use_reference_document_layout() from public,anon,authenticated;
commit;

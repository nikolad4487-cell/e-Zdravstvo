begin;
-- A null RPC argument must not bypass the required revocation reason.
alter table public.documents add constraint revoked_document_reason_required
 check(status not in ('REVOKED','CANCELLED') or coalesce(length(trim(revocation_reason)),0)>=5);
commit;

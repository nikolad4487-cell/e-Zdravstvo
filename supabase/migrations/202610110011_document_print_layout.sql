begin;
-- Store a versioned print model at issuance. Existing jobs retain their exact retry payload.
create function private.snapshot_document_print_layout() returns trigger
language plpgsql security definer set search_path='' as $$
declare layout jsonb:='{}'; d public.documents; token uuid; signed jsonb;
begin
 if new.document_id is not null then
  select * into d from public.documents where id=new.document_id;
  select id into token from public.document_verifications where document_id=d.id;
  layout:=jsonb_build_object('verificationToken',token,'status',case d.status
    when 'ISSUED' then 'Izdano' when 'VALID' then 'Važeći' when 'BOOKED' then 'Naručeno'
    when 'IN_PROGRESS' then 'U obradi' else d.status end);
  if d.kind='SCHOOL_EXCUSE' then
   select jsonb_build_object('status',s.status,'signature_hash',s.signature_hash,'integrity_valid',private.signature_valid(d.id))
     into signed from public.digital_signatures s where s.document_id=d.id;
   layout:=layout||jsonb_build_object('schoolDocument',jsonb_build_object(
    'number',d.number,'status',d.status,'issued_at',d.issued_at,'expires_on',d.expires_on,
    'revocation_reason',d.revocation_reason,'payload',d.payload,'signature',signed));
  end if;
 elsif new.laboratory_result_id is not null then
  select jsonb_build_object('laboratoryRows',coalesce(jsonb_agg(jsonb_build_object(
   'code',x.code,'name',x.name,'value',x.value::text,'unit',x.unit,
   'referenceLow',x.reference_low::text,'referenceHigh',x.reference_high::text,'flag',x.flag)
   order by x.code,x.id),'[]'::jsonb)) into layout
   from public.laboratory_parameters x where x.result_id=new.laboratory_result_id;
 end if;
 new.payload:=new.payload||jsonb_build_object('layoutVersion',2,'layout',layout);
 return new;
end $$;
create trigger snapshot_document_print_layout before insert on private.document_email_outbox
 for each row execute function private.snapshot_document_print_layout();
revoke all on function private.snapshot_document_print_layout() from public,anon,authenticated;
commit;

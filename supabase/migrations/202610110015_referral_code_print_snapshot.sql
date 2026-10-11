begin;
create function private.referral_code_print_snapshot() returns trigger language plpgsql security definer set search_path='' as $$
declare details jsonb;
begin
 if new.payload->>'kind'='REFERRAL' then
  select payload->'details' into details from public.documents where id=new.document_id;
  new.payload:=jsonb_set(new.payload,'{layoutVersion}','4'::jsonb);
  new.payload:=jsonb_set(new.payload,'{layout}',coalesce(new.payload->'layout','{}')||jsonb_strip_nulls(jsonb_build_object(
    'referralCode',details->>'referral_code','referralCodeName',details->>'referral_code_name',
    'examinationCode',details->>'examination_code','examinationName',details->>'examination_name',
    'visitCode',details->>'visit_code','visitName',details->>'visit_name')));
 end if;
 return new;
end $$;
create trigger zz_referral_code_print_snapshot before insert on private.document_email_outbox for each row execute function private.referral_code_print_snapshot();
revoke all on function private.referral_code_print_snapshot() from public,anon,authenticated;
commit;

begin;
-- Documents contain clinical data: private snapshots never enter portal notification bodies.
create table private.document_email_outbox(
 id uuid primary key default gen_random_uuid(),patient_id uuid not null references public.patients(id),
 document_id uuid unique references public.documents(id),medical_report_id uuid unique references public.medical_reports(id),
 laboratory_result_id uuid unique references public.laboratory_results(id),
 recipient_user_id uuid references public.profiles(id),email text not null,payload jsonb not null,
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','SENT','FAILED','CANCELLED')),
 attempts integer not null default 0,next_attempt_at timestamptz not null default now(),
 first_attempt_at timestamptz,locked_until timestamptz,lease_id uuid,sent_at timestamptz,provider_id text,
 created_at timestamptz not null default now(),check(num_nonnulls(document_id,medical_report_id,laboratory_result_id)=1)
);
create index document_email_pending on private.document_email_outbox(next_attempt_at) where status in ('PENDING','SENDING');
create table private.document_email_attempts(
 job_id uuid not null references private.document_email_outbox(id),attempt_number integer not null,lease_id uuid not null,
 succeeded boolean not null,provider_id text,outcome text not null check(outcome in ('SENT','DELIVERY_FAILED','LEASE_EXPIRED')),
 created_at timestamptz not null default now(),primary key(job_id,attempt_number)
);
revoke all on private.document_email_outbox,private.document_email_attempts from public,anon,authenticated;

create function private.email_document_section(label text,value text) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(jsonb_build_object('label',label,'text',coalesce(value,'')))
$$;
create function private.queue_issued_document_email() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid;doc uuid;report uuid;lab uuid;p public.patients;d public.documents;r public.medical_reports;
 l public.laboratory_results;o public.laboratory_orders;recipient text;recipient_user uuid;
 details jsonb;sections jsonb;kind text;title text;number text;issued timestamptz;payload jsonb;
begin
 if not(select c.email_available from private.notification_delivery_config c where c.id) then return null;end if;
 if TG_TABLE_NAME='documents' then
  select * into d from public.documents where id=new.id;
  if d.kind not in ('REFERRAL','SCHOOL_EXCUSE') or d.status not in ('ISSUED','BOOKED','IN_PROGRESS','VALID')
   or d.expires_on<current_date or not private.signature_valid(d.id) then return null;end if;
  pid:=d.patient_id;doc:=d.id;kind:=d.kind;number:=d.number;issued:=d.issued_at;
  title:=case d.kind when 'REFERRAL' then 'Uputnica' else coalesce(d.payload->'details'->'template'->>'title','Ispričnica') end;
  details:=d.payload->'details';
  sections:=private.email_document_section('Pacijent',concat_ws(' ',d.payload->'patient'->>'first_name',d.payload->'patient'->>'last_name'))
   ||private.email_document_section('Datum rođenja / broj pacijenta',concat_ws(' / ',d.payload->'patient'->>'birth_date',d.payload->'patient'->>'patient_number'))
   ||private.email_document_section('Liječnik / ustanova',concat_ws(E'\n',d.payload->>'doctor',d.payload->>'institution',d.payload->>'institution_address'))
   ||private.email_document_section('Izdano / vrijedi do',to_char(d.issued_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||' / '||to_char(d.expires_on,'DD.MM.YYYY.'));
  if kind='REFERRAL' then
   sections:=sections||private.email_document_section('Vrsta / specijalnost',concat_ws(' / ',details->>'referral_type',details->>'specialty'))
    ||private.email_document_section('Prioritet',case details->>'priority' when 'URGENT' then 'Hitno' else 'Redovno' end)
    ||private.email_document_section('Razlog upućivanja',details->>'reason')||private.email_document_section('Dijagnoza',details->>'diagnosis');
  else
   sections:=sections||private.email_document_section('Ispričnica',concat_ws(' ',details->'template'->>'body_text','OD',details->>'date_from','DO',details->>'date_to'))
    ||private.email_document_section('Vrsta ispričnice',case details->>'excuse_type' when 'PE' then 'Tjelesna i zdravstvena kultura' else 'Redovna nastava' end)
    ||private.email_document_section('Škola',details->>'school')||private.email_document_section('Razlog izostanka',details->>'category');
   if nullif(details->>'diagnosis_code','') is not null then sections:=sections||private.email_document_section('Šifra bolesti',details->>'diagnosis_code');end if;
   if details ? 'clinic' then sections:=sections||private.email_document_section('Ambulanta',concat_ws(' / ',details->'clinic'->>'name',details->'clinic'->>'code',details->'clinic'->>'phone',details->'clinic'->>'email'))
     ||private.email_document_section('Šifra liječnika',details->>'doctor_code');end if;
  end if;
  sections:=sections||private.email_document_section('Napomena',details->>'notes')
   ||private.email_document_section('Elektronički potpis',d.payload->>'signature_disclaimer')
   ||private.email_document_section('Oznaka potpisa',(select s.signature_method||': '||s.signature_hash from public.digital_signatures s where s.document_id=d.id));
 elsif TG_TABLE_NAME='medical_reports' then
  select * into r from public.medical_reports where id=new.id;
  if r.superseded_by is not null then return null;end if;
  pid:=r.patient_id;report:=r.id;kind:='MEDICAL_REPORT';number:=r.number||'-v'||r.version;issued:=r.created_at;
  title:=case r.report_type when 'DISCHARGE' then 'Otpusno pismo' else 'Specijalistički nalaz' end;
  sections:=private.email_document_section('Pacijent',r.patient_name||' / '||r.patient_number)
   ||private.email_document_section('Izdavatelj',concat_ws(E'\n',r.institution_name,r.doctor_name,r.specialty))
   ||private.email_document_section('Datum / verzija',to_char(r.reported_on,'DD.MM.YYYY.')||' / '||r.version)
   ||private.email_document_section('Dijagnoze',r.diagnosis)||private.email_document_section('Nalaz',r.content)
   ||private.email_document_section('Zaključak',r.conclusion)||private.email_document_section('Preporuke',r.recommendations);
  if r.supersedes_id is not null then sections:=sections||private.email_document_section('Razlog ispravka',r.correction_reason);end if;
 else
  select * into l from public.laboratory_results where id=new.id;
  if l.superseded_by is not null then return null;end if;
  select * into o from public.laboratory_orders where id=l.order_id;
  pid:=o.patient_id;lab:=l.id;kind:='LAB_RESULT';number:=o.number||'-v'||l.version;issued:=l.reported_at;title:='Laboratorijski nalaz';
  sections:=private.email_document_section('Pacijent',(select pat.first_name||' '||pat.last_name||' / '||pat.patient_number from public.patients pat where pat.id=pid))
   ||private.email_document_section('Laboratorij',(select i.name from public.institutions i where i.id=o.laboratory_institution_id))
   ||private.email_document_section('Autor',(select pr.first_name||' '||pr.last_name from public.profiles pr where pr.id=l.created_by))
   ||private.email_document_section('Uzorkovanje / objava',to_char(l.sampled_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI')||' / '||to_char(l.reported_at at time zone 'Europe/Zagreb','DD.MM.YYYY. HH24:MI'))
   ||coalesce((select jsonb_agg(jsonb_build_object('label',x.code||' / '||x.name,'text',x.value||' '||x.unit||E'\nReferentni interval: '||coalesce(x.reference_low::text,'—')||' – '||coalesce(x.reference_high::text,'—')||' '||x.unit||E'\nOznaka: '||case x.flag when 'CRITICAL' then 'Kritično' when 'HIGH' then 'Povišeno' when 'LOW' then 'Sniženo' when 'NORMAL' then 'Uredno' else 'Bez oznake' end) order by x.code,x.id) from public.laboratory_parameters x where x.result_id=l.id),'[]'::jsonb)
   ||private.email_document_section('Komentar',l.summary);
  if l.version>1 then sections:=sections||private.email_document_section('Razlog ispravka',l.correction_reason);end if;
 end if;
 select * into p from public.patients where id=pid;
 if p.id is null or p.archived_at is not null then return null;end if;
 recipient_user:=p.user_id;
 if recipient_user is null then recipient:=trim(p.email);
 else
  if not exists(select 1 from public.notification_preferences pref where pref.user_id=recipient_user and pref.email_enabled) then return null;end if;
  select u.email into recipient from auth.users u where u.id=recipient_user and u.email_confirmed_at is not null;
 end if;
 if not private.valid_patient_contact_email(recipient) then return null;end if;
 payload:=jsonb_build_object('kind',kind,'title',title,'number',number,'issuedAt',issued,'sections',sections);
 insert into private.document_email_outbox(patient_id,document_id,medical_report_id,laboratory_result_id,recipient_user_id,email,payload)
 values(pid,doc,report,lab,recipient_user,recipient,payload) on conflict do nothing;
 return null;
end $$;
-- Deferred until all signed details / laboratory parameters are saved; rollback sends nothing.
create constraint trigger document_pdf_email after insert on public.documents deferrable initially deferred for each row execute function private.queue_issued_document_email();
create constraint trigger report_pdf_email after insert on public.medical_reports deferrable initially deferred for each row execute function private.queue_issued_document_email();
create constraint trigger lab_pdf_email after insert on public.laboratory_results deferrable initially deferred for each row execute function private.queue_issued_document_email();

create function private.dispatch_document_emails() returns trigger language plpgsql security definer set search_path='' as $$
declare endpoint text;secret_name text;job_token text;
begin
 if not exists(select 1 from new_document_jobs) then return null;end if;
 select dispatch_url,dispatch_token_secret_name into endpoint,secret_name from private.notification_delivery_config where id and email_available;
 if endpoint is null or secret_name is null then return null;end if;
 begin
  select s.decrypted_secret into job_token from vault.decrypted_secrets s where s.name=secret_name;
  if job_token is null then raise exception 'Dispatch unavailable';end if;
  perform net.http_post(url:=endpoint,body:='{}'::jsonb,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||job_token),timeout_milliseconds:=10000);
 exception when others then raise log 'DOCUMENT_IMMEDIATE_DISPATCH_FAILED';end;
 return null;
end $$;
create trigger dispatch_document_emails after insert on private.document_email_outbox referencing new table as new_document_jobs for each statement execute function private.dispatch_document_emails();

create function public.claim_document_emails(batch_size integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if batch_size is null or batch_size not between 1 and 3 then raise exception 'Invalid batch';end if;
 if not(select email_available from private.notification_delivery_config where id) then return '[]'::jsonb;end if;
 insert into private.document_email_attempts(job_id,attempt_number,lease_id,succeeded,outcome)
 select id,attempts,lease_id,false,'LEASE_EXPIRED' from private.document_email_outbox where status='SENDING' and locked_until<now() on conflict do nothing;
 update private.document_email_outbox set status='FAILED',lease_id=null,locked_until=null
 where status in ('PENDING','SENDING') and (first_attempt_at<now()-interval '23 hours' or (status='SENDING' and locked_until<now() and attempts>=5));
 update private.document_email_outbox e set status='CANCELLED',lease_id=null,locked_until=null
 from public.patients p where p.id=e.patient_id and e.status in ('PENDING','SENDING') and (
 p.archived_at is not null or p.user_id is distinct from e.recipient_user_id
 or (e.recipient_user_id is null and trim(coalesce(p.email,'')) is distinct from e.email)
 or (e.recipient_user_id is not null and (not exists(select 1 from public.notification_preferences pref where pref.user_id=e.recipient_user_id and pref.email_enabled)
  or not exists(select 1 from auth.users u where u.id=e.recipient_user_id and u.email_confirmed_at is not null and u.email=e.email)))
 or (e.document_id is not null and exists(select 1 from public.documents d where d.id=e.document_id and (d.status in ('CANCELLED','REVOKED','EXPIRED') or d.expires_on<current_date or not private.signature_valid(d.id))))
 or exists(select 1 from public.medical_reports r where r.id=e.medical_report_id and r.superseded_by is not null)
 or exists(select 1 from public.laboratory_results r where r.id=e.laboratory_result_id and r.superseded_by is not null));
 with picked as (select id from private.document_email_outbox where (status='PENDING' or (status='SENDING' and locked_until<now())) and next_attempt_at<=now() and attempts<5 order by created_at,id for update skip locked limit batch_size),
 claimed as (update private.document_email_outbox e set status='SENDING',attempts=e.attempts+1,first_attempt_at=coalesce(e.first_attempt_at,now()),locked_until=now()+interval '5 minutes',lease_id=gen_random_uuid() from picked where e.id=picked.id returning e.*)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease_id',lease_id,'email',email,'document',payload,'documentDelivery',true)),'[]') into result from claimed;
 return result;
end $$;
create function public.complete_document_email(job_id uuid,lease_id uuid,succeeded boolean,provider_id text default null,retry_seconds integer default 300)
returns void language plpgsql security definer set search_path='' as $$
declare completed record;
begin
 if succeeded is null or retry_seconds is null or retry_seconds not between 1 and 86400 then raise exception 'Invalid completion';end if;
 update private.document_email_outbox e set status=case when succeeded then 'SENT' when attempts>=5 then 'FAILED' else 'PENDING' end,
 sent_at=case when succeeded then now() end,provider_id=case when succeeded then left(complete_document_email.provider_id,200) end,
 next_attempt_at=now()+make_interval(secs=>retry_seconds),lease_id=null,locked_until=null
 where e.id=job_id and e.lease_id=complete_document_email.lease_id and status='SENDING' and locked_until>=now()
 returning e.id,e.attempts,e.provider_id into completed;
 if found then insert into private.document_email_attempts(job_id,attempt_number,lease_id,succeeded,provider_id,outcome)
 values(completed.id,completed.attempts,complete_document_email.lease_id,succeeded,completed.provider_id,case when succeeded then 'SENT' else 'DELIVERY_FAILED' end) on conflict do nothing;end if;
end $$;
-- Keep portal notifications, but avoid an extra generic email for the same issuance.
create or replace function private.queue_notification_email() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.documents d where d.id=new.document_id and d.kind in ('REFERRAL','SCHOOL_EXCUSE'))
  or new.message='Objavljen je novi specijalistički nalaz / otpusno pismo.'
  or new.message like 'Objavljen je novi laboratorijski nalaz: EZ-LAB-%'
  or new.message like 'Objavljen je ispravak laboratorijskog nalaza: EZ-LAB-%' then return new;end if;
 if (select email_available from private.notification_delivery_config where id) and exists(select 1 from public.notification_preferences pref where pref.user_id=new.user_id and pref.email_enabled) then
 insert into private.notification_email_outbox(notification_id,user_id) values(new.id,new.user_id) on conflict(notification_id) do nothing;end if;
 return new;
end $$;
revoke all on function private.email_document_section(text,text),private.queue_issued_document_email(),private.dispatch_document_emails() from public,anon,authenticated;
revoke all on function public.claim_document_emails(integer),public.complete_document_email(uuid,uuid,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.claim_document_emails(integer),public.complete_document_email(uuid,uuid,boolean,text,integer) to service_role;
commit;

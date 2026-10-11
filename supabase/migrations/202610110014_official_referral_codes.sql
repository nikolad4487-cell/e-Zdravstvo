begin;
alter table public.referrals add column referral_code text,add column examination_code text,add column visit_code text;
create function private.referral_code_details(data jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb:='{}';selected_code text:=nullif(data->>'referral_code','');label text;category text;exam text:=nullif(data->>'examination_code','');visit text:=nullif(data->>'visit_code','');
begin
 if selected_code is not null then
  select c.name into label from public.medical_codes c where list_id='2.2.5' and c.code=selected_code;
  if label is null then raise exception 'Invalid referral code';end if;
  category:=case selected_code when 'A2' then 'FOLLOW_UP' when 'A3' then 'DIAGNOSTICS' when 'A6' then 'DIAGNOSTICS' when 'C3' then 'DIAGNOSTICS' when 'B1' then 'HOSPITAL' when 'B2' then 'HOSPITAL' when 'C2' then 'HOSPITAL' when 'D2' then 'HOSPITAL' when 'K' then 'OTHER' else 'SPECIALIST' end;
  result:=jsonb_build_object('referral_type',category,'referral_code',selected_code,'referral_code_name',label);
 end if;
 if exam is not null then
  select c.name into label from public.medical_codes c where list_id='2.2.42' and c.code=exam;
  if label is null then raise exception 'Invalid examination code';end if;
  result:=result||jsonb_build_object('examination_code',exam,'examination_name',label);
 end if;
 if visit is not null then
  select c.name into label from public.medical_codes c where list_id='2.2.39' and c.code=visit;
  if label is null then raise exception 'Invalid visit code';end if;
  result:=result||jsonb_build_object('visit_code',visit,'visit_name',label);
 end if;
 return result;
end $$;
revoke all on function private.referral_code_details(jsonb) from public,anon,authenticated;
create or replace function public.issue_document(patient_id uuid,document_kind text,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);doc_id uuid;existing public.documents;p public.patients;dr public.doctors;i public.institutions;doc_number text;expires date:=(data->>'expires_on')::date;enc uuid:=nullif(data->>'encounter_id','')::uuid;details jsonb;item jsonb;med public.medications;med_items jsonb:='[]';prescription_id uuid;payload jsonb;issued timestamptz:=now();
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 -- Serialize retries for a single issuer request key, including simultaneous clicks.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into existing from public.documents d where d.created_by=auth.uid() and d.request_id=issue_document.request_id;
 if existing.id is not null then if existing.patient_id<>patient_id or existing.kind<>document_kind then raise exception 'Request key already used';end if;return existing.id;end if;
 if document_kind='REFERRAL' then data:=(data-'referral_code_name'-'examination_name'-'visit_name')||private.referral_code_details(data);end if;
 if expires is null or expires<current_date or expires>current_date+730 then raise exception 'Invalid expiry date';end if;
 if enc is not null and not exists(select 1 from public.medical_encounters e where e.id=enc and e.patient_id=issue_document.patient_id and e.superseded_by is null) then raise exception 'Invalid encounter reference';end if;
 select * into p from public.patients where id=patient_id;select * into dr from public.doctors where id=did;select * into i from public.institutions where id=dr.institution_id;
 doc_number:=private.next_document_number(document_kind);
 if document_kind='PRESCRIPTION' then
 if jsonb_typeof(data->'items') is distinct from 'array' or jsonb_array_length(data->'items') not between 1 and 20 then raise exception 'Prescription requires 1 to 20 items';end if;
 for item in select * from jsonb_array_elements(data->'items') loop
 select * into med from public.medications where id=(item->>'medication_id')::uuid and active;
 if med.id is null then raise exception 'Invalid medication';end if;
 med_items:=med_items||jsonb_build_array(jsonb_build_object('medication_id',med.id,'name',med.name,'active_ingredient',med.active_ingredient,'strength',med.strength,'form',med.form,'packaging',med.packaging,'dosage',left(item->>'dosage',500),'quantity',(item->>'quantity')::integer,'route',left(item->>'route',200),'duration',left(item->>'duration',300),'notes',left(coalesce(item->>'notes',''),2000)));
 end loop;
 details:=jsonb_build_object('items',med_items);
 elsif document_kind='REFERRAL' then
 details:=jsonb_build_object('referral_type',data->>'referral_type','specialty',left(data->>'specialty',200),'reason',left(data->>'reason',4000),'diagnosis_id',nullif(data->>'diagnosis_id',''),'diagnosis',(select code||' · '||name from public.diagnoses where id=nullif(data->>'diagnosis_id','')::uuid),'priority',data->>'priority','notes',left(coalesce(data->>'notes',''),4000));
 details:=details||jsonb_strip_nulls(jsonb_build_object('referral_code',data->>'referral_code','referral_code_name',data->>'referral_code_name','examination_code',data->>'examination_code','examination_name',data->>'examination_name','visit_code',data->>'visit_code','visit_name',data->>'visit_name'));
 elsif document_kind='SCHOOL_EXCUSE' then
 if (data->>'date_from')::date<p.birth_date then raise exception 'Invalid absence dates';end if;
 details:=jsonb_build_object('date_from',data->>'date_from','date_to',data->>'date_to','category',left(data->>'category',200),'school',left(coalesce(data->>'school',''),300),'notes',left(coalesce(data->>'notes',''),4000));
 if data ? 'excuse_type' then details:=private.school_excuse_details(did,data);end if;
 else raise exception 'Unsupported document kind';end if;
 payload:=jsonb_build_object('number',doc_number,'kind',document_kind,'issued_at',issued,'expires_on',expires,'patient',jsonb_build_object('first_name',p.first_name,'last_name',p.last_name,'birth_date',p.birth_date,'patient_number',p.patient_number),'doctor',dr.display_name,'institution',i.name,'institution_address',concat_ws(', ',i.address,i.city),'details',details,'signature_disclaimer','Interni elektronički potpis e-Zdravstva. Nije kvalificirani elektronički potpis.');
 insert into public.documents(request_id,patient_id,doctor_id,institution_id,kind,number,status,issued_at,expires_on,payload,created_by) values(request_id,patient_id,did,i.id,document_kind,doc_number,case when document_kind='SCHOOL_EXCUSE' then 'VALID' else 'ISSUED' end,issued,expires,payload,auth.uid()) returning id into doc_id;
 if document_kind='PRESCRIPTION' then
 insert into public.prescriptions(document_id,encounter_id,created_by) values(doc_id,enc,auth.uid()) returning id into prescription_id;
 for item in select * from jsonb_array_elements(med_items) loop insert into public.prescription_items(prescription_id,medication_id,dosage,quantity,route,duration,notes) values(prescription_id,(item->>'medication_id')::uuid,item->>'dosage',(item->>'quantity')::integer,item->>'route',item->>'duration',item->>'notes');end loop;
 elsif document_kind='REFERRAL' then
 insert into public.referrals(document_id,encounter_id,referral_type,specialty,reason,diagnosis_id,priority,notes,created_by,referral_code,examination_code,visit_code) values(doc_id,enc,details->>'referral_type',details->>'specialty',details->>'reason',nullif(details->>'diagnosis_id','')::uuid,details->>'priority',details->>'notes',auth.uid(),details->>'referral_code',details->>'examination_code',details->>'visit_code');
 else
 insert into public.school_excuses(document_id,encounter_id,date_from,date_to,category,school,notes,created_by) values(doc_id,enc,(details->>'date_from')::date,(details->>'date_to')::date,details->>'category',details->>'school',details->>'notes',auth.uid());
 if data ? 'excuse_type' then update public.school_excuses set excuse_type=data->>'excuse_type',clinic_id=(details->'clinic'->>'id')::uuid,diagnosis_id=nullif(data->>'diagnosis_id','')::uuid,reason_id=(data->>'reason_id')::uuid,template_id=nullif(details->'template'->>'id','')::uuid,print_diagnosis=coalesce((data->>'print_diagnosis')::boolean,false) where document_id=doc_id;end if;end if;
 insert into public.digital_signatures(document_id,signed_by,signature_hash,signature_method,certificate_name) values(doc_id,auth.uid(),private.sign_document(did,payload),'HMAC_SHA256_INTERNAL','e-Zdravstvo · '||dr.display_name||' · '||private.signer_fingerprint(did));
 insert into public.document_verifications(document_id) values(doc_id);
 if p.user_id is not null then insert into public.notifications(user_id,document_id,message) values(p.user_id,doc_id,dr.display_name||' izdao/la je '||case document_kind when 'PRESCRIPTION' then 'recept' when 'REFERRAL' then 'uputnicu' else 'ispričnicu' end||' '||doc_number);end if;
 perform private.audit_event(document_kind||'_ISSUED','documents',doc_id);return doc_id;
end $$;
-- Preserve the existing atomic priority workflow while forwarding verified referral choices.
do $$ declare definition text;needle text:='''notes'',coalesce(new_referral->>''notes'',''''))';replacement text:='''notes'',coalesce(new_referral->>''notes'',''''),''referral_code'',coalesce(new_referral->>''referral_code'',''A1''),''examination_code'',new_referral->>''examination_code'',''visit_code'',new_referral->>''visit_code'',''diagnosis_id'',new_referral->>''diagnosis_id'')';begin
 select pg_get_functiondef('public.book_priority_hospital(uuid,uuid,timestamptz,uuid,jsonb,text,uuid)'::regprocedure) into definition;
 if strpos(definition,needle)=0 then raise exception 'Priority workflow definition mismatch';end if;
 execute replace(definition,needle,replacement);
end $$;
commit;

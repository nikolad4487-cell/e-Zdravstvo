begin;
alter table public.school_excuses add column excuse_type text check(excuse_type in ('REGULAR','PE')),add column clinic_id uuid references public.clinics(id),add column diagnosis_id uuid references public.diagnoses(id),add column reason_id uuid references public.excuse_reasons(id),add column template_id uuid references public.excuse_templates(id),add column print_diagnosis boolean not null default false;
create function private.school_excuse_details(did uuid,data jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare dr public.doctors;c public.clinics;r public.excuse_reasons;dx public.diagnoses;t jsonb;k text:=data->>'excuse_type';show_code boolean:=coalesce((data->>'print_diagnosis')::boolean,false);
begin
 select * into dr from public.doctors where id=did;
 if k is null or k not in ('REGULAR','PE') then raise exception 'Invalid excuse type';end if;
 select * into c from public.clinics where id=coalesce(nullif(data->>'clinic_id','')::uuid,dr.clinic_id) and institution_id=dr.institution_id and active;
 if c.id is null or trim(dr.doctor_code)='' then raise exception 'Configure doctor code and clinic before issuing';end if;
 select * into r from public.excuse_reasons where id=(data->>'reason_id')::uuid and active;
 if r.id is null then raise exception 'Select valid absence reason';end if;
 if nullif(data->>'diagnosis_id','') is not null then select * into dx from public.diagnoses where id=(data->>'diagnosis_id')::uuid and active;if dx.id is null then raise exception 'Invalid diagnosis';end if;end if;
 if show_code and dx.id is null then raise exception 'Diagnosis required when printing code';end if;
 t:=private.excuse_template(dr.institution_id,k);
 return jsonb_build_object('date_from',data->>'date_from','date_to',data->>'date_to','category',r.name,'school',left(coalesce(data->>'school',''),300),'notes',left(coalesce(data->>'notes',''),4000),'excuse_type',k,'template',t,'clinic',jsonb_build_object('id',c.id,'name',c.name,'code',c.code,'address',c.address,'city',c.city,'phone',c.phone,'email',c.email),'doctor_code',dr.doctor_code,'signer_fingerprint',private.signer_fingerprint(did),'diagnosis_code',case when show_code then dx.code else null end);
end $$;
create function public.excuse_context(patient_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);dr public.doctors;
begin if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 select * into dr from public.doctors where id=did;
 return jsonb_build_object('doctor',to_jsonb(dr)||jsonb_build_object('signer_fingerprint',private.signer_fingerprint(dr.id)),'clinics',coalesce((select jsonb_agg(to_jsonb(c) order by c.name) from public.clinics c where institution_id=dr.institution_id and active),'[]'),'reasons',coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from public.excuse_reasons r where active),'[]'));
end $$;

create or replace function public.issue_document(patient_id uuid,document_kind text,data jsonb,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare did uuid:=private.treating_doctor(patient_id);doc_id uuid;existing public.documents;p public.patients;dr public.doctors;i public.institutions;doc_number text;expires date:=(data->>'expires_on')::date;enc uuid:=nullif(data->>'encounter_id','')::uuid;details jsonb;item jsonb;med public.medications;med_items jsonb:='[]';prescription_id uuid;payload jsonb;issued timestamptz:=now();
begin
 if did is null then raise exception 'Forbidden' using errcode='42501';end if;
 -- Serialize retries for a single issuer request key, including simultaneous clicks.
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||request_id::text,0));
 select * into existing from public.documents d where d.created_by=auth.uid() and d.request_id=issue_document.request_id;
 if existing.id is not null then if existing.patient_id<>patient_id or existing.kind<>document_kind then raise exception 'Request key already used';end if;return existing.id;end if;
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
 insert into public.referrals(document_id,encounter_id,referral_type,specialty,reason,diagnosis_id,priority,notes,created_by) values(doc_id,enc,details->>'referral_type',details->>'specialty',details->>'reason',nullif(details->>'diagnosis_id','')::uuid,details->>'priority',details->>'notes',auth.uid());
 else
 insert into public.school_excuses(document_id,encounter_id,date_from,date_to,category,school,notes,created_by) values(doc_id,enc,(details->>'date_from')::date,(details->>'date_to')::date,details->>'category',details->>'school',details->>'notes',auth.uid());
 if data ? 'excuse_type' then update public.school_excuses set excuse_type=data->>'excuse_type',clinic_id=(details->'clinic'->>'id')::uuid,diagnosis_id=nullif(data->>'diagnosis_id','')::uuid,reason_id=(data->>'reason_id')::uuid,template_id=nullif(details->'template'->>'id','')::uuid,print_diagnosis=coalesce((data->>'print_diagnosis')::boolean,false) where document_id=doc_id;end if;end if;
 insert into public.digital_signatures(document_id,signed_by,signature_hash,signature_method,certificate_name) values(doc_id,auth.uid(),private.sign_document(did,payload),'HMAC_SHA256_INTERNAL','e-Zdravstvo · '||dr.display_name||' · '||private.signer_fingerprint(did));
 insert into public.document_verifications(document_id) values(doc_id);
 if p.user_id is not null then insert into public.notifications(user_id,document_id,message) values(p.user_id,doc_id,dr.display_name||' izdao/la je '||case document_kind when 'PRESCRIPTION' then 'recept' when 'REFERRAL' then 'uputnicu' else 'ispričnicu' end||' '||doc_number);end if;
 perform private.audit_event(document_kind||'_ISSUED','documents',doc_id);return doc_id;
end $$;
create or replace function private.document_card(d public.documents) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',d.id,'patient_id',d.patient_id,'kind',d.kind,'number',d.number,'status',private.document_status(d),'issued_at',d.issued_at,'expires_on',d.expires_on,'payload',d.payload,'revocation_reason',d.revocation_reason,
 'can_revoke',d.created_by=auth.uid() and private.treating_doctor(d.patient_id) is not null and private.document_status(d) in ('ISSUED','VALID'),
 'verification_token',(select v.id from public.document_verifications v where v.document_id=d.id),
 'signature',(select jsonb_build_object('signed_at',s.signed_at,'signature_hash',s.signature_hash,'signature_method',s.signature_method,'certificate_name',s.certificate_name,'status',s.status,'integrity_valid',private.signature_valid(d.id)) from public.digital_signatures s where s.document_id=d.id));
$$;
create or replace function public.verify_document(verification_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.documents;valid_hash boolean;code text:=trim(verification_code);begin
 if code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
 select doc.* into d from public.document_verifications v join public.documents doc on doc.id=v.document_id where v.id=code::uuid;
 elsif private.has_role('SCHOOL_ADMIN') and code ~ '^EZ-ISP-[0-9]{4}-[0-9]{8}$' then select * into d from public.documents where number=code and kind='SCHOOL_EXCUSE';
 else return null;end if;
 if d.id is null then return null;end if;
 select private.signature_valid(d.id) into valid_hash;
 perform private.audit_event('DOCUMENT_VERIFIED','documents',d.id);
 return jsonb_build_object('number',d.number,'kind',d.kind,'issuer',d.payload->>'doctor','institution',d.payload->>'institution','issued_at',d.issued_at,'expires_on',d.expires_on,'status',case when not coalesce(valid_hash,false) then 'INVALID' else private.document_status(d) end,'signature_method',(select signature_method from public.digital_signatures where document_id=d.id));
end $$;
revoke all on function private.school_excuse_details(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.excuse_context(uuid) from public,anon;
grant execute on function public.excuse_context(uuid) to authenticated;
commit;

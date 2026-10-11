begin;
-- Demographics needed by the patient's own attachment; no diagnoses, notes or referral content.
create function private.booking_pdf_details(appointment uuid,booking uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
 'patientBirthDate',p.birth_date,
 'patientAddress',nullif(concat_ws(', ',nullif(p.address,''),nullif(concat_ws(' ',nullif(p.postal_code,''),nullif(p.city,'')),'')),''),
 'patientPhone',nullif(p.phone,''),
 'institutionAddress',nullif(concat_ws(', ',nullif(i.address,''),nullif(concat_ws(' ',nullif(i.postal_code,''),nullif(i.city,'')),'')),''),
 'institutionPhone',nullif(i.phone,''),
 'bookedAt',entity.created_at,
 'bookedBy',coalesce(nullif(entity.referring_doctor,''),nullif(trim(concat_ws(' ',actor.first_name,actor.last_name)),'')))
 from (
 select a.patient_id,a.institution_id,a.created_at,a.created_by,null::text referring_doctor from public.appointments a where a.id=appointment
 union all
 select b.patient_id,s.institution_id,b.created_at,b.created_by,d.display_name from public.hospital_bookings b
 join public.hospital_slots sl on sl.id=b.slot_id join public.hospital_services s on s.id=sl.service_id
 join public.doctors d on d.id=b.referring_doctor_id where b.id=booking
 ) entity join public.patients p on p.id=entity.patient_id join public.institutions i on i.id=entity.institution_id
 left join public.profiles actor on actor.id=entity.created_by
$$;
revoke all on function private.booking_pdf_details(uuid,uuid) from public,anon,authenticated;
create or replace function private.add_booking_email_reference() returns trigger language plpgsql security definer set search_path='' as $$
declare appointment uuid;booking uuid;reference text;pdf_details jsonb;
begin
 if TG_TABLE_NAME='appointment_email_snapshots' then
 select n.appointment_id,n.hospital_booking_id into appointment,booking from public.notifications n where n.id=new.notification_id;
 else appointment:=new.appointment_id;booking:=new.hospital_booking_id;end if;
 select 'PREG-'||r.booked_year::text||'-'||lpad(r.sequence_number::text,greatest(5,length(r.sequence_number::text)),'0')
 into reference from private.booking_email_references r where r.appointment_id=appointment or r.hospital_booking_id=booking;
 if reference is not null then new.payload:=new.payload||jsonb_build_object('bookingReference',reference);end if;
 pdf_details:=private.booking_pdf_details(appointment,booking);
 if pdf_details is not null then new.payload:=new.payload||jsonb_build_object('pdfDetails',pdf_details);end if;
 return new;
end $$;
-- Existing unattempted messages can include the attachment details. Attempted payloads stay immutable.
update private.appointment_email_snapshots s set payload=s.payload||jsonb_build_object('pdfDetails',private.booking_pdf_details(n.appointment_id,n.hospital_booking_id))
from public.notifications n,private.notification_email_outbox o
where n.id=s.notification_id and o.notification_id=n.id and o.status='PENDING' and o.attempts=0;
update private.contact_appointment_email_events e set payload=e.payload||jsonb_build_object('pdfDetails',private.booking_pdf_details(e.appointment_id,e.hospital_booking_id))
from private.notification_email_outbox o where o.contact_event_id=e.id and o.status='PENDING' and o.attempts=0;
commit;

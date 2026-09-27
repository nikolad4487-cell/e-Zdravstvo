-- Trusted seed scripts need the default internal patient-number sequence.
grant usage on schema private to service_role;
grant usage on sequence private.patient_number to service_role;

-- Safe reference seed; contains no real people and no fixed passwords.
insert into public.institutions(id,name,code,address,city,postal_code)
values('10000000-0000-4000-8000-000000000001','Testna poliklinika Vedrina','DEMO-VEDRINA','Primjerna ulica 12','Testni Grad','10000')
on conflict(id) do nothing;
insert into public.institution_departments(id,institution_id,name,code)
values('10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Obiteljska medicina — testni odjel','OM-DEMO')
on conflict(id) do nothing;

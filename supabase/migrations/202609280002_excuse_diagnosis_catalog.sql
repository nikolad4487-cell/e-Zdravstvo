-- Small verified subset, HZJZ MKB-10 version 2019. Retrieved 2026-09-28.
-- Source: https://mkb.hzjz.hr/api/data/single?disease_code=CODE
-- This is not the complete national classification.
begin;
insert into public.diagnoses(code,name,coding_system) values
('J00','Akutni nazofaringitis [obična prehlada]','MKB-10-2019'),
('J02.9','Akutni faringitis, nespecificiran','MKB-10-2019'),
('J03.9','Akutni tonzilitis, nespecificiran','MKB-10-2019'),
('J06.9','Akutna infekcija gornjega dišnog sustava, nespecificirana','MKB-10-2019'),
('A09','Drugi gastroenteritis i kolitis infektivnog i nespecificiranog podrijetla','MKB-10-2019'),
('R50.9','Vrućica, nespecificirana','MKB-10-2019'),
('R51','Glavobolja','MKB-10-2019'),
('S93.4','Uganuće i nategnuće gležnja','MKB-10-2019')
on conflict(coding_system,code) do nothing;
commit;

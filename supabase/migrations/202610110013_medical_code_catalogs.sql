begin;
create table public.medical_code_sources(id text primary key,file_name text not null,file_sha256 text not null,revision text not null,expected_count integer not null,imported_count integer not null default 0,imported_at timestamptz);
create table public.medical_code_lists(id text primary key,source_id text not null references public.medical_code_sources(id),name text not null,oid text,source_text text not null,external_only boolean not null default false);
create table public.medical_codes(list_id text not null references public.medical_code_lists(id),code text not null,name text not null,description text not null,source_page integer,primary key(list_id,code));
alter table public.diagnoses add column catalog_source text references public.medical_code_sources(id),add column catalog_metadata jsonb;
create function private.code_search_text(value text) returns text language sql immutable set search_path='' as $$select translate(lower(coalesce(value,'')),'čćđšž','ccdsz')$$;
alter table public.diagnoses add column search_text text generated always as (private.code_search_text(code||' '||replace(code,'.','')||' '||name)) stored;
create index diagnosis_code_search on public.diagnoses(code text_pattern_ops);
create index medical_code_name on public.medical_codes(list_id,code text_pattern_ops);
revoke all on public.medical_code_sources,public.medical_code_lists,public.medical_codes from public,anon,authenticated;
alter table public.medical_code_sources enable row level security;
alter table public.medical_code_lists enable row level security;
alter table public.medical_codes enable row level security;

create function public.search_diagnosis_codes(search_term text default '',page_number integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=private.code_search_text(trim(search_term));result jsonb;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if search_term is null or length(search_term)>200 or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid search';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(
  select d.id,d.code,d.name,d.coding_system,d.catalog_metadata from(
    select distinct on (code) * from public.diagnoses where active and (term='' or strpos(search_text,term)>0)
    order by code,(catalog_source is not null) desc,coding_system,id
  )d order by (private.code_search_text(d.code)=term) desc,(strpos(private.code_search_text(d.code),term)=1) desc,d.code limit 50 offset page_number*50
 )x;return result;
end $$;
create function public.medical_code_catalogs() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]') from public.medical_code_sources s),'lists',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'oid',l.oid,'external_only',l.external_only,'count',(select count(*) from public.medical_codes c where c.list_id=l.id)) order by l.id),'[]') from public.medical_code_lists l));
end $$;
create function public.search_medical_codes(catalog_id text,search_term text default '',page_number integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=private.code_search_text(trim(search_term));result jsonb;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if catalog_id is null or search_term is null or length(search_term)>200 or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid search';end if;
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') into result from(select c.* from public.medical_codes c where c.list_id=catalog_id and (term='' or strpos(private.code_search_text(c.code||' '||c.name||' '||c.description),term)>0) order by (private.code_search_text(c.code)=term) desc,c.code limit 50 offset page_number*50)x;return result;
end $$;
create function public.medical_code_source(catalog_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 return(select to_jsonb(l) from public.medical_code_lists l where id=catalog_id);
end $$;
revoke all on function private.code_search_text(text) from public,anon,authenticated;
revoke all on function public.search_diagnosis_codes(text,integer),public.medical_code_catalogs(),public.search_medical_codes(text,text,integer),public.medical_code_source(text) from public,anon;
grant execute on function public.search_diagnosis_codes(text,integer),public.medical_code_catalogs(),public.search_medical_codes(text,text,integer),public.medical_code_source(text) to authenticated;
-- Retain existing local settings in small contexts; full catalogs use paginated search.
do $$ declare definition text;begin
 select pg_get_functiondef('public.clinical_context()'::regprocedure) into definition;
 definition:=replace(definition,'from public.diagnoses d where d.active and auth.uid() is not null','from public.diagnoses d where d.active and d.catalog_source is null and auth.uid() is not null');execute definition;
 select pg_get_functiondef('public.admin_configuration()'::regprocedure) into definition;
 definition:=replace(definition,'from public.diagnoses d)', 'from public.diagnoses d where d.catalog_source is null)');execute definition;
end $$;
insert into public.medical_code_sources(id,file_name,file_sha256,revision,expected_count) values('CEZIH-UPLOAD','01_22_CEZIH_Specifikacija_kodnih_lista_Rev_BF.pdf','0bcdc405a79ddbdee74885d548dc66ffba346f6f2dd2db7742c29aec55038a46','RevBE 2023-07-12 (printed in supplied PDF)',1648);
insert into public.medical_code_lists(id,source_id,name,oid,source_text,external_only) values('2.2.5','CEZIH-UPLOAD','kodna lista vrste upućivanja','2.16.840.1.113883.2.7.10.10.9','Naziv kodne liste:        kodna lista vrste upućivanja
                    Izvor kodne liste:        HZJZ, ETK
                    OID Kodne liste:          2.16.840.1.113883.2.7.10.10.9



                    Sadržaj kodne liste:


                             Šifra                          Opis
                              A1      Konzilijarni pregled
                              A2      Kontrolni konzilijarni pregled
                              A3      Dijagnostička pretraga
                              C1      Pregled i cjelovita obrada u specijalističkoj
                                      zdravstvenoj zaštiti
                              C2      Pregled i obrada kroz Objedinjeni hitni
                                      bolniĂ¨ki prijam odnosno kroz hitne
                                      specijalističke ambulante u bolničkim
                                      ustanovama bez organiziranog
                                      Objedinjenog hitnog bolničkog prijama na
                                      koju upućuje izabrani doktor PZZ-a
                              C3      Prije operativna obrada za nepokretne i/ili
                                      teško pokretne pacijente
                              D1      Ambulantno liječenje (mala kirurgija,
                                      višednevno ili ponavljajuće liječenje prema
                                      unaprijed odredenoj proceduri u pravilu u
                                      trajanju kraćem od 6 sati, te aplikacija
                                      ponavljajuće terapije kroz duže razdoblje)
                              D2      Dnevna bolnica (jednodnevna kirurgija,
                                      liječenje kojem može prethoditi ili iz kojeg
                                      može proizići dijagnostika, a koje je u pravilu
                                      u trajanju dužem od 6 i kraćem od 24 sata)
                              A4      Drugo mišljenje prema indikaciji izabranog
                                      liječnika
                              A5      Konzultacije (uputnica bez osigurana osobe)
                              A6      Kontrolna dijagnostička pretraga
                              B1      Bolničko liječenje
                              B2      Ponavljajuće bolničko liječenje
                              K       Posebna forma stanardne eUputnice koja se
                                      propisuje u sklopu nacionalnih preventivnih
                                      programa',false);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A1','Konzilijarni pregled','Konzilijarni pregled',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A2','Kontrolni konzilijarni pregled','Kontrolni konzilijarni pregled',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A3','Dijagnostička pretraga','Dijagnostička pretraga',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','C1','Pregled i cjelovita obrada u specijalističkoj zdravstvenoj zaštiti','Pregled i cjelovita obrada u specijalističkoj zdravstvenoj zaštiti',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','C2','Pregled i obrada kroz Objedinjeni hitni bolnički prijam odnosno kroz hitne specijalističke ambulante u bolničkim ustanovama bez organiziranog Objedinjenog hitnog bolničkog prijama na koju upućuje izabrani doktor PZZ-a','Pregled i obrada kroz Objedinjeni hitni bolnički prijam odnosno kroz hitne specijalističke ambulante u bolničkim ustanovama bez organiziranog Objedinjenog hitnog bolničkog prijama na koju upućuje izabrani doktor PZZ-a',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','C3','Prije operativna obrada za nepokretne i/ili teško pokretne pacijente','Prije operativna obrada za nepokretne i/ili teško pokretne pacijente',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','D1','Ambulantno liječenje (mala kirurgija, višednevno ili ponavljajuće liječenje prema unaprijed odredenoj proceduri u pravilu u trajanju kraćem od 6 sati, te aplikacija ponavljajuće terapije kroz duže razdoblje)','Ambulantno liječenje (mala kirurgija, višednevno ili ponavljajuće liječenje prema unaprijed odredenoj proceduri u pravilu u trajanju kraćem od 6 sati, te aplikacija ponavljajuće terapije kroz duže razdoblje)',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','D2','Dnevna bolnica (jednodnevna kirurgija, liječenje kojem može prethoditi ili iz kojeg može proizići dijagnostika, a koje je u pravilu u trajanju dužem od 6 i kraćem od 24 sata)','Dnevna bolnica (jednodnevna kirurgija, liječenje kojem može prethoditi ili iz kojeg može proizići dijagnostika, a koje je u pravilu u trajanju dužem od 6 i kraćem od 24 sata)',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A4','Drugo mišljenje prema indikaciji izabranog liječnika','Drugo mišljenje prema indikaciji izabranog liječnika',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A5','Konzultacije (uputnica bez osigurana osobe)','Konzultacije (uputnica bez osigurana osobe)',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','A6','Kontrolna dijagnostička pretraga','Kontrolna dijagnostička pretraga',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','B1','Bolničko liječenje','Bolničko liječenje',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','B2','Ponavljajuće bolničko liječenje','Ponavljajuće bolničko liječenje',15);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.5','K','Posebna forma stanardne eUputnice koja se propisuje u sklopu nacionalnih preventivnih programa','Posebna forma stanardne eUputnice koja se propisuje u sklopu nacionalnih preventivnih programa',15);
insert into public.medical_code_lists(id,source_id,name,oid,source_text,external_only) values('2.2.39','CEZIH-UPLOAD','Vrsta naplaćene usluge/materijala u PZZ',null,'Naziv kodne liste:        Vrsta naplaćene usluge/materijala u PZZ

                    Sadržaj kodne liste:

                             Šifra                             Opis
                            01        Prvi pregled
                            02        Kontrolni pregled',false);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.39','01','Prvi pregled','Prvi pregled',42);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.39','02','Kontrolni pregled','Kontrolni pregled',42);
insert into public.medical_code_lists(id,source_id,name,oid,source_text,external_only) values('2.2.42','CEZIH-UPLOAD','Vrsta pregleda',null,'Naziv kodne liste:        Vrsta pregleda
                    Namjena:                  SKZZ uputnica – HL7 sučelje
                    Web referenca:
                    Pristup:

                    Sadržaj kodne liste:

                             Šifra                       Opis
                            1         Jednostavni pregled
                            2         Složeni pregled',false);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.42','1','Jednostavni pregled','Jednostavni pregled',43);
insert into public.medical_codes(list_id,code,name,description,source_page) values('2.2.42','2','Složeni pregled','Složeni pregled',43);
commit;

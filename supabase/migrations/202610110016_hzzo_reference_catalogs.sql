begin;
-- Dates describe the supplied version; unknown/legacy sources never imply official currency.
alter table public.medical_code_sources add column metadata jsonb not null default '{}';
alter table public.medical_code_lists add column metadata jsonb not null default '{}';
alter table public.medical_codes add column metadata jsonb not null default '{}',add column search_text text generated always as (private.code_search_text(code||' '||name||' '||description)) stored;
create or replace function public.medical_code_catalogs() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 return jsonb_build_object('sources',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from public.medical_code_sources s),'lists',(select coalesce(jsonb_agg(jsonb_build_object('id',l.id,'source_id',l.source_id,'name',l.name,'oid',l.oid,'metadata',l.metadata,'external_only',l.external_only,'count',(select count(*) from public.medical_codes c where c.list_id=l.id)) order by l.id),'[]') from public.medical_code_lists l));
end $$;
create or replace function public.search_medical_codes(catalog_id text,search_term text default '',page_number integer default 0) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare term text:=private.code_search_text(trim(search_term));result jsonb;
begin
 if auth.uid() is null then raise exception 'Forbidden' using errcode='42501';end if;
 if catalog_id is null or search_term is null or length(search_term)>200 or page_number is null or page_number not between 0 and 10000 then raise exception 'Invalid search';end if;
 select coalesce(jsonb_agg(to_jsonb(x)-'search_text'),'[]') into result from(select c.* from public.medical_codes c where c.list_id=catalog_id and (term='' or strpos(c.search_text,term)>0) order by (private.code_search_text(c.code)=term) desc,c.code limit 50 offset page_number*50)x;return result;
end $$;
revoke all on function public.medical_code_catalogs(),public.search_medical_codes(text,text,integer) from public,anon;
grant execute on function public.medical_code_catalogs(),public.search_medical_codes(text,text,integer) to authenticated;
commit;

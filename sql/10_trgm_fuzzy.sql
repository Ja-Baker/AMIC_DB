-- Typo tolerance + broader keyword coverage. Applied as migration
-- amic_trgm_and_broaden_fts (the RRF fuzzy arm itself lives in 07_hybrid_search.sql).
create extension if not exists pg_trgm;

-- array_to_string is STABLE (rejected in generated columns); wrap as IMMUTABLE.
create or replace function amic_text_join(arr text[])
  returns text language sql immutable parallel safe
  set search_path = pg_catalog
  as $$ select array_to_string(arr, ' ') $$;

-- Broaden the keyword (FTS) index to also cover tags + city. The generated-column
-- expression can't be ALTERed in place, so drop & re-add (re-tokenizes all rows).
drop index if exists contacts_fts_idx;
alter table contacts drop column if exists fts;
alter table contacts add column fts tsvector generated always as (
  to_tsvector('english',
    coalesce(full_name,'')    || ' ' || coalesce(title,'')                    || ' ' ||
    coalesce(organization,'') || ' ' || coalesce(amic_text_join(tags),'')     || ' ' ||
    coalesce(city,'')         || ' ' || coalesce(notes,''))
) stored;
create index contacts_fts_idx on contacts using gin (fts);

-- Trigram indexes for fuzzy name / organization lookup.
create index if not exists contacts_fullname_trgm on contacts using gin (lower(full_name) gin_trgm_ops);
create index if not exists contacts_org_trgm      on contacts using gin (lower(organization) gin_trgm_ops);

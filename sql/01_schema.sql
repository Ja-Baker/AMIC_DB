-- AMIC contact database — core schema (applied as migration amic_core_schema).
create extension if not exists vector;
create extension if not exists pg_trgm;   -- fuzzy / typo-tolerant name+org search

-- array_to_string is STABLE (rejected in generated columns); wrap as IMMUTABLE.
create or replace function amic_text_join(arr text[])
  returns text language sql immutable parallel safe
  set search_path = pg_catalog
  as $$ select array_to_string(arr, ' ') $$;

create table organizations (
  org_id text primary key,
  name text not null,
  category text,
  website text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip text,
  employees_local integer,
  employees_companywide integer,
  source_lists text[],          -- handoff DDL typo'd this as `source_s`
  notes text
);

create table contacts (
  contact_id text primary key,
  first_name text,
  last_name text,
  full_name text not null,
  title text,
  organization text,
  org_id text references organizations(org_id),
  email text,
  email_status text check (email_status in ('valid format','missing','check')),
  phone text,
  linkedin text,
  city text,
  state text,
  location_raw text,
  tags text[],
  source_lists text[],
  do_not_contact boolean default false,
  poc text check (poc is null or poc in ('TH','KM','BW','DS')),  -- AMIC point of contact
  last_contacted date,
  notes text,
  needs_review text,
  embedding vector(768),         -- BAAI/bge-base-en-v1.5
  fts tsvector generated always as (
    to_tsvector('english',
      coalesce(full_name,'')    || ' ' || coalesce(title,'')                    || ' ' ||
      coalesce(organization,'') || ' ' || coalesce(amic_text_join(tags),'')     || ' ' ||
      coalesce(city,'')         || ' ' || coalesce(notes,''))
  ) stored
);

create table memberships (
  id bigint generated always as identity primary key,
  contact_id text references contacts(contact_id),
  source_file text,
  list_category text,
  email_as_listed text,
  org_as_listed text
);

create table merge_log (
  contact_id text references contacts(contact_id),
  full_name text,
  rows_merged integer,
  sources text,
  original_rows text
);

create index contacts_fts_idx       on contacts using gin (fts);
create index contacts_tags_idx      on contacts using gin (tags);
create index contacts_email_idx     on contacts (email);
create index contacts_state_idx     on contacts (state);
create index contacts_poc_idx       on contacts (poc);
create index memberships_contact_idx on memberships (contact_id);
create index contacts_embedding_idx on contacts using hnsw (embedding vector_cosine_ops);
create index contacts_fullname_trgm on contacts using gin (lower(full_name) gin_trgm_ops);
create index contacts_org_trgm      on contacts using gin (lower(organization) gin_trgm_ops);

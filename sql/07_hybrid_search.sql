-- Hybrid search RPC — Reciprocal Rank Fusion (RRF) of semantic + keyword + fuzzy.
-- Migrations: amic_hybrid_search_rpc -> amic_pin_function_search_path ->
--   amic_hybrid_search_add_name_poc -> amic_hybrid_search_rrf ->
--   amic_hybrid_search_rrf_fuzzy (current).
--
-- Three ranking arms fused by RANK position (scale-independent), so exact matches
-- and close/typo matches both surface regardless of raw-score scale:
--   1. semantic  — cosine distance on the bge embedding (ranks all rows)
--   2. keyword   — ts_rank_cd over fts; OR semantics (AND matched ~nothing multi-word)
--   3. fuzzy     — pg_trgm word_similarity on name/org (typo + partial-name tolerance)
-- The keyword + fuzzy arms share the (1 - semantic_weight) side. match_field tells the
-- UI why a row matched: name/organization/title/tags/city/notes (exact) or 'similar'
-- (fuzzy) or null (semantic-only). match_field is computed only on the final page.
-- Return-type changes require DROP then CREATE.
drop function if exists hybrid_search_contacts(
  vector, text, text[], text, text, text, text, boolean, real, integer);

create function hybrid_search_contacts(
  query_embedding     vector(768) default null,
  query_text          text        default null,
  filter_tags         text[]      default null,
  filter_state        text        default null,
  filter_email_status text        default null,
  filter_source       text        default null,
  filter_poc          text        default null,
  include_dnc         boolean     default false,
  semantic_weight     real        default 0.7,
  match_count         integer     default 25
)
returns table (
  contact_id text, first_name text, last_name text, full_name text,
  title text, organization text, org_id text,
  email text, email_status text, phone text, linkedin text, city text, state text,
  tags text[], source_lists text[], poc text, do_not_contact boolean, notes text,
  match_field text, semantic_score real, keyword_score real, score real
)
language sql
stable
set search_path = pg_catalog, public
as $$
  with p as (
    select case when query_text is not null and length(trim(query_text)) > 0
           then replace(websearch_to_tsquery('english', query_text)::text, ' & ', ' | ')::tsquery
           end as kwq,
           nullif(btrim(lower(coalesce(query_text,''))), '') as qz
  ),
  filtered as (
    select c.* from contacts c, p
    where (filter_tags is null         or c.tags && filter_tags)
      and (filter_state is null        or c.state = filter_state)
      and (filter_email_status is null or c.email_status = filter_email_status)
      and (filter_source is null       or c.source_lists && array[filter_source])
      and (filter_poc is null          or c.poc = filter_poc)
      and (include_dnc or coalesce(c.do_not_contact, false) = false)
      and ( (query_embedding is null and p.kwq is null)              -- pure filter browse
            or query_embedding is not null                            -- semantic ranks all
            or (p.kwq is not null and c.fts @@ p.kwq)                 -- keyword
            or (p.qz is not null and (                                -- fuzzy name/org
                  word_similarity(p.qz, lower(coalesce(c.full_name,'')))    > 0.45
               or word_similarity(p.qz, lower(coalesce(c.organization,''))) > 0.45)) )
  ),
  sem as (
    select contact_id,
           row_number() over (order by embedding <=> query_embedding) as rnk,
           (1 - (embedding <=> query_embedding))::real as sscore
    from filtered
    where query_embedding is not null and embedding is not null
  ),
  kw as (
    select f.contact_id,
           row_number() over (order by ts_rank_cd(f.fts, p.kwq, 32) desc) as rnk,
           ts_rank_cd(f.fts, p.kwq, 32)::real as kscore
    from filtered f, p
    where p.kwq is not null and f.fts @@ p.kwq
  ),
  fz as (
    select contact_id, row_number() over (order by sim desc) as rnk
    from (
      select f.contact_id,
             greatest(word_similarity(p.qz, lower(coalesce(f.full_name,''))),
                      word_similarity(p.qz, lower(coalesce(f.organization,'')))) as sim
      from filtered f, p
      where p.qz is not null
    ) s
    where sim > 0.45
  ),
  ranked as (
    select f.contact_id, f.last_name, f.full_name,
           coalesce(sem.sscore, 0)::real as semantic_score,
           coalesce(kw.kscore, 0)::real  as keyword_score,
           (kw.rnk is not null) as kw_hit,
           (fz.rnk is not null) as fz_hit,
           ( semantic_weight       * coalesce(1.0 / (60 + sem.rnk), 0)
             + (1 - semantic_weight) * coalesce(1.0 / (60 + kw.rnk), 0)
             + (1 - semantic_weight) * coalesce(1.0 / (60 + fz.rnk), 0) )::real as score
    from filtered f
    left join sem on sem.contact_id = f.contact_id
    left join kw  on kw.contact_id  = f.contact_id
    left join fz  on fz.contact_id  = f.contact_id
    order by score desc, f.last_name asc nulls last, f.full_name asc
    limit greatest(match_count, 1)
  )
  select
    c.contact_id, c.first_name, c.last_name, c.full_name, c.title, c.organization,
    c.org_id, c.email, c.email_status, c.phone, c.linkedin, c.city, c.state,
    c.tags, c.source_lists, c.poc, c.do_not_contact, c.notes,
    case
      when p.kwq is not null and to_tsvector('english', coalesce(c.full_name,''))            @@ p.kwq then 'name'
      when p.kwq is not null and to_tsvector('english', coalesce(c.organization,''))         @@ p.kwq then 'organization'
      when p.kwq is not null and to_tsvector('english', coalesce(c.title,''))                @@ p.kwq then 'title'
      when p.kwq is not null and to_tsvector('english', coalesce(amic_text_join(c.tags),'')) @@ p.kwq then 'tags'
      when p.kwq is not null and to_tsvector('english', coalesce(c.city,''))                 @@ p.kwq then 'city'
      when r.kw_hit then 'notes'
      when r.fz_hit then 'similar'
      else null
    end as match_field,
    r.semantic_score, r.keyword_score, r.score
  from ranked r
  join contacts c on c.contact_id = r.contact_id
  cross join p
  order by r.score desc, c.last_name asc nulls last, c.full_name asc
$$;

revoke all on function hybrid_search_contacts from public, anon;
grant execute on function hybrid_search_contacts to authenticated;

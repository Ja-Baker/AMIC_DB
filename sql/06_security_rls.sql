-- RLS: authenticated-only access (PII). No anon policies => zero anonymous access.
-- Applied as migration amic_rls_authenticated_only.
alter table organizations enable row level security;
alter table contacts      enable row level security;
alter table memberships   enable row level security;
alter table merge_log     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['organizations','contacts','memberships','merge_log'] loop
    execute format('create policy %I on %I for select to authenticated using (true)',      t||'_auth_select', t);
    execute format('create policy %I on %I for insert to authenticated with check (true)',  t||'_auth_insert', t);
    execute format('create policy %I on %I for update to authenticated using (true) with check (true)', t||'_auth_update', t);
  end loop;
end $$;

-- Named, reusable outreach lists. Applied as migration amic_saved_lists.
create table if not exists contact_lists (
  id         bigint generated always as identity primary key,
  name       text not null,
  created_at timestamptz not null default now()
);

create table if not exists contact_list_members (
  list_id    bigint not null references contact_lists(id) on delete cascade,
  contact_id text   not null references contacts(contact_id) on delete cascade,
  added_at   timestamptz not null default now(),
  primary key (list_id, contact_id)
);
create index if not exists contact_list_members_contact_idx on contact_list_members(contact_id);

alter table contact_lists        enable row level security;
alter table contact_list_members enable row level security;
create policy lists_auth_all   on contact_lists        for all to authenticated using (true) with check (true);
create policy members_auth_all on contact_list_members for all to authenticated using (true) with check (true);

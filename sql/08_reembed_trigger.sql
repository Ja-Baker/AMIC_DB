-- Flag a contact for re-embedding when its card fields change. Applied as
-- migration amic_reembed_flag_trigger (+ amic_pin_function_search_path).
-- The backfill (CODEBASE/embed.py) embeds any contact whose embedding is null.
create or replace function flag_contact_for_reembedding()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (new.full_name    is distinct from old.full_name
      or new.title        is distinct from old.title
      or new.organization is distinct from old.organization
      or new.tags         is distinct from old.tags
      or new.notes        is distinct from old.notes) then
    new.embedding := null;
  end if;
  return new;
end $$;

create trigger contacts_reembed_on_change
before update on contacts
for each row
execute function flag_contact_for_reembedding();

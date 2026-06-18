-- Bulk import + email enrichment support. Applied as migration
-- amic_import_email_enrich.
--
-- Two new columns track WHERE a contact's email came from so guessed/looked-up
-- addresses never silently masquerade as verified ones:
--   email_source     'import' | 'manual' | 'pattern' | 'hunter' | null
--   email_confidence 0..1 score from the finder (null for hand-entered)
-- Found emails are written with email_status = 'check' so the grid flags them
-- as needing a human confirmation before they go into an outreach blast.

alter table contacts
  add column if not exists email_source     text,
  add column if not exists email_confidence real
    check (email_confidence is null
           or (email_confidence >= 0 and email_confidence <= 1));

comment on column contacts.email_source is
  'Provenance of email: import | manual | pattern | hunter | null(original handoff)';
comment on column contacts.email_confidence is
  'Finder confidence 0..1 for guessed/looked-up emails; null for hand-entered';

-- Index the bulk-import batch label so "show me everything from this import"
-- and dedupe-by-source stay fast as more lists get loaded.
create index if not exists contacts_email_source_idx on contacts (email_source);

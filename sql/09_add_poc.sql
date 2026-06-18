-- AMIC POC (point of contact) column. Applied as migration amic_add_poc_column.
-- One of TH/KM/BW/DS (initials) or null/unassigned. Editable from the web app.
alter table contacts
  add column if not exists poc text
  check (poc is null or poc in ('TH','KM','BW','DS'));

comment on column contacts.poc is
  'AMIC point of contact initials: TH=Tracy Henke, KM=Kory Mathews, BW=Brandon Wegge, DS=Doug Stuart';

create index if not exists contacts_poc_idx on contacts (poc);

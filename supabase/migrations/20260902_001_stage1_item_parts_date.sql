-- RETRADE Stage 1 sync repair — 2026-09-02
--
-- Root cause: the live app persists item_parts.date, but the v1.4.5 schema
-- repair omitted that column while still advertising the schema as current.
-- This migration is additive, idempotent, and does not delete or rewrite data.

begin;

alter table public.item_parts
  add column if not exists date date;

-- Keep the user/item lookup used by load/save paths efficient.
create index if not exists item_parts_user_item_idx
  on public.item_parts(user_id,item_id);

commit;

-- PostgREST may otherwise retain the old column list briefly.
notify pgrst, 'reload schema';

-- Verification: must return exactly one row with data_type = 'date'.
select table_schema, table_name, column_name, data_type
from information_schema.columns
where table_schema='public'
  and table_name='item_parts'
  and column_name='date';

-- RETRADE Stage 2D — owner-scoped query indexes
-- 2026-09-02
--
-- The application loads each user-owned table with eq('user_id', uid), and
-- several of these tables are immediately ordered by a second column. These
-- composite indexes match those production access patterns directly.

begin;

create index if not exists accounts_user_name_idx
  on public.accounts(user_id,name);

create index if not exists item_returns_user_logged_at_idx
  on public.item_returns(user_id,logged_at);

create index if not exists job_lots_user_created_at_idx
  on public.job_lots(user_id,created_at);

create index if not exists sale_reconciliations_user_created_at_idx
  on public.sale_reconciliations(user_id,created_at);

commit;

-- Verification: this should return zero rows after the migration.
with target_tables(table_name) as (
  values
    ('accounts'),
    ('activity_log'),
    ('cash_ledger'),
    ('expenses'),
    ('item_parts'),
    ('item_returns'),
    ('items'),
    ('job_lot_items'),
    ('job_lots'),
    ('retrade_sync_clock'),
    ('sale_reconciliations'),
    ('sourcing_runs'),
    ('trips'),
    ('user_settings')
),
indexed as (
  select distinct
    tbl.relname as table_name
  from pg_class tbl
  join pg_namespace ns
    on ns.oid = tbl.relnamespace
  join pg_index ix
    on ix.indrelid = tbl.oid
  join pg_attribute att
    on att.attrelid = tbl.oid
   and att.attnum = ix.indkey[0]
  where ns.nspname = 'public'
    and ix.indisvalid
    and ix.indisready
    and att.attname = 'user_id'
)
select
  t.table_name
from target_tables t
left join indexed i
  on i.table_name = t.table_name
where i.table_name is null
order by t.table_name;

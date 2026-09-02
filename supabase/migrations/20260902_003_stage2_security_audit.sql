-- RETRADE Stage 2 — read-only Supabase security / integrity audit
-- 2026-09-02
--
-- This script makes NO changes. Run it in the Supabase SQL Editor and share
-- the result sets. It audits the exact tables referenced by the production app.

-- ---------------------------------------------------------------------------
-- 1) RLS status + user_id contract
-- ---------------------------------------------------------------------------
with required(table_name) as (
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
), cols as (
  select table_name,
         bool_or(column_name='user_id') as has_user_id,
         bool_or(column_name='user_id' and is_nullable='NO') as user_id_not_null
  from information_schema.columns
  where table_schema='public'
  group by table_name
)
select
  r.table_name,
  coalesce(c.relrowsecurity,false) as rls_enabled,
  coalesce(cols.has_user_id,false) as has_user_id,
  coalesce(cols.user_id_not_null,false) as user_id_not_null
from required r
left join pg_class c
  on c.relname=r.table_name
 and c.relnamespace='public'::regnamespace
left join cols on cols.table_name=r.table_name
order by r.table_name;

-- ---------------------------------------------------------------------------
-- 2) Policy inventory for app-owned tables
--    Look for USING / WITH CHECK expressions that enforce auth.uid() = user_id.
-- ---------------------------------------------------------------------------
select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd,
  qual as using_expression,
  with_check as with_check_expression
from pg_policies
where schemaname='public'
  and tablename in (
    'accounts','activity_log','cash_ledger','expenses','item_parts','item_returns',
    'items','job_lot_items','job_lots','retrade_sync_clock','sale_reconciliations',
    'sourcing_runs','trips','user_settings'
  )
order by tablename, cmd, policyname;

-- ---------------------------------------------------------------------------
-- 3) Tables with RLS disabled or no policy at all (high priority failures)
-- ---------------------------------------------------------------------------
with required(table_name) as (
  values
    ('accounts'),('activity_log'),('cash_ledger'),('expenses'),('item_parts'),
    ('item_returns'),('items'),('job_lot_items'),('job_lots'),
    ('retrade_sync_clock'),('sale_reconciliations'),('sourcing_runs'),('trips'),
    ('user_settings')
), policy_counts as (
  select tablename,count(*) as policy_count
  from pg_policies
  where schemaname='public'
  group by tablename
)
select
  r.table_name,
  coalesce(c.relrowsecurity,false) as rls_enabled,
  coalesce(pc.policy_count,0) as policy_count
from required r
left join pg_class c
  on c.relname=r.table_name
 and c.relnamespace='public'::regnamespace
left join policy_counts pc on pc.tablename=r.table_name
where not coalesce(c.relrowsecurity,false)
   or coalesce(pc.policy_count,0)=0
order by r.table_name;

-- ---------------------------------------------------------------------------
-- 4) user_id indexes. Every heavily-read user-owned table should have one.
-- ---------------------------------------------------------------------------
select
  t.relname as table_name,
  i.relname as index_name,
  pg_get_indexdef(ix.indexrelid) as index_definition
from pg_class t
join pg_namespace n on n.oid=t.relnamespace and n.nspname='public'
join pg_index ix on ix.indrelid=t.oid
join pg_class i on i.oid=ix.indexrelid
where t.relname in (
  'accounts','activity_log','cash_ledger','expenses','item_parts','item_returns',
  'items','job_lot_items','job_lots','retrade_sync_clock','sale_reconciliations',
  'sourcing_runs','trips','user_settings'
)
  and pg_get_indexdef(ix.indexrelid) ilike '%user_id%'
order by t.relname,i.relname;

-- ---------------------------------------------------------------------------
-- 5) Foreign-key inventory for child/linked tables.
--    This surfaces missing database-level relationship protection.
-- ---------------------------------------------------------------------------
select
  tc.table_name,
  tc.constraint_name,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name,
  rc.delete_rule,
  rc.update_rule
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name=kcu.constraint_name
 and tc.constraint_schema=kcu.constraint_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name=tc.constraint_name
 and ccu.constraint_schema=tc.constraint_schema
join information_schema.referential_constraints rc
  on rc.constraint_name=tc.constraint_name
 and rc.constraint_schema=tc.constraint_schema
where tc.constraint_type='FOREIGN KEY'
  and tc.table_schema='public'
  and tc.table_name in ('item_parts','item_returns','job_lot_items','sale_reconciliations')
order by tc.table_name,tc.constraint_name,kcu.ordinal_position;

-- ---------------------------------------------------------------------------
-- 6) SECURITY DEFINER / RPC inspection for the one client RPC.
--    Confirm owner checks happen inside the function and search_path is safe.
-- ---------------------------------------------------------------------------
select
  n.nspname as schema_name,
  p.proname as function_name,
  p.prosecdef as security_definer,
  pg_get_userbyid(p.proowner) as owner,
  p.proconfig as function_config,
  pg_get_functiondef(p.oid) as function_definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='retrade_delete_my_account_record';

-- ---------------------------------------------------------------------------
-- 7) retrade_meta is intentionally global metadata, not user-owned.
--    Show its RLS/policies separately so we can verify it is read-only to clients.
-- ---------------------------------------------------------------------------
select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled,
  p.policyname,
  p.roles,
  p.cmd,
  p.qual,
  p.with_check
from pg_class c
left join pg_policies p
  on p.schemaname='public' and p.tablename=c.relname
where c.relnamespace='public'::regnamespace
  and c.relname='retrade_meta'
order by p.policyname;

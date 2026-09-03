-- RETRADE Stage 2 final verification — 2026-09-03
--
-- READ ONLY. Makes no schema or data changes.
-- Run in the Supabase SQL Editor after Stage 2E RLS consolidation.
-- The first result set is the close-out scorecard. Every row should be PASS.

-- ---------------------------------------------------------------------------
-- 1) Stage 2 close-out scorecard
-- ---------------------------------------------------------------------------
with
owner_tables(table_name) as (
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
rls_failures as (
  select o.table_name
  from owner_tables o
  left join pg_class c
    on c.relname=o.table_name
   and c.relnamespace='public'::regnamespace
  where c.oid is null or not c.relrowsecurity
),
owner_column_failures as (
  select o.table_name
  from owner_tables o
  left join information_schema.columns c
    on c.table_schema='public'
   and c.table_name=o.table_name
   and c.column_name='user_id'
  where c.column_name is null or c.is_nullable <> 'NO'
),
user_indexed as (
  select distinct tbl.relname as table_name
  from pg_class tbl
  join pg_namespace ns on ns.oid=tbl.relnamespace and ns.nspname='public'
  join pg_index ix on ix.indrelid=tbl.oid
  join pg_attribute att
    on att.attrelid=tbl.oid
   and att.attnum=ix.indkey[0]
  where ix.indisvalid
    and ix.indisready
    and att.attname='user_id'
),
index_failures as (
  select o.table_name
  from owner_tables o
  left join user_indexed i on i.table_name=o.table_name
  where i.table_name is null
),
policy_role_failures as (
  select distinct p.tablename
  from pg_policies p
  join owner_tables o on o.table_name=p.tablename
  where p.schemaname='public'
    and (
      'anon'=any(p.roles)
      or 'public'=any(p.roles)
      or not ('authenticated'=any(p.roles))
    )
),
policy_scope_failures as (
  select o.table_name
  from owner_tables o
  where not exists (
    select 1
    from pg_policies p
    where p.schemaname='public'
      and p.tablename=o.table_name
      and 'authenticated'=any(p.roles)
      and (
        p.cmd='ALL'
        or (
          coalesce(p.qual,'') ilike '%auth.uid()%'
          and coalesce(p.qual,'') ilike '%user_id%'
        )
        or (
          coalesce(p.with_check,'') ilike '%auth.uid()%'
          and coalesce(p.with_check,'') ilike '%user_id%'
        )
      )
  )
),
null_owner_rows as (
  select 'accounts' table_name, count(*) n from public.accounts where user_id is null
  union all select 'activity_log', count(*) from public.activity_log where user_id is null
  union all select 'cash_ledger', count(*) from public.cash_ledger where user_id is null
  union all select 'expenses', count(*) from public.expenses where user_id is null
  union all select 'item_parts', count(*) from public.item_parts where user_id is null
  union all select 'item_returns', count(*) from public.item_returns where user_id is null
  union all select 'items', count(*) from public.items where user_id is null
  union all select 'job_lot_items', count(*) from public.job_lot_items where user_id is null
  union all select 'job_lots', count(*) from public.job_lots where user_id is null
  union all select 'retrade_sync_clock', count(*) from public.retrade_sync_clock where user_id is null
  union all select 'sale_reconciliations', count(*) from public.sale_reconciliations where user_id is null
  union all select 'sourcing_runs', count(*) from public.sourcing_runs where user_id is null
  union all select 'trips', count(*) from public.trips where user_id is null
  union all select 'user_settings', count(*) from public.user_settings where user_id is null
),
relationship_failures as (
  select 'expenses->sourcing_runs' relation_name, count(*) n
  from public.expenses e
  left join public.sourcing_runs r
    on r.id=e.sourcing_run_id and r.user_id=e.user_id
  where e.sourcing_run_id is not null and r.id is null

  union all
  select 'trips->sourcing_runs', count(*)
  from public.trips t
  left join public.sourcing_runs r
    on r.id=t.sourcing_run_id and r.user_id=t.user_id
  where t.sourcing_run_id is not null and r.id is null

  union all
  select 'item_parts->items', count(*)
  from public.item_parts p
  left join public.items i
    on i.id=p.item_id and i.user_id=p.user_id
  where p.item_id is not null and i.id is null

  union all
  select 'item_returns->items', count(*)
  from public.item_returns r
  left join public.items i
    on i.id=r.item_id and i.user_id=r.user_id
  where r.item_id is not null and i.id is null

  union all
  select 'job_lot_items->job_lots', count(*)
  from public.job_lot_items m
  left join public.job_lots l
    on l.id=m.job_lot_id and l.user_id=m.user_id
  where m.job_lot_id is not null and l.id is null

  union all
  select 'job_lot_items->items', count(*)
  from public.job_lot_items m
  left join public.items i
    on i.id=m.item_id and i.user_id=m.user_id
  where m.item_id is not null and i.id is null
),
full_return_duplicates as (
  select count(*) n
  from (
    select user_id,item_id,sale_no
    from public.item_returns
    where type in ('full_seller','full_ebay')
    group by user_id,item_id,sale_no
    having count(*) > 1
  ) d
),
required_fk(name) as (
  values
    ('expenses_sourcing_run_owner_fkey'),
    ('trips_sourcing_run_owner_fkey'),
    ('job_lot_items_job_lot_owner_fkey'),
    ('job_lot_items_item_owner_fkey')
),
missing_required_fk as (
  select r.name
  from required_fk r
  left join pg_constraint c
    on c.conname=r.name
   and c.connamespace='public'::regnamespace
   and c.contype='f'
  where c.oid is null
),
return_unique_guard as (
  select count(*) n
  from pg_class i
  join pg_namespace n on n.oid=i.relnamespace
  join pg_index ix on ix.indexrelid=i.oid
  where n.nspname='public'
    and i.relname='item_returns_one_full_return_per_sale_uidx'
    and ix.indisunique
    and ix.indisvalid
    and ix.indisready
),
rpc_state as (
  select
    p.oid,
    p.prosecdef,
    p.proconfig,
    has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
    has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_exec,
    has_function_privilege('service_role',p.oid,'EXECUTE') service_exec
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='retrade_delete_my_account_record'
    and pg_get_function_identity_arguments(p.oid)='text'
),
reconciliation_guard as (
  select count(*) n
  from pg_trigger t
  join pg_proc p on p.oid=t.tgfoid
  where t.tgrelid='public.sale_reconciliations'::regclass
    and not t.tgisinternal
    and t.tgname='retrade_reconciliation_owner_guard'
    and t.tgenabled <> 'D'
    and p.prosecdef
    and p.proconfig @> array['search_path=pg_catalog']
    and not has_function_privilege('anon',p.oid,'EXECUTE')
    and not has_function_privilege('authenticated',p.oid,'EXECUTE')
),
meta_state as (
  select
    c.relrowsecurity rls_enabled,
    count(p.*) filter (where p.cmd='SELECT' and 'authenticated'=any(p.roles)) select_policies,
    count(p.*) filter (where p.cmd<>'SELECT') write_policies,
    count(p.*) filter (where 'anon'=any(p.roles) or 'public'=any(p.roles)) broad_policies
  from pg_class c
  left join pg_policies p
    on p.schemaname='public' and p.tablename=c.relname
  where c.relnamespace='public'::regnamespace
    and c.relname='retrade_meta'
  group by c.relrowsecurity
),
checks as (
  select '01 RLS enabled on every user-owned table' check_name,
         (select count(*) from rls_failures)=0 ok,
         (select coalesce(string_agg(table_name,', '),'none') from rls_failures) detail

  union all
  select '02 user_id exists and is NOT NULL',
         (select count(*) from owner_column_failures)=0,
         (select coalesce(string_agg(table_name,', '),'none') from owner_column_failures)

  union all
  select '03 owner-scoped index starts with user_id',
         (select count(*) from index_failures)=0,
         (select coalesce(string_agg(table_name,', '),'none') from index_failures)

  union all
  select '04 no anon/PUBLIC RLS policies on user tables',
         (select count(*) from policy_role_failures)=0,
         (select coalesce(string_agg(tablename,', '),'none') from policy_role_failures)

  union all
  select '05 authenticated owner-scoped policy coverage exists',
         (select count(*) from policy_scope_failures)=0,
         (select coalesce(string_agg(table_name,', '),'none') from policy_scope_failures)

  union all
  select '06 no NULL owner rows remain',
         coalesce((select sum(n) from null_owner_rows),0)=0,
         coalesce((select string_agg(table_name||'='||n,', ') from null_owner_rows where n>0),'none')

  union all
  select '07 no orphan/cross-owner linked rows remain',
         coalesce((select sum(n) from relationship_failures),0)=0,
         coalesce((select string_agg(relation_name||'='||n,', ') from relationship_failures where n>0),'none')

  union all
  select '08 required ownership-aware foreign keys exist',
         (select count(*) from missing_required_fk)=0,
         (select coalesce(string_agg(name,', '),'none') from missing_required_fk)

  union all
  select '09 full-return duplicates are impossible/absent',
         (select n from full_return_duplicates)=0 and (select n from return_unique_guard)=1,
         'duplicate_cycles='||(select n from full_return_duplicates)||', unique_guard='||(select n from return_unique_guard)

  union all
  select '10 account-delete RPC is hardened',
         exists (
           select 1 from rpc_state
           where prosecdef
             and proconfig @> array['search_path=pg_catalog']
             and not anon_exec
             and authenticated_exec
             and service_exec
         ),
         coalesce((select 'rows='||count(*) from rpc_state),'rows=0')

  union all
  select '11 reconciliation ownership trigger is hardened',
         (select n from reconciliation_guard)=1,
         'matching_guard='||(select n from reconciliation_guard)

  union all
  select '12 retrade_meta is authenticated read-only through RLS',
         exists (
           select 1 from meta_state
           where rls_enabled
             and select_policies=1
             and write_policies=0
             and broad_policies=0
         ),
         coalesce((select 'select_policies='||select_policies||', write_policies='||write_policies||', broad_policies='||broad_policies from meta_state),'missing')
)
select
  check_name,
  case when ok then 'PASS' else 'FAIL' end as status,
  detail
from checks
order by check_name;

-- ---------------------------------------------------------------------------
-- 2) RLS inventory — human-readable confirmation after the scorecard
-- ---------------------------------------------------------------------------
select
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
    'sourcing_runs','trips','user_settings','retrade_meta'
  )
order by tablename,policyname;

-- ---------------------------------------------------------------------------
-- 3) Ownership-safe relationship definitions
-- ---------------------------------------------------------------------------
select
  conrelid::regclass as table_name,
  conname as constraint_name,
  pg_get_constraintdef(oid,true) as definition
from pg_constraint
where contype='f'
  and connamespace='public'::regnamespace
  and conrelid in (
    'public.expenses'::regclass,
    'public.trips'::regclass,
    'public.item_parts'::regclass,
    'public.item_returns'::regclass,
    'public.job_lot_items'::regclass
  )
order by conrelid::regclass::text,conname;

-- ---------------------------------------------------------------------------
-- 4) SECURITY DEFINER inventory — only expected hardened functions should show
-- ---------------------------------------------------------------------------
select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
  has_function_privilege('service_role',p.oid,'EXECUTE') as service_role_can_execute
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.prosecdef
order by p.proname,pg_get_function_identity_arguments(p.oid);

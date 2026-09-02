-- RETRADE Stage 2E RLS policy consolidation — 2026-09-02
-- Records the already-applied and verified production consolidation.
-- Idempotent: replace only the named legacy/canonical policies in one transaction.
-- Requires the existing Stage 2 schema; does not modify business data or grants.

begin;

-- accounts
drop policy if exists "Users manage own accounts" on public.accounts;
drop policy if exists "accounts_user_access" on public.accounts;
drop policy if exists "accounts_owner_all" on public.accounts;

create policy "accounts_owner_all"
on public.accounts
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- activity_log
drop policy if exists "retrade_own_activity_log" on public.activity_log;
drop policy if exists "activity_log_delete_own" on public.activity_log;
drop policy if exists "activity_log_insert_own" on public.activity_log;
drop policy if exists "activity_log_select_own" on public.activity_log;
drop policy if exists "activity_log_update_own" on public.activity_log;
drop policy if exists "activity_log_owner_all" on public.activity_log;

create policy "activity_log_owner_all"
on public.activity_log
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- cash_ledger
drop policy if exists "cash_ledger_owner_all" on public.cash_ledger;
drop policy if exists "retrade_own_cash_ledger" on public.cash_ledger;

create policy "cash_ledger_owner_all"
on public.cash_ledger
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- expenses
drop policy if exists "expenses_user_policy" on public.expenses;
drop policy if exists "user_expenses" on public.expenses;
drop policy if exists "expenses_owner_all" on public.expenses;

create policy "expenses_owner_all"
on public.expenses
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- item_parts
drop policy if exists "item_parts_user_policy" on public.item_parts;
drop policy if exists "user_item_parts" on public.item_parts;
drop policy if exists "item_parts_owner_all" on public.item_parts;

create policy "item_parts_owner_all"
on public.item_parts
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- item_returns
drop policy if exists "item_returns_user_policy" on public.item_returns;
drop policy if exists "user_item_returns" on public.item_returns;
drop policy if exists "item_returns_owner_all" on public.item_returns;

create policy "item_returns_owner_all"
on public.item_returns
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- items
drop policy if exists "items_user_policy" on public.items;
drop policy if exists "user_items" on public.items;
drop policy if exists "items_owner_all" on public.items;

create policy "items_owner_all"
on public.items
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- trips
drop policy if exists "trips_user_policy" on public.trips;
drop policy if exists "user_trips" on public.trips;
drop policy if exists "trips_owner_all" on public.trips;

create policy "trips_owner_all"
on public.trips
for all
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Global schema metadata: authenticated reads only; no client write policy.
drop policy if exists "retrade_authenticated_schema_read" on public.retrade_meta;
drop policy if exists "retrade_meta_read" on public.retrade_meta;

create policy "retrade_authenticated_schema_read"
on public.retrade_meta
for select
to authenticated
using (true);

commit;

-- Expected: exactly nine rows (eight owner ALL policies and one metadata SELECT).
select tablename, policyname, roles, cmd,
       qual as using_expression, with_check as with_check_expression
from pg_policies
where schemaname = 'public'
  and tablename in (
    'accounts', 'activity_log', 'cash_ledger', 'expenses', 'item_parts',
    'item_returns', 'items', 'trips', 'retrade_meta'
  )
order by tablename, policyname;

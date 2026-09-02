-- RETRADE Stage 2 integrity hardening — 2026-09-02
--
-- Preconditions were audited before this migration was authored:
--   * no NULL user_id rows in accounts / expenses / item_parts / item_returns / trips
--   * no cross-user or orphaned expenses/trips -> sourcing_runs links
--   * no cross-user or orphaned job_lot_items -> job_lots/items links
--
-- This migration is deliberately defensive: it re-checks those conditions and
-- aborts before changing anything if the live data no longer satisfies them.

begin;

-- ---------------------------------------------------------------------------
-- 1) Guardrails: refuse to harden over unexpected live data.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.accounts where user_id is null) then
    raise exception 'Stage2 hardening aborted: accounts contains NULL user_id';
  end if;
  if exists (select 1 from public.expenses where user_id is null) then
    raise exception 'Stage2 hardening aborted: expenses contains NULL user_id';
  end if;
  if exists (select 1 from public.item_parts where user_id is null) then
    raise exception 'Stage2 hardening aborted: item_parts contains NULL user_id';
  end if;
  if exists (select 1 from public.item_returns where user_id is null) then
    raise exception 'Stage2 hardening aborted: item_returns contains NULL user_id';
  end if;
  if exists (select 1 from public.trips where user_id is null) then
    raise exception 'Stage2 hardening aborted: trips contains NULL user_id';
  end if;

  if exists (
    select 1
    from public.expenses e
    left join public.sourcing_runs r on r.id=e.sourcing_run_id
    where e.sourcing_run_id is not null
      and (r.id is null or e.user_id is distinct from r.user_id)
  ) then
    raise exception 'Stage2 hardening aborted: invalid expenses -> sourcing_runs relationship';
  end if;

  if exists (
    select 1
    from public.trips t
    left join public.sourcing_runs r on r.id=t.sourcing_run_id
    where t.sourcing_run_id is not null
      and (r.id is null or t.user_id is distinct from r.user_id)
  ) then
    raise exception 'Stage2 hardening aborted: invalid trips -> sourcing_runs relationship';
  end if;

  if exists (
    select 1
    from public.job_lot_items m
    left join public.job_lots l on l.id=m.job_lot_id
    where m.job_lot_id is not null
      and (l.id is null or m.user_id is distinct from l.user_id)
  ) then
    raise exception 'Stage2 hardening aborted: invalid job_lot_items -> job_lots relationship';
  end if;

  if exists (
    select 1
    from public.job_lot_items m
    left join public.items i on i.id=m.item_id
    where m.item_id is not null
      and (i.id is null or m.user_id is distinct from i.user_id)
  ) then
    raise exception 'Stage2 hardening aborted: invalid job_lot_items -> items relationship';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2) Ownership must exist at schema level, not only through RLS.
-- ---------------------------------------------------------------------------
alter table public.accounts     alter column user_id set not null;
alter table public.expenses     alter column user_id set not null;
alter table public.item_parts   alter column user_id set not null;
alter table public.item_returns alter column user_id set not null;
alter table public.trips        alter column user_id set not null;

-- ---------------------------------------------------------------------------
-- 3) Parent composite keys used by ownership-safe foreign keys.
-- A UNIQUE index is sufficient as an FK target and is idempotent here.
-- ---------------------------------------------------------------------------
create unique index if not exists sourcing_runs_id_user_id_uidx
  on public.sourcing_runs(id,user_id);

create unique index if not exists job_lots_id_user_id_uidx
  on public.job_lots(id,user_id);

-- items already supports (id,user_id): item_parts/item_returns currently use it.

-- ---------------------------------------------------------------------------
-- 4) Replace ID-only sourcing-run relationships with ownership-aware links.
-- Keep the historical behaviour of ON DELETE SET NULL, but null only the
-- sourcing_run_id; user_id remains the durable owner of the child row.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select conname
    from pg_constraint
    where contype='f'
      and conrelid='public.expenses'::regclass
      and confrelid='public.sourcing_runs'::regclass
  loop
    execute format('alter table public.expenses drop constraint %I',r.conname);
  end loop;

  for r in
    select conname
    from pg_constraint
    where contype='f'
      and conrelid='public.trips'::regclass
      and confrelid='public.sourcing_runs'::regclass
  loop
    execute format('alter table public.trips drop constraint %I',r.conname);
  end loop;
end $$;

alter table public.expenses
  add constraint expenses_sourcing_run_owner_fkey
  foreign key (sourcing_run_id,user_id)
  references public.sourcing_runs(id,user_id)
  on delete set null (sourcing_run_id);

alter table public.trips
  add constraint trips_sourcing_run_owner_fkey
  foreign key (sourcing_run_id,user_id)
  references public.sourcing_runs(id,user_id)
  on delete set null (sourcing_run_id);

-- ---------------------------------------------------------------------------
-- 5) Job-lot membership is historical data: removing/breaking/selling a lot
-- marks removed_at rather than deleting the membership. Therefore parent
-- deletion must preserve the membership row and its cost basis/notes.
-- Only the deleted reference ID is nulled; user_id remains intact.
-- ---------------------------------------------------------------------------
alter table public.job_lot_items
  add constraint job_lot_items_job_lot_owner_fkey
  foreign key (job_lot_id,user_id)
  references public.job_lots(id,user_id)
  on delete set null (job_lot_id);

alter table public.job_lot_items
  add constraint job_lot_items_item_owner_fkey
  foreign key (item_id,user_id)
  references public.items(id,user_id)
  on delete set null (item_id);

-- ---------------------------------------------------------------------------
-- 6) Supporting indexes for RLS-scoped relationship lookups.
-- ---------------------------------------------------------------------------
create index if not exists expenses_user_sourcing_run_idx
  on public.expenses(user_id,sourcing_run_id);

create index if not exists trips_user_sourcing_run_idx
  on public.trips(user_id,sourcing_run_id);

create index if not exists job_lot_items_user_job_lot_idx
  on public.job_lot_items(user_id,job_lot_id);

create index if not exists job_lot_items_user_item_idx
  on public.job_lot_items(user_id,item_id);

commit;

-- ---------------------------------------------------------------------------
-- Verification: all rows should report true / expected definitions.
-- ---------------------------------------------------------------------------
select table_name,is_nullable
from information_schema.columns
where table_schema='public'
  and column_name='user_id'
  and table_name in ('accounts','expenses','item_parts','item_returns','trips')
order by table_name;

select
  conrelid::regclass as table_name,
  conname as constraint_name,
  pg_get_constraintdef(oid,true) as definition
from pg_constraint
where contype='f'
  and connamespace='public'::regnamespace
  and conname in (
    'expenses_sourcing_run_owner_fkey',
    'trips_sourcing_run_owner_fkey',
    'job_lot_items_job_lot_owner_fkey',
    'job_lot_items_item_owner_fkey'
  )
order by conname;

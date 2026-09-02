-- RETRADE Stage 2 reconciliation ownership guard — 2026-09-02
--
-- sale_reconciliations is durable audit/history. Its item identifiers must
-- survive if an item is later deleted, so ordinary foreign keys (CASCADE or
-- SET NULL) would damage the audit trail. Instead, validate ownership only
-- when a reconciliation row is inserted/updated.
--
-- Important: the trigger function is SECURITY DEFINER so it can see whether a
-- referenced item belongs to another user even though normal callers are
-- restricted by RLS. It uses a locked search_path and schema-qualified tables.

begin;

create or replace function public.retrade_validate_reconciliation_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if new.user_id is null then
    raise exception 'sale_reconciliations.user_id is required';
  end if;

  if new.attached_item_id is not null and exists (
    select 1
    from public.items i
    where i.id = new.attached_item_id
      and i.user_id is distinct from new.user_id
  ) then
    raise exception 'attached_item_id belongs to another user';
  end if;

  if new.target_sale_item_id is not null and exists (
    select 1
    from public.items i
    where i.id = new.target_sale_item_id
      and i.user_id is distinct from new.user_id
  ) then
    raise exception 'target_sale_item_id belongs to another user';
  end if;

  return new;
end;
$function$;

-- Trigger functions should not be directly callable by client roles.
revoke all on function public.retrade_validate_reconciliation_owner() from public;
revoke all on function public.retrade_validate_reconciliation_owner() from anon;
revoke all on function public.retrade_validate_reconciliation_owner() from authenticated;

-- Idempotent trigger replacement.
drop trigger if exists retrade_reconciliation_owner_guard
  on public.sale_reconciliations;

create trigger retrade_reconciliation_owner_guard
before insert or update of user_id, attached_item_id, target_sale_item_id
on public.sale_reconciliations
for each row
execute function public.retrade_validate_reconciliation_owner();

commit;

-- Verification: expected enabled='O', security_definer=true,
-- function_config={search_path=pg_catalog}.
select
  t.tgname as trigger_name,
  t.tgenabled as enabled,
  p.prosecdef as security_definer,
  p.proconfig as function_config,
  pg_get_triggerdef(t.oid,true) as trigger_definition
from pg_trigger t
join pg_proc p on p.oid=t.tgfoid
where t.tgrelid='public.sale_reconciliations'::regclass
  and not t.tgisinternal
  and t.tgname='retrade_reconciliation_owner_guard';

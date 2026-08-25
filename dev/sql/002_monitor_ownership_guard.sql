-- RETRADE Monitors v0.1 integrity follow-up
-- Run after 001_monitors.sql.

create or replace function public.retrade_validate_monitor_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.category_id is not null and not exists (
    select 1
    from public.monitor_categories c
    where c.id = new.category_id
      and c.user_id = new.user_id
  ) then
    raise exception 'monitor category must belong to the same user';
  end if;
  return new;
end;
$$;

drop trigger if exists monitors_validate_owner on public.monitors;
create trigger monitors_validate_owner
before insert or update on public.monitors
for each row execute function public.retrade_validate_monitor_owner();

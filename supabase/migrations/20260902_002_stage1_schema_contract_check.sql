-- RETRADE Stage 1 schema contract audit — 2026-09-02
-- Read-only verification helper. Returns any required columns that are missing
-- from the live schema. An empty result set means this checked contract exists.

with required(table_name,column_name) as (
  values
    ('item_parts','id'),
    ('item_parts','item_id'),
    ('item_parts','user_id'),
    ('item_parts','description'),
    ('item_parts','cost'),
    ('item_parts','date'),
    ('items','id'),
    ('items','user_id'),
    ('items','revision'),
    ('items','client_base_revision'),
    ('item_returns','id'),
    ('item_returns','item_id'),
    ('item_returns','user_id'),
    ('item_returns','sale_no'),
    ('item_returns','logged_at')
), actual as (
  select table_name,column_name
  from information_schema.columns
  where table_schema='public'
)
select r.table_name,r.column_name
from required r
left join actual a using(table_name,column_name)
where a.column_name is null
order by r.table_name,r.column_name;

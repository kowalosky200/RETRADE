-- RETRADE Stage 2 lifecycle return integrity — 2026-09-02
--
-- Repairs three audited historical lifecycle corruptions caused by pre-v1.4.15
-- return-row identity drift, then prevents more than one FULL return event for
-- the same user/item/sale cycle. Partial refund/adjustment rows remain unlimited.
--
-- IMPORTANT: close active RETRADE clients before applying this migration so a
-- stale in-memory lifecycle cannot race the direct database repair.

begin;

-- ---------------------------------------------------------------------------
-- Guard the exact audited production state. If any row has changed since the
-- audit, abort rather than applying a repair to data we have not re-verified.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from public.item_returns
    where id = 308
      and item_id = 'qa_1777308539853'
      and sale_no = 1
      and type = 'full_seller'
      and logged_at::date = date '2026-04-30'
      and date_sold_at_return = date '2026-07-22'
      and refund_amount = 23.00
  ) then
    raise exception 'Lifecycle repair guard failed for R-0085 return 308';
  end if;

  if not exists (
    select 1
    from public.item_returns
    where id = 309
      and item_id = 'qa_1777308539853'
      and sale_no = 1
      and type = 'full_seller'
      and logged_at::date = date '2026-05-03'
      and date_sold_at_return = date '2026-04-27'
      and refund_amount = 24.99
  ) then
    raise exception 'Lifecycle repair guard failed for R-0085 return 309';
  end if;

  if not exists (
    select 1
    from public.item_returns
    where id = 302
      and item_id = 'sqa_1782035193360'
      and sale_no = 1
      and type = 'full_seller'
      and logged_at::date = date '2026-07-24'
      and date_sold_at_return is null
      and refund_amount = 39.99
  ) then
    raise exception 'Lifecycle repair guard failed for R-0145 return 302';
  end if;

  if not exists (
    select 1
    from public.item_returns
    where id = 318
      and item_id = 'qa_3f78907d-21be-40ab-ab97-ce0664da3be1'
      and sale_no = 2
      and type = 'full_seller'
      and logged_at::date = date '2026-08-20'
      and date_sold_at_return = date '2026-09-11'
      and refund_amount = 56.99
  ) then
    raise exception 'Lifecycle repair guard failed for R-0254 stale return 318';
  end if;

  if not exists (
    select 1
    from public.item_returns
    where id = 320
      and item_id = 'qa_3f78907d-21be-40ab-ab97-ce0664da3be1'
      and sale_no = 2
      and type = 'full_seller'
      and logged_at::date = date '2026-08-20'
      and date_sold_at_return = date '2026-08-11'
      and relisted_at::date = date '2026-08-21'
      and refund_amount = 56.99
  ) then
    raise exception 'Lifecycle repair guard failed for R-0254 canonical return 320';
  end if;
end
$$;

-- R-0085 Lenovo
-- Sale 1: sold 2026-04-27 -> returned 2026-05-03 -> relisted 2026-05-23.
-- Sale 2: sold 2026-05-24 for £23 -> later returned 2026-07-22 for £23.
-- The corrupt row had the Sale-2 return date in date_sold_at_return and an old
-- date in logged_at; restore the coherent lifecycle and price snapshot.
update public.item_returns
set sale_no = 2,
    logged_at = date '2026-07-22',
    date_sold_at_return = date '2026-05-24',
    sale_price_at_return = 23.00
where id = 308
  and item_id = 'qa_1777308539853';

-- R-0145 Fitbit
-- Row 302 is the real second return: Sale 2 sold 2026-07-19 for £39.99 and
-- returned 2026-07-24. It was incorrectly persisted as another Sale 1 return.
update public.item_returns
set sale_no = 2,
    date_sold_at_return = date '2026-07-19'
where id = 302
  and item_id = 'sqa_1782035193360';

-- R-0254 Panasonic
-- Row 318 is the stale duplicate produced during historical reprocessing.
-- Row 320 is the coherent Sale-2 event and is retained unchanged.
delete from public.item_returns
where id = 318
  and item_id = 'qa_3f78907d-21be-40ab-ab97-ce0664da3be1';

-- Abort if any duplicate FULL return cycle still exists anywhere. This protects
-- the following unique index from silently encoding unresolved corruption.
do $$
begin
  if exists (
    select 1
    from public.item_returns
    where type in ('full_seller','full_ebay')
    group by user_id, item_id, sale_no
    having count(*) > 1
  ) then
    raise exception 'Duplicate full-return cycles remain; lifecycle repair aborted';
  end if;
end
$$;

-- One physical sale cycle can have at most one FULL return. Partial seller/eBay
-- adjustments are intentionally excluded and can occur multiple times.
create unique index if not exists item_returns_one_full_return_per_sale_uidx
  on public.item_returns(user_id, item_id, sale_no)
  where type in ('full_seller','full_ebay');

commit;

-- Verification: expected six rows total for these three items, with one full
-- return per sale_no and no sold-after-return sequences.
select
  i.gid,
  r.id as return_id,
  r.sale_no,
  r.type,
  r.date_sold_at_return as sold_date,
  r.logged_at::date as return_date,
  r.relisted_at::date as relist_date,
  r.refund_amount
from public.item_returns r
join public.items i
  on i.id = r.item_id
 and i.user_id = r.user_id
where i.gid in ('R-0085','R-0145','R-0254')
order by i.gid, r.sale_no, r.id;

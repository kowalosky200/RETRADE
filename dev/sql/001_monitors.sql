-- RETRADE Monitors v0.1
-- Apply in Supabase SQL Editor before enabling cloud persistence.
-- Safe to run once on the RETRADE project database.

create extension if not exists pgcrypto;

create or replace function public.retrade_set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.monitor_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  slug text not null,
  description text,
  product_type text,
  aliases jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitor_categories_user_slug_key unique (user_id, slug),
  constraint monitor_categories_name_not_blank check (length(trim(name)) > 0),
  constraint monitor_categories_slug_not_blank check (length(trim(slug)) > 0)
);

create table if not exists public.monitor_models (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.monitor_categories(id) on delete cascade,
  canonical_model text not null,
  aliases jsonb not null default '[]'::jsonb,
  expected_resale_low numeric(12,2),
  expected_resale_high numeric(12,2),
  strong_buy_price numeric(12,2),
  max_buy_price numeric(12,2),
  min_profit numeric(12,2) not null default 40,
  min_roi numeric(8,2) not null default 25,
  adjustments jsonb not null default '[]'::jsonb,
  reject_keywords jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitor_models_user_category_model_key unique (user_id, category_id, canonical_model),
  constraint monitor_models_model_not_blank check (length(trim(canonical_model)) > 0),
  constraint monitor_models_nonnegative_values check (
    (expected_resale_low is null or expected_resale_low >= 0) and
    (expected_resale_high is null or expected_resale_high >= 0) and
    (strong_buy_price is null or strong_buy_price >= 0) and
    (max_buy_price is null or max_buy_price >= 0) and
    min_profit >= 0 and min_roi >= 0
  ),
  constraint monitor_models_resale_range check (
    expected_resale_low is null or expected_resale_high is null or expected_resale_high >= expected_resale_low
  )
);

create table if not exists public.monitors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  platform text not null default 'vinted',
  category_id uuid references public.monitor_categories(id) on delete set null,
  category_key text,
  enabled boolean not null default true,
  search_terms jsonb not null default '[]'::jsonb,
  filters jsonb not null default '{}'::jsonb,
  price_min numeric(12,2) not null default 0,
  price_max numeric(12,2),
  min_profit numeric(12,2) not null default 40,
  min_roi numeric(8,2) not null default 25,
  discord_enabled boolean not null default true,
  retrade_alerts_enabled boolean not null default true,
  poll_interval_seconds integer not null default 60,
  last_run_at timestamptz,
  last_match_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint monitors_name_not_blank check (length(trim(name)) > 0),
  constraint monitors_platform_not_blank check (length(trim(platform)) > 0),
  constraint monitors_prices_valid check (price_min >= 0 and (price_max is null or price_max >= price_min)),
  constraint monitors_targets_nonnegative check (min_profit >= 0 and min_roi >= 0),
  constraint monitors_poll_interval_check check (poll_interval_seconds >= 30)
);

create table if not exists public.monitor_listings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null,
  platform_listing_id text not null,
  url text,
  title text not null,
  description text,
  item_price numeric(12,2),
  delivered_price numeric(12,2),
  currency text not null default 'GBP',
  image_urls jsonb not null default '[]'::jsonb,
  seller jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint monitor_listings_user_platform_listing_key unique (user_id, platform, platform_listing_id),
  constraint monitor_listings_platform_not_blank check (length(trim(platform)) > 0),
  constraint monitor_listings_platform_id_not_blank check (length(trim(platform_listing_id)) > 0),
  constraint monitor_listings_title_not_blank check (length(trim(title)) > 0),
  constraint monitor_listings_prices_nonnegative check (
    (item_price is null or item_price >= 0) and (delivered_price is null or delivered_price >= 0)
  )
);

create table if not exists public.monitor_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  monitor_id uuid not null references public.monitors(id) on delete cascade,
  listing_id uuid not null references public.monitor_listings(id) on delete cascade,
  matched_model_id uuid references public.monitor_models(id) on delete set null,
  score integer,
  decision text,
  landed_cost numeric(12,2),
  expected_resale_low numeric(12,2),
  expected_resale_high numeric(12,2),
  projected_profit_low numeric(12,2),
  projected_profit_high numeric(12,2),
  roi numeric(10,2),
  risk_level text,
  reasoning jsonb not null default '[]'::jsonb,
  status text not null default 'new',
  detected_at timestamptz not null default now(),
  notified_at timestamptz,
  constraint monitor_matches_user_monitor_listing_key unique (user_id, monitor_id, listing_id),
  constraint monitor_matches_score_check check (score is null or score between 0 and 100),
  constraint monitor_matches_decision_check check (decision is null or decision in ('CHECK', 'BUY', 'SNIPE', 'RISKY')),
  constraint monitor_matches_status_check check (status in ('new', 'viewed', 'dismissed', 'purchased')),
  constraint monitor_matches_money_nonnegative check (
    (landed_cost is null or landed_cost >= 0) and
    (expected_resale_low is null or expected_resale_low >= 0) and
    (expected_resale_high is null or expected_resale_high >= 0)
  )
);

create index if not exists monitor_categories_user_idx on public.monitor_categories(user_id);
create index if not exists monitor_models_category_idx on public.monitor_models(category_id) where active = true;
create index if not exists monitors_user_enabled_idx on public.monitors(user_id, enabled);
create index if not exists monitors_last_run_idx on public.monitors(last_run_at) where enabled = true;
create index if not exists monitor_listings_user_seen_idx on public.monitor_listings(user_id, first_seen_at desc);
create index if not exists monitor_matches_user_detected_idx on public.monitor_matches(user_id, detected_at desc);
create index if not exists monitor_matches_monitor_status_idx on public.monitor_matches(monitor_id, status, detected_at desc);

-- Keep the ownership column aligned with the owning monitor/category where possible.
create or replace function public.retrade_validate_monitor_model_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.monitor_categories c
    where c.id = new.category_id and c.user_id = new.user_id
  ) then
    raise exception 'monitor model category must belong to the same user';
  end if;
  return new;
end;
$$;

create or replace function public.retrade_validate_monitor_match_owner()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.monitors m
    where m.id = new.monitor_id and m.user_id = new.user_id
  ) then
    raise exception 'monitor match must belong to the same user as its monitor';
  end if;
  if not exists (
    select 1 from public.monitor_listings l
    where l.id = new.listing_id and l.user_id = new.user_id
  ) then
    raise exception 'monitor match must belong to the same user as its listing';
  end if;
  if new.matched_model_id is not null and not exists (
    select 1 from public.monitor_models mm
    where mm.id = new.matched_model_id and mm.user_id = new.user_id
  ) then
    raise exception 'matched model must belong to the same user';
  end if;
  return new;
end;
$$;

drop trigger if exists monitor_categories_set_updated_at on public.monitor_categories;
create trigger monitor_categories_set_updated_at before update on public.monitor_categories
for each row execute function public.retrade_set_updated_at();

drop trigger if exists monitor_models_set_updated_at on public.monitor_models;
create trigger monitor_models_set_updated_at before update on public.monitor_models
for each row execute function public.retrade_set_updated_at();

drop trigger if exists monitors_set_updated_at on public.monitors;
create trigger monitors_set_updated_at before update on public.monitors
for each row execute function public.retrade_set_updated_at();

drop trigger if exists monitor_models_validate_owner on public.monitor_models;
create trigger monitor_models_validate_owner before insert or update on public.monitor_models
for each row execute function public.retrade_validate_monitor_model_owner();

drop trigger if exists monitor_matches_validate_owner on public.monitor_matches;
create trigger monitor_matches_validate_owner before insert or update on public.monitor_matches
for each row execute function public.retrade_validate_monitor_match_owner();

alter table public.monitor_categories enable row level security;
alter table public.monitor_models enable row level security;
alter table public.monitors enable row level security;
alter table public.monitor_listings enable row level security;
alter table public.monitor_matches enable row level security;

-- Authenticated RETRADE users can only see and change their own monitor data.
drop policy if exists monitor_categories_owner_all on public.monitor_categories;
create policy monitor_categories_owner_all on public.monitor_categories
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists monitor_models_owner_all on public.monitor_models;
create policy monitor_models_owner_all on public.monitor_models
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists monitors_owner_all on public.monitors;
create policy monitors_owner_all on public.monitors
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists monitor_listings_owner_all on public.monitor_listings;
create policy monitor_listings_owner_all on public.monitor_listings
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists monitor_matches_owner_all on public.monitor_matches;
create policy monitor_matches_owner_all on public.monitor_matches
for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Deliberately no service-role key or private credentials belong in the browser or repository.
-- A future server-side worker may use the Supabase service role from environment variables.

-- =============================================================================
-- CUPAI — Offers & discounts (per product or store-wide), time bound.
--
-- scope 'product' → applies to ONE product (product_id required)
-- scope 'all'     → applies to EVERY product of the merchant
--
-- An offer is LIVE only while: is_active AND now() >= starts_at
-- AND (ends_at IS NULL OR now() < ends_at). Expiry is evaluated in real time
-- on every customer message — no cron, no cached state.
--
-- notify_enabled + notify_message drive the one-time broadcast message that is
-- sent to the merchant's customers. Disabling it stops every message while the
-- discount itself keeps working normally.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.offers (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  merchant_id     uuid,
  title           text not null,
  description     text,
  scope           text not null default 'product' check (scope in ('all', 'product')),
  product_id      uuid references public.products(id) on delete cascade,
  discount_type   text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount_value  numeric not null default 0,
  coupon_code     text,
  min_order_total numeric,
  starts_at       timestamptz not null default now(),
  ends_at         timestamptz,
  is_active       boolean not null default true,
  notify_enabled  boolean not null default false,
  notify_message  text,
  notified_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists offers_user_idx    on public.offers (user_id, is_active);
create index if not exists offers_product_idx on public.offers (product_id);
create index if not exists offers_window_idx  on public.offers (starts_at, ends_at);

grant select, insert, update, delete on public.offers to authenticated;
grant all on public.offers to service_role;

alter table public.offers enable row level security;

drop policy if exists own_offers on public.offers;
create policy own_offers on public.offers for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

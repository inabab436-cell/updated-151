-- =============================================================================
-- CUPAI — Offer redemptions (beneficiaries).
--
-- A redemption is recorded ONLY when the merchant confirms the payment of the
-- order. Nothing is counted before that moment, because the discount is tied
-- to a real, paid order value.
--
-- unique(offer_id, order_id) makes the recording idempotent: confirming the
-- same order twice can never inflate the counter.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.offer_redemptions (
  id              uuid primary key default gen_random_uuid(),
  offer_id        uuid not null references public.offers(id) on delete cascade,
  order_id        uuid not null,
  conversation_id uuid,
  customer_name   text,
  order_total     numeric,
  currency        text,
  created_at      timestamptz not null default now(),
  unique (offer_id, order_id)
);

create index if not exists offer_redemptions_offer_idx
  on public.offer_redemptions (offer_id, created_at desc);

grant select on public.offer_redemptions to authenticated;
grant all on public.offer_redemptions to service_role;

alter table public.offer_redemptions enable row level security;

drop policy if exists own_offer_redemptions on public.offer_redemptions;
create policy own_offer_redemptions on public.offer_redemptions for select
  to authenticated
  using (
    exists (
      select 1 from public.offers o
      where o.id = offer_redemptions.offer_id
        and o.user_id = auth.uid()
    )
  );

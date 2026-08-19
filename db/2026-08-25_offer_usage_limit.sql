-- =============================================================================
-- CUPAI — How many times a customer may benefit from an offer.
--
-- usage_limit_type:
--   'once_per_customer' → each customer benefits ONE time only.
--   'per_order'         → the offer applies to every order of the customer.
--
-- Statistics are split:
--   beneficiary_count → unique customers who benefited (drives max_redemptions)
--   redemption_count  → total number of times the offer was used
--
-- offer_redemptions.customer_key identifies the customer
-- (customer_id, else phone, else conversation_id) so "once per customer" is
-- enforced on real identity, not on the order row.
-- Safe to re-run.
-- =============================================================================

alter table public.offers
  add column if not exists usage_limit_type text not null default 'per_order';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'offers_usage_limit_type_check'
  ) then
    alter table public.offers
      add constraint offers_usage_limit_type_check
      check (usage_limit_type in ('once_per_customer', 'per_order'));
  end if;
end $$;

alter table public.offers
  add column if not exists beneficiary_count integer not null default 0;

alter table public.offer_redemptions
  add column if not exists customer_key text;

create index if not exists offer_redemptions_customer_idx
  on public.offer_redemptions (offer_id, customer_key);

-- Backfill: before this change every redemption was one order = one customer.
update public.offers o
set beneficiary_count = coalesce((
  select count(distinct coalesce(r.customer_key, r.order_id::text))
  from public.offer_redemptions r where r.offer_id = o.id
), 0)
where o.beneficiary_count = 0;

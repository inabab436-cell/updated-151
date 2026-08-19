-- =============================================================================
-- CUPAI — Limit an offer by NUMBER OF CUSTOMERS, not only by time.
--
-- max_redemptions  -> how many customers may use the offer. null = unlimited.
-- redemption_count -> how many already used it.
--
-- The offer stops the moment redemption_count >= max_redemptions, even if the
-- time window is still open. This is evaluated in real time (isLive()).
--
-- Safe to re-run.
-- =============================================================================

alter table public.offers
  add column if not exists max_redemptions integer;

alter table public.offers
  add column if not exists redemption_count integer not null default 0;

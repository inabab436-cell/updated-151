-- =============================================================================
-- CUPAI — Product material (الخامة) in the basic product settings.
-- Safe to re-run.
-- =============================================================================
BEGIN;

alter table public.products        add column if not exists material text;
alter table public.staging_products add column if not exists material text;

comment on column public.products.material is
  'Merchant-facing material / fabric of the product (الخامة). Suggested by AI image analysis, always editable by the merchant.';

COMMIT;

NOTIFY pgrst, 'reload schema';

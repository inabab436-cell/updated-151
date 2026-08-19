-- =============================================================================
-- CUPAI — Allow NULL in staging_products.action
--
-- Rows staged with status 'awaiting_images' (a product uploaded without any
-- image) have NOT been analyzed by the AI yet, so they legitimately have no
-- decision/action. The same is true for quarantined rows ('needs_ai_review').
-- The application never invents a fallback action, so it writes NULL.
--
-- The column was created in db/2026-07-17_product_merge_flow.sql as
--   action text not null default 'new'
-- which made those inserts fail with:
--   null value in column "action" of relation "staging_products"
--   violates not-null constraint
--
-- Fix: drop the NOT NULL constraint (default stays, existing data untouched).
-- Safe to re-run.
-- =============================================================================
BEGIN;

ALTER TABLE public.staging_products ALTER COLUMN action DROP NOT NULL;

COMMENT ON COLUMN public.staging_products.action IS
  'AI-decided staging action (new | merge | update | skip). NULL means the row has not been decided yet (e.g. status = ''awaiting_images'' or ''needs_ai_review'').';

COMMIT;

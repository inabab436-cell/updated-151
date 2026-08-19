-- =============================================================================
-- CUPAI — Product update/merge flow.
--
-- Enables the batch-review UI to MERGE re-uploaded products into the existing
-- product record instead of creating a duplicate.
--
-- Adds to staging_products:
--   duplicate_of   uuid   -> the matching final products.id, if any.
--   action         text   -> 'merge' (default when duplicate_of set),
--                            'new'   (default when no match),
--                            'skip'  (ignore on approve).
--   resolved_price numeric -> user's chosen value when incoming price differs
--                             from the existing product's price. When null and
--                             a real conflict exists, approveBatch refuses.
--
-- Safe to re-run.
-- =============================================================================

alter table public.staging_products
  add column if not exists duplicate_of  uuid references public.products(id) on delete set null;

alter table public.staging_products
  add column if not exists action        text not null default 'new';

alter table public.staging_products
  add column if not exists resolved_price numeric;

create index if not exists staging_products_duplicate_of_idx
  on public.staging_products (duplicate_of);

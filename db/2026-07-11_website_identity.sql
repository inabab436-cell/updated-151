-- =============================================================================
-- CUPAI — Website Identity: description, logo, and per-merchant theme key.
-- Run in the Supabase SQL editor. Safe to re-run.
-- =============================================================================

alter table public.merchants
  add column if not exists description text,
  add column if not exists logo_url text,
  add column if not exists theme_key text;

-- Optional: variant image URLs on staging + live tables.
alter table public.staging_product_colors
  add column if not exists image_url text;
alter table public.staging_product_sizes
  add column if not exists image_url text;
alter table public.product_colors
  add column if not exists image_url text;
alter table public.product_sizes
  add column if not exists image_url text;

-- NOTE: Also create a PUBLIC storage bucket named `site-logo` from the
-- Supabase Storage UI (Public = true). The app will upload logos there.

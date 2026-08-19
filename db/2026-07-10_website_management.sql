-- =============================================================================
-- CUPAI — Website Management: explicit site_created flag + structured product
-- images (1:N), sizes (1:N), colors (1:N), and per-variant image linkage.
-- Run this ONCE in your Supabase SQL editor. Safe to re-run (IF NOT EXISTS).
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) merchants: explicit site status (do NOT infer from other rows)
-- ----------------------------------------------------------------------------
-- If the `merchants` table does not exist yet, create it.
create table if not exists public.merchants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  brand_name text,
  brand_slug text unique,
  site_created boolean not null default false,
  site_status text not null default 'draft'
    check (site_status in ('draft','published','unpublished')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add missing columns if the table already existed.
alter table public.merchants add column if not exists site_created boolean not null default false;
alter table public.merchants add column if not exists site_status  text    not null default 'draft';
alter table public.merchants add column if not exists brand_name   text;
alter table public.merchants add column if not exists brand_slug   text;

-- Case-insensitive unique slug.
create unique index if not exists merchants_brand_slug_lower_idx
  on public.merchants (lower(brand_slug));

grant select, insert, update, delete on public.merchants to authenticated;
grant all on public.merchants to service_role;
alter table public.merchants enable row level security;
drop policy if exists merchants_owner on public.merchants;
create policy merchants_owner on public.merchants for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- The public storefront reads merchants by slug via the service role, so no
-- anon SELECT policy is required.

-- ----------------------------------------------------------------------------
-- 2) product_sizes (1:N, structured — not JSON, not free text)
-- ----------------------------------------------------------------------------
create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_sizes_product_idx on public.product_sizes(product_id, position);
create index if not exists product_sizes_user_idx    on public.product_sizes(user_id);

grant select, insert, update, delete on public.product_sizes to authenticated;
grant all on public.product_sizes to service_role;
alter table public.product_sizes enable row level security;
drop policy if exists product_sizes_owner on public.product_sizes;
create policy product_sizes_owner on public.product_sizes for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3) product_colors (1:N, structured)
-- ----------------------------------------------------------------------------
create table if not exists public.product_colors (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null,
  hex text,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists product_colors_product_idx on public.product_colors(product_id, position);
create index if not exists product_colors_user_idx    on public.product_colors(user_id);

grant select, insert, update, delete on public.product_colors to authenticated;
grant all on public.product_colors to service_role;
alter table public.product_colors enable row level security;
drop policy if exists product_colors_owner on public.product_colors;
create policy product_colors_owner on public.product_colors for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 4) product_images (1:N — images are rows, NOT a JSON array)
--    Optional color_id / size_id lets the merchant attach an image to a
--    specific colour or size variant.
-- ----------------------------------------------------------------------------
create table if not exists public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  url text not null,               -- storage path in cupai-uploads, or an https URL
  position int not null default 0,
  color_id uuid references public.product_colors(id) on delete set null,
  size_id  uuid references public.product_sizes(id)  on delete set null,
  created_at timestamptz not null default now()
);
-- If the table already existed without color_id/size_id/user_id, add them:
alter table public.product_images add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.product_images add column if not exists color_id uuid references public.product_colors(id) on delete set null;
alter table public.product_images add column if not exists size_id  uuid references public.product_sizes(id)  on delete set null;
alter table public.product_images add column if not exists position int not null default 0;

create index if not exists product_images_product_idx on public.product_images(product_id, position);
create index if not exists product_images_user_idx    on public.product_images(user_id);
create index if not exists product_images_color_idx   on public.product_images(color_id);
create index if not exists product_images_size_idx    on public.product_images(size_id);

grant select, insert, update, delete on public.product_images to authenticated;
grant all on public.product_images to service_role;
alter table public.product_images enable row level security;
drop policy if exists product_images_owner on public.product_images;
create policy product_images_owner on public.product_images for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 5) Public storefront storage: ensure the cupai-uploads bucket is reachable
--    for signed URLs used by /c/$slug. (No changes here — server signs URLs.)
-- ----------------------------------------------------------------------------
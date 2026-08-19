-- =============================================================================
-- CUPAI — Content classification migration.
-- Apply this ONCE in your Supabase project's SQL Editor.
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- =============================================================================

-- ---------- FINAL tables (merchant-facing, editable any time) ---------------

create table if not exists public.policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('shipping','return','terms','privacy','refund','warranty','other')),
  title text not null,
  content text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists policies_user_kind_idx on public.policies(user_id, kind);
grant select, insert, update, delete on public.policies to authenticated;
grant all on public.policies to service_role;
alter table public.policies enable row level security;
drop policy if exists policies_owner on public.policies;
create policy policies_owner on public.policies for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.shipping_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  country text, region text,
  price numeric, currency text,
  eta text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shipping_rates_user_idx on public.shipping_rates(user_id);
grant select, insert, update, delete on public.shipping_rates to authenticated;
grant all on public.shipping_rates to service_role;
alter table public.shipping_rates enable row level security;
drop policy if exists shipping_rates_owner on public.shipping_rates;
create policy shipping_rates_owner on public.shipping_rates for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.contact_info (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('phone','email','address','whatsapp','instagram','facebook','tiktok','twitter','snapchat','telegram','website','other')),
  label text, value text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists contact_info_user_idx on public.contact_info(user_id);
grant select, insert, update, delete on public.contact_info to authenticated;
grant all on public.contact_info to service_role;
alter table public.contact_info enable row level security;
drop policy if exists contact_info_owner on public.contact_info;
create policy contact_info_owner on public.contact_info for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.unclassified_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid, file_id uuid, file_name text,
  reason text, excerpt text,
  status text not null default 'pending' check (status in ('pending','reviewed','reclassified','deleted')),
  created_at timestamptz not null default now()
);
create index if not exists unclassified_user_idx on public.unclassified_items(user_id, status);
grant select, insert, update, delete on public.unclassified_items to authenticated;
grant all on public.unclassified_items to service_role;
alter table public.unclassified_items enable row level security;
drop policy if exists unclassified_owner on public.unclassified_items;
create policy unclassified_owner on public.unclassified_items for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- STAGING tables (review before approve) -------------------------

create table if not exists public.staging_policies (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  kind text not null, title text not null, content text not null default '',
  duplicate_of uuid references public.policies(id) on delete set null,
  action text not null default 'new' check (action in ('new','replace','merge','skip')),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists staging_policies_batch_idx on public.staging_policies(batch_id);
grant select, insert, update, delete on public.staging_policies to authenticated;
grant all on public.staging_policies to service_role;
alter table public.staging_policies enable row level security;
drop policy if exists staging_policies_owner on public.staging_policies;
create policy staging_policies_owner on public.staging_policies for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.staging_shipping (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  country text, region text, price numeric, currency text, eta text, notes text,
  duplicate_of uuid references public.shipping_rates(id) on delete set null,
  action text not null default 'new' check (action in ('new','replace','merge','skip')),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists staging_shipping_batch_idx on public.staging_shipping(batch_id);
grant select, insert, update, delete on public.staging_shipping to authenticated;
grant all on public.staging_shipping to service_role;
alter table public.staging_shipping enable row level security;
drop policy if exists staging_shipping_owner on public.staging_shipping;
create policy staging_shipping_owner on public.staging_shipping for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.staging_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  batch_id uuid not null,
  kind text not null, label text, value text not null,
  duplicate_of uuid references public.contact_info(id) on delete set null,
  action text not null default 'new' check (action in ('new','replace','merge','skip')),
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists staging_contacts_batch_idx on public.staging_contacts(batch_id);
grant select, insert, update, delete on public.staging_contacts to authenticated;
grant all on public.staging_contacts to service_role;
alter table public.staging_contacts enable row level security;
drop policy if exists staging_contacts_owner on public.staging_contacts;
create policy staging_contacts_owner on public.staging_contacts for all
  to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

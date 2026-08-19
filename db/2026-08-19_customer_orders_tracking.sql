-- =============================================================================
-- CUPAI — Customer order area: incomplete (draft) orders + order tracking.
--
--   1) public.order_drafts   : one in-progress cart per (merchant, customer).
--                              Used for the "الأوردرات غير المكتملة" section
--                              and the "استكمال الطلب" button.
--   2) orders.prepared_at    : timestamp for the new "تم تجهيز الأوردر" status.
--   3) order_status_messages : prepared_message / prepared_enabled template,
--                              same mechanism as shipped / delivered.
--
-- No existing behaviour is changed. Safe to re-run.
-- =============================================================================

-- --- 1) In-progress (incomplete) orders -------------------------------------
create table if not exists public.order_drafts (
  id                uuid primary key default gen_random_uuid(),
  merchant_id       uuid not null references public.merchants(id) on delete cascade,
  customer_id       uuid not null,
  items             jsonb not null default '[]'::jsonb,
  shipping_rate_id  uuid,
  payment_method    text,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (merchant_id, customer_id)
);

create index if not exists order_drafts_customer_idx
  on public.order_drafts (customer_id, updated_at desc);

-- Only the server (service role) touches drafts; every read is scoped to the
-- signed-in customer session, so no Data API access is granted to anon/auth.
grant all on public.order_drafts to service_role;

alter table public.order_drafts enable row level security;

drop policy if exists "service role manages order drafts" on public.order_drafts;
create policy "service role manages order drafts"
  on public.order_drafts
  for all
  to service_role
  using (true)
  with check (true);

-- --- 2) New "prepared" order status ----------------------------------------
alter table public.orders
  add column if not exists prepared_at timestamptz;

-- --- 3) Prepared message template ------------------------------------------
alter table public.order_status_messages
  add column if not exists prepared_message text,
  add column if not exists prepared_enabled boolean not null default true;

-- =============================================================================
-- CUPAI — Inventory + Notifications tables.
-- Run in the Supabase SQL editor. Safe to re-run.
--
-- Scope: creates two NEW tables only. Does NOT touch existing tables
-- (merchants, chat_conversations, chat_messages, chat_orders).
--
-- RLS mirrors the existing merchant-owner pattern: a merchant can only see
-- and modify rows tied to their own merchants.id row (merchants.user_id =
-- auth.uid()). Anonymous visitors get no access. Server code that must read
-- across merchants (AI worker, storefront) uses the service role, which
-- bypasses RLS.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1) inventory — per-merchant stock rows (product + color + size + qty/price)
-- ----------------------------------------------------------------------------
create table if not exists public.inventory (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.merchants(id) on delete cascade,
  product_name  text not null,
  color         text,
  size          text,
  quantity      integer not null default 0,
  price         numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists inventory_merchant_id_idx
  on public.inventory (merchant_id);
create index if not exists inventory_merchant_product_idx
  on public.inventory (merchant_id, product_name);

grant select, insert, update, delete on public.inventory to authenticated;
grant all on public.inventory to service_role;

alter table public.inventory enable row level security;

-- Owner-only access: the row's merchant must belong to the current user.
drop policy if exists inventory_owner on public.inventory;
create policy inventory_owner on public.inventory for all
  to authenticated
  using (
    exists (
      select 1 from public.merchants m
      where m.id = inventory.merchant_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.merchants m
      where m.id = inventory.merchant_id
        and m.user_id = auth.uid()
    )
  );

-- No anon policy: visitors cannot read stock directly. The public storefront
-- reads inventory through the service role, same as merchants/products.

-- ----------------------------------------------------------------------------
-- 2) notifications — per-conversation events surfaced to the merchant
--    (ai_error / new_order / human_needed)
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'notification_type') then
    create type public.notification_type as enum ('ai_error', 'new_order', 'human_needed');
  end if;
end$$;

create table if not exists public.notifications (
  id              uuid primary key default gen_random_uuid(),
  type            public.notification_type not null,
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  message         text,
  is_read         boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists notifications_conversation_id_idx
  on public.notifications (conversation_id);
create index if not exists notifications_unread_idx
  on public.notifications (conversation_id) where is_read = false;

grant select, insert, update, delete on public.notifications to authenticated;
grant all on public.notifications to service_role;

alter table public.notifications enable row level security;

-- Owner-only access: derive ownership by joining conversation → merchant.
-- A merchant can only see/modify notifications tied to a conversation whose
-- merchant_id points at one of their merchants rows. Visitors (anon) have no
-- access. The AI worker writes via the service role.
drop policy if exists notifications_owner on public.notifications;
create policy notifications_owner on public.notifications for all
  to authenticated
  using (
    exists (
      select 1
      from public.chat_conversations c
      join public.merchants m on m.id = c.merchant_id
      where c.id = notifications.conversation_id
        and m.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.chat_conversations c
      join public.merchants m on m.id = c.merchant_id
      where c.id = notifications.conversation_id
        and m.user_id = auth.uid()
    )
  );
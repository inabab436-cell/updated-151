-- =============================================================================
-- CUPAI — Per-merchant payment methods (enabled + agent behavior).
-- behavior: 'auto'   → the agent keeps the conversation going normally
--           'manual' → the agent stops after the order and waits for the team
-- Safe to re-run.
-- =============================================================================

create table if not exists public.payment_methods (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  enabled    boolean not null default true,
  behavior   text not null default 'auto' check (behavior in ('auto', 'manual')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists payment_methods_user_idx
  on public.payment_methods (user_id, sort_order);

grant select, insert, update, delete on public.payment_methods to authenticated;
grant all on public.payment_methods to service_role;

alter table public.payment_methods enable row level security;

drop policy if exists own_payment_methods on public.payment_methods;
create policy own_payment_methods on public.payment_methods for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- =============================================================================
-- CUPAI — Customer passwordless auth (Email OTP + server sessions).
--
-- This is a COMPLETELY SEPARATE system from the merchant OTP tables
-- (`email_otp_codes`, `email_otp_blocks`). It only touches the storefront
-- customer identity and never shares tables, rows or logic with merchant
-- authentication.
--
-- Safe to re-run.
-- =============================================================================

-- --- 1) OTP codes issued to a customer email, scoped to a merchant. --------
create table if not exists public.customer_otp_codes (
  id           uuid primary key default gen_random_uuid(),
  merchant_id  uuid not null references public.merchants(id) on delete cascade,
  email        text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,      -- 30 minutes after created_at
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  created_at   timestamptz not null default now()
);
create index if not exists customer_otp_codes_lookup_idx
  on public.customer_otp_codes (merchant_id, email, created_at desc);
create index if not exists customer_otp_codes_active_idx
  on public.customer_otp_codes (merchant_id, email)
  where consumed_at is null;

-- --- 2) Active blocks (too many sends / too many wrong attempts). ---------
create table if not exists public.customer_otp_blocks (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.merchants(id) on delete cascade,
  email         text not null,
  reason        text not null,             -- 'too_many_attempts' | 'too_many_sends'
  blocked_until timestamptz not null,
  created_at    timestamptz not null default now()
);
create index if not exists customer_otp_blocks_active_idx
  on public.customer_otp_blocks (merchant_id, email, blocked_until desc);

-- --- 3) Server-managed customer sessions. ---------------------------------
-- The raw session token is stored ONLY in the httpOnly cookie. The DB keeps
-- a SHA-256 hash so a leaked DB does not leak sessions. Cleaning old rows
-- and revoking sessions is done server-side; the cookie alone is never
-- trusted.
create table if not exists public.customer_sessions (
  id            uuid primary key default gen_random_uuid(),
  merchant_id   uuid not null references public.merchants(id) on delete cascade,
  customer_id   uuid not null references public.customers(id)  on delete cascade,
  token_hash    text not null unique,
  status        text not null default 'active',       -- 'active' | 'revoked'
  expires_at    timestamptz not null,                 -- 30 days
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  revoked_at    timestamptz,
  user_agent    text,
  ip            text
);
create index if not exists customer_sessions_customer_idx
  on public.customer_sessions (customer_id, status, expires_at desc);
create index if not exists customer_sessions_merchant_idx
  on public.customer_sessions (merchant_id, status);

-- --- 4) Enforce one canonical customer row per (merchant, verified email). -
-- Only applies to rows that actually have an email; anonymous / visitor-only
-- rows remain untouched.
create unique index if not exists customers_merchant_email_lower_uniq
  on public.customers (merchant_id, lower(email))
  where email is not null;

-- --- 5) Lock down the new tables. -----------------------------------------
-- All access goes through the service-role admin client from server functions.
-- No anon / authenticated grants: nothing in the browser ever reads these
-- tables directly.
alter table public.customer_otp_codes  enable row level security;
alter table public.customer_otp_blocks enable row level security;
alter table public.customer_sessions   enable row level security;

grant all on public.customer_otp_codes  to service_role;
grant all on public.customer_otp_blocks to service_role;
grant all on public.customer_sessions   to service_role;

-- --- 6) Cleanup helper for expired OTPs / sessions. -----------------------
create or replace function public.cleanup_customer_auth()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.customer_otp_codes
    where expires_at < now() - interval '1 day';
  delete from public.customer_otp_blocks
    where blocked_until < now() - interval '1 day';
  update public.customer_sessions
     set status = 'revoked', revoked_at = now()
   where status = 'active' and expires_at < now();
$$;
revoke all on function public.cleanup_customer_auth() from public, anon, authenticated;
grant  execute on function public.cleanup_customer_auth() to service_role;
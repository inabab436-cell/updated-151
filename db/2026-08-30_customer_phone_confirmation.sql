-- Phone confirmation state for customers.
--
-- A number that the customer actually stands behind (they sent it in full, or
-- completed it across consecutive messages, and the agent read it back) is
-- recorded as CONFIRMED. Once confirmed, later runs never re-derive it from
-- chat text and never ask for it again.
--
-- Additive and idempotent: databases that never applied it keep working, the
-- application code degrades gracefully when the columns are absent.

alter table public.customers
  add column if not exists phone_confirmed boolean not null default false;

alter table public.customers
  add column if not exists phone_confirmed_at timestamptz;

comment on column public.customers.phone_confirmed is
  'True when the customer confirmed this exact mobile number. Confirmed numbers are never re-asked and are not silently replaced.';
comment on column public.customers.phone_confirmed_at is
  'When the phone number was confirmed.';

-- =============================================================================
-- CUPAI — Per-merchant email notification preferences.
-- Safe to re-run.
-- =============================================================================

create table if not exists public.email_notification_settings (
  user_id             uuid primary key references auth.users(id) on delete cascade,
  new_order           boolean not null default true,
  missing_information boolean not null default true,
  updated_at          timestamptz not null default now()
);

grant select, insert, update, delete on public.email_notification_settings to authenticated;
grant all on public.email_notification_settings to service_role;

alter table public.email_notification_settings enable row level security;

drop policy if exists own_email_settings on public.email_notification_settings;
create policy own_email_settings on public.email_notification_settings for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

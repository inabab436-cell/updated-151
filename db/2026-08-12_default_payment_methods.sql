-- =============================================================================
-- CUPAI — Default payment methods for every new user + order payment method.
-- Safe to re-run.
-- =============================================================================

-- 1) Orders keep the payment method the customer picked.
alter table public.orders
  add column if not exists payment_method text;

-- 2) Seed function: the four default methods for a merchant user.
create or replace function public.seed_default_payment_methods(_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.payment_methods
    (user_id, name, enabled, behavior, detail_type, detail_value, instructions, sort_order)
  select _user_id, v.name, true, v.behavior, v.detail_type, '', '', v.sort_order
  from (values
    ('الدفع عند الاستلام', 'auto',   'none',  0),
    ('فودافون كاش',        'manual', 'phone', 1),
    ('اتصالات كاش',        'manual', 'phone', 2),
    ('إنستا باي',          'manual', 'text',  3)
  ) as v(name, behavior, detail_type, sort_order)
  where not exists (
    select 1 from public.payment_methods pm where pm.user_id = _user_id
  );
$$;

-- 3) Trigger: run it automatically when a new account is created.
create or replace function public.handle_new_user_payment_methods()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.seed_default_payment_methods(new.id);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_payment_methods on auth.users;
create trigger on_auth_user_created_payment_methods
  after insert on auth.users
  for each row execute function public.handle_new_user_payment_methods();

-- 4) Backfill: existing accounts with no payment methods yet.
do $$
declare u record;
begin
  for u in select id from auth.users loop
    perform public.seed_default_payment_methods(u.id);
  end loop;
end $$;

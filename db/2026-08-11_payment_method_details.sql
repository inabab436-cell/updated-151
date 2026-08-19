-- =============================================================================
-- CUPAI — Payment methods: detail type/value + agent instructions.
-- detail_type: 'none' | 'phone' | 'url' | 'text'
-- detail_value: the actual payment detail the agent sends to the customer
-- instructions: free-form guidance the agent must follow for this method
-- Safe to re-run.
-- =============================================================================

alter table public.payment_methods
  add column if not exists detail_type text not null default 'none',
  add column if not exists detail_value text not null default '',
  add column if not exists instructions text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_methods_detail_type_check'
  ) then
    alter table public.payment_methods
      add constraint payment_methods_detail_type_check
      check (detail_type in ('none', 'phone', 'url', 'text'));
  end if;
end $$;

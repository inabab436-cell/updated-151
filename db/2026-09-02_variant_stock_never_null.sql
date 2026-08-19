-- Every product variant has an explicit quantity. This closes every write
-- path, including legacy approval RPCs and direct administrative writes.
-- Existing nulls become 0 (explicitly out of stock), then a trigger normalizes
-- future null writes before the NOT NULL constraint is checked.

begin;

update public.product_variants
set stock = 0
where stock is null;

create or replace function public.cupai_variant_stock_default()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.stock := greatest(coalesce(new.stock, 0), 0);
  return new;
end;
$$;

drop trigger if exists cupai_variant_stock_default on public.product_variants;
create trigger cupai_variant_stock_default
before insert or update of stock on public.product_variants
for each row execute function public.cupai_variant_stock_default();

alter table public.product_variants
  alter column stock set default 0,
  alter column stock set not null;

commit;
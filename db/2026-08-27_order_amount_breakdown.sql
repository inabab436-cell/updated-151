-- Order amount breakdown
-- ======================
-- The order total shown to the merchant is products − discount + shipping.
-- These columns store the parts so the orders page can display the value and
-- the discount line without recomputing anything.

alter table public.orders
  add column if not exists subtotal_price numeric,
  add column if not exists discount_amount numeric,
  add column if not exists shipping_cost numeric;

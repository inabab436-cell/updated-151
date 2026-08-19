-- =============================================================================
-- CUPAI — Atomic order creation with stock deduction + cancel/restock.
--
-- Goals:
--   * Creating an order and deducting the stock happen in ONE transaction.
--   * Concurrent orders for the same product/color/size can never oversell:
--     every matching product_variants row is locked with FOR UPDATE, so each
--     request reads the *latest committed* stock at execution time.
--   * If ANY item in the order is short, nothing is inserted and nothing is
--     deducted; the caller gets back the exact shortage details.
--   * Cancelling an order returns exactly what was deducted (idempotent).
--
-- Nothing else in the schema is touched.
-- Safe to re-run.
-- =============================================================================

-- Remember exactly what was deducted per order so a cancel restores exactly it.
alter table public.orders
  add column if not exists stock_deducted jsonb;

-- ---------------------------------------------------------------------------
-- create_order_with_stock
--   p_items: [{product_name, color, size, quantity}]
--   Returns: {ok:true, order_number} | {ok:false, error:'insufficient_stock',
--             shortages:[{product_name,color,size,requested,available}]}
--   Products that have NO product_variants rows are not stock-tracked and are
--   accepted without deduction (unchanged legacy behaviour).
-- ---------------------------------------------------------------------------
create or replace function public.create_order_with_stock(
  p_order_number     text,
  p_customer_name    text,
  p_customer_phone   text,
  p_customer_address text,
  p_items            jsonb,
  p_notes            text,
  p_conversation_id  uuid,
  p_merchant_id      uuid,
  p_customer_id      uuid,
  p_payment_method   text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id    uuid;
  v_item       jsonb;
  v_name       text;
  v_color      text;
  v_size       text;
  v_qty        integer;
  v_available  integer;
  v_tracked    boolean;
  v_need       integer;
  v_take       integer;
  v_row        record;
  v_shortages  jsonb := '[]'::jsonb;
  v_deducted   jsonb := '[]'::jsonb;
begin
  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  -- Pass 1: lock + verify availability for every item.
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name  := lower(btrim(coalesce(v_item->>'product_name', '')));
    v_color := nullif(lower(btrim(coalesce(v_item->>'color', ''))), '');
    v_size  := nullif(lower(btrim(coalesce(v_item->>'size', ''))), '');
    v_qty   := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

    -- Is this product stock-tracked at all?
    select exists (
      select 1
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      where lower(btrim(p.name)) = v_name
        and (v_user_id is null or p.user_id = v_user_id)
    ) into v_tracked;
    if not v_tracked then
      continue;
    end if;

    -- Lock every matching variant row (latest committed stock, serialized).
    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from (
      select pv.*
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      where lower(btrim(p.name)) = v_name
        and (v_user_id is null or p.user_id = v_user_id)
        and (v_color is null or lower(btrim(coalesce(pv.color, ''))) = v_color)
        and (v_size  is null or lower(btrim(coalesce(pv.size,  ''))) = v_size)
      order by pv.id
      for update
    ) pv;

    if v_available < v_qty then
      v_shortages := v_shortages || jsonb_build_object(
        'product_name', v_item->>'product_name',
        'color',        v_item->>'color',
        'size',         v_item->>'size',
        'requested',    v_qty,
        'available',    v_available
      );
    end if;
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'shortages', v_shortages);
  end if;

  -- Pass 2: deduct (rows already locked in this transaction).
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name  := lower(btrim(coalesce(v_item->>'product_name', '')));
    v_color := nullif(lower(btrim(coalesce(v_item->>'color', ''))), '');
    v_size  := nullif(lower(btrim(coalesce(v_item->>'size', ''))), '');
    v_qty   := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_name = '' or v_qty <= 0 then
      continue;
    end if;
    v_need := v_qty;

    for v_row in
      select pv.id, greatest(coalesce(pv.stock, 0), 0) as stock
      from public.product_variants pv
      join public.products p on p.id = pv.product_id
      where lower(btrim(p.name)) = v_name
        and (v_user_id is null or p.user_id = v_user_id)
        and (v_color is null or lower(btrim(coalesce(pv.color, ''))) = v_color)
        and (v_size  is null or lower(btrim(coalesce(pv.size,  ''))) = v_size)
      order by greatest(coalesce(pv.stock, 0), 0) desc, pv.id
      for update
    loop
      exit when v_need <= 0;
      v_take := least(v_need, v_row.stock);
      if v_take > 0 then
        update public.product_variants
          set stock = greatest(coalesce(stock, 0), 0) - v_take
          where id = v_row.id;
        v_deducted := v_deducted || jsonb_build_object('variant_id', v_row.id, 'quantity', v_take);
        v_need := v_need - v_take;
      end if;
    end loop;

    if v_need > 0 then
      -- Should be unreachable (pass 1 verified), but never oversell.
      raise exception 'insufficient stock for %', v_item->>'product_name';
    end if;
  end loop;

  insert into public.orders (
    order_number, customer_name, customer_phone, customer_address,
    items, notes, status, conversation_id, merchant_id, customer_id,
    payment_method, stock_deducted
  ) values (
    p_order_number, p_customer_name, p_customer_phone, p_customer_address,
    p_items, p_notes, 'new', p_conversation_id, p_merchant_id, p_customer_id,
    p_payment_method, v_deducted
  );

  return jsonb_build_object('ok', true, 'order_number', p_order_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- cancel_order_restock — returns the exact deducted quantities to stock and
-- marks the order cancelled. Idempotent: a second call changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_order_restock(
  p_order_id    uuid,
  p_merchant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order  record;
  v_entry  jsonb;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and merchant_id = p_merchant_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', true, 'already_cancelled', true);
  end if;

  for v_entry in select * from jsonb_array_elements(coalesce(v_order.stock_deducted, '[]'::jsonb))
  loop
    update public.product_variants
      set stock = greatest(coalesce(stock, 0), 0) + coalesce((v_entry->>'quantity')::numeric, 0)::integer
      where id = (v_entry->>'variant_id')::uuid;
  end loop;

  update public.orders
    set status = 'cancelled', stock_deducted = '[]'::jsonb
    where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.create_order_with_stock(
  text, text, text, text, jsonb, text, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.cancel_order_restock(uuid, uuid) to service_role;

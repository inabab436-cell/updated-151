-- =============================================================================
-- CUPAI — Deferred stock deduction for MANUAL payment methods.
--
-- Rules implemented here (DB is the single source of truth for stock):
--   * Automatic payment method  -> stock is verified AND deducted atomically
--     at order creation (unchanged behaviour).
--   * Manual payment method     -> the order is created WITHOUT deducting any
--     stock (payment_status = 'pending'). Stock is only deducted when the
--     merchant presses "تأكيد الدفع", which re-verifies the LATEST committed
--     stock inside the same transaction.
--   * Availability is ALWAYS verified before an order row is written, for both
--     behaviours, so a customer is never allowed to finish checkout for a
--     quantity that is not available.
--   * Double deduction is impossible: confirm_order_payment locks the order
--     row and is a no-op when payment_status is already 'confirmed'.
--
-- Safe to re-run.
-- =============================================================================

-- 1. Payment lifecycle columns -------------------------------------------------
alter table public.orders
  add column if not exists payment_status       text,
  add column if not exists payment_confirmed_at timestamptz;

-- Existing rows were created by the old always-deduct path.
update public.orders set payment_status = 'confirmed' where payment_status is null;

alter table public.orders alter column payment_status set default 'confirmed';

-- 2. Shared availability check (read-only, no locks) --------------------------
--    Used by the storefront BEFORE the customer fills in their data, so we can
--    tell them up-front that the requested quantity is not available.
create or replace function public.check_order_stock(
  p_items       jsonb,
  p_merchant_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_item      jsonb;
  v_name      text;
  v_color     text;
  v_size      text;
  v_qty       integer;
  v_available integer;
  v_tracked   boolean;
  v_shortages jsonb := '[]'::jsonb;
begin
  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name  := lower(btrim(coalesce(v_item->>'product_name', '')));
    v_color := nullif(lower(btrim(coalesce(v_item->>'color', ''))), '');
    v_size  := nullif(lower(btrim(coalesce(v_item->>'size', ''))), '');
    v_qty   := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

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

    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from public.product_variants pv
    join public.products p on p.id = pv.product_id
    where lower(btrim(p.name)) = v_name
      and (v_user_id is null or p.user_id = v_user_id)
      and (v_color is null or lower(btrim(coalesce(pv.color, ''))) = v_color)
      and (v_size  is null or lower(btrim(coalesce(pv.size,  ''))) = v_size);

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
  return jsonb_build_object('ok', true);
end;
$$;

-- 3. create_order_with_stock — now takes p_deduct_stock / p_payment_status ----
--    The old 10-argument signature is dropped so calls stay unambiguous.
drop function if exists public.create_order_with_stock(
  text, text, text, text, jsonb, text, uuid, uuid, uuid, text
);

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
  p_payment_method   text,
  p_deduct_stock     boolean default true,
  p_payment_status   text    default 'confirmed'
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

  -- Pass 1: lock + verify availability for every item (both behaviours).
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_name  := lower(btrim(coalesce(v_item->>'product_name', '')));
    v_color := nullif(lower(btrim(coalesce(v_item->>'color', ''))), '');
    v_size  := nullif(lower(btrim(coalesce(v_item->>'size', ''))), '');
    v_qty   := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

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

  -- Pass 2: deduct ONLY for automatic payment (p_deduct_stock = true).
  if coalesce(p_deduct_stock, true) then
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
        raise exception 'insufficient stock for %', v_item->>'product_name';
      end if;
    end loop;
  end if;

  insert into public.orders (
    order_number, customer_name, customer_phone, customer_address,
    items, notes, status, conversation_id, merchant_id, customer_id,
    payment_method, stock_deducted, payment_status, payment_confirmed_at
  ) values (
    p_order_number, p_customer_name, p_customer_phone, p_customer_address,
    p_items, p_notes, 'new', p_conversation_id, p_merchant_id, p_customer_id,
    p_payment_method, v_deducted,
    coalesce(p_payment_status, 'confirmed'),
    case when coalesce(p_payment_status, 'confirmed') = 'confirmed' then now() else null end
  );

  return jsonb_build_object(
    'ok', true,
    'order_number', p_order_number,
    'payment_status', coalesce(p_payment_status, 'confirmed'),
    'stock_deducted', coalesce(p_deduct_stock, true)
  );
end;
$$;

-- 4. confirm_order_payment — merchant confirms a manual payment ---------------
--    Re-verifies the LATEST stock, then deducts. Idempotent: a second call on
--    an already-confirmed order changes nothing (no double deduction).
create or replace function public.confirm_order_payment(
  p_order_id    uuid,
  p_merchant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order      record;
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
  select * into v_order
  from public.orders
  where id = p_order_id and merchant_id = p_merchant_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled');
  end if;

  -- Already paid → no-op (protects against double deduction / double clicks).
  if coalesce(v_order.payment_status, 'confirmed') = 'confirmed' then
    return jsonb_build_object('ok', true, 'already_confirmed', true);
  end if;

  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  -- Pass 1: lock + re-verify against the latest committed stock.
  for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb))
  loop
    v_name  := lower(btrim(coalesce(v_item->>'product_name', '')));
    v_color := nullif(lower(btrim(coalesce(v_item->>'color', ''))), '');
    v_size  := nullif(lower(btrim(coalesce(v_item->>'size', ''))), '');
    v_qty   := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_name = '' or v_qty <= 0 then
      continue;
    end if;

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

  -- Pass 2: deduct.
  for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb))
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
      raise exception 'insufficient stock for %', v_item->>'product_name';
    end if;
  end loop;

  update public.orders
    set payment_status       = 'confirmed',
        payment_confirmed_at = now(),
        stock_deducted       = coalesce(stock_deducted, '[]'::jsonb) || v_deducted
    where id = p_order_id;

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.check_order_stock(jsonb, uuid) to service_role;
grant execute on function public.create_order_with_stock(
  text, text, text, text, jsonb, text, uuid, uuid, uuid, text, boolean, text
) to service_role;
grant execute on function public.confirm_order_payment(uuid, uuid) to service_role;

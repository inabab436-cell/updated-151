-- Add products to an existing conversation order atomically. The order row is
-- updated in place, so status, payment state/method, customer, timestamps and
-- every operational setting remain unchanged. Only the complete basket,
-- calculated amounts, note and additional stock deduction are changed.
create or replace function public.update_order_with_stock(
  p_order_number   text,
  p_conversation_id uuid,
  p_merchant_id    uuid,
  p_items          jsonb,
  p_stock_items    jsonb,
  p_notes          text,
  p_subtotal       numeric,
  p_discount       numeric,
  p_shipping       numeric,
  p_total          numeric
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
  v_product    uuid;
  v_color      text;
  v_size       text;
  v_qty        integer;
  v_available  integer;
  v_need       integer;
  v_take       integer;
  v_row        record;
  v_shortages  jsonb := '[]'::jsonb;
  v_deducted   jsonb := '[]'::jsonb;
  v_should_deduct boolean;
begin
  select * into v_order
  from public.orders
  where order_number = p_order_number
    and conversation_id = p_conversation_id
    and merchant_id = p_merchant_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'error', 'cancelled');
  end if;

  v_should_deduct := coalesce(v_order.payment_status, 'confirmed') <> 'pending';
  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  -- Confirm availability while locking every affected variant. For a pending
  -- manual-payment order p_stock_items is the complete basket; otherwise it is
  -- only the newly requested delta.
  for v_item in select * from jsonb_array_elements(coalesce(p_stock_items, '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_qty <= 0 then continue; end if;
    v_product := public.cupai_resolve_product(v_item, v_user_id);
    if v_product is null then continue; end if;
    v_color := nullif(public.cupai_norm(v_item->>'color'), '');
    v_size  := nullif(public.cupai_norm(v_item->>'size'), '');

    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from (
      select pv.* from public.product_variants pv
      where pv.product_id = v_product
        and (v_color is null or public.cupai_norm(pv.color) = v_color)
        and (v_size is null or public.cupai_norm(pv.size) = v_size)
      order by pv.id for update
    ) pv;

    if v_available < v_qty then
      v_shortages := v_shortages || jsonb_build_object(
        'product_name', v_item->>'product_name', 'color', v_item->>'color',
        'size', v_item->>'size', 'requested', v_qty, 'available', v_available
      );
    end if;
  end loop;

  if jsonb_array_length(v_shortages) > 0 then
    return jsonb_build_object('ok', false, 'error', 'insufficient_stock', 'shortages', v_shortages);
  end if;

  if v_should_deduct then
    for v_item in select * from jsonb_array_elements(coalesce(p_stock_items, '[]'::jsonb))
    loop
      v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
      if v_qty <= 0 then continue; end if;
      v_product := public.cupai_resolve_product(v_item, v_user_id);
      if v_product is null then continue; end if;
      v_color := nullif(public.cupai_norm(v_item->>'color'), '');
      v_size  := nullif(public.cupai_norm(v_item->>'size'), '');
      v_need := v_qty;

      for v_row in
        select pv.id, greatest(coalesce(pv.stock, 0), 0) as stock
        from public.product_variants pv
        where pv.product_id = v_product
          and (v_color is null or public.cupai_norm(pv.color) = v_color)
          and (v_size is null or public.cupai_norm(pv.size) = v_size)
        order by greatest(coalesce(pv.stock, 0), 0) desc, pv.id
        for update
      loop
        exit when v_need <= 0;
        v_take := least(v_need, v_row.stock);
        if v_take > 0 then
          update public.product_variants set stock = greatest(coalesce(stock, 0), 0) - v_take
          where id = v_row.id;
          v_deducted := v_deducted || jsonb_build_object('variant_id', v_row.id, 'quantity', v_take);
          v_need := v_need - v_take;
        end if;
      end loop;
    end loop;
  end if;

  update public.orders
  set items = p_items,
      notes = coalesce(p_notes, notes),
      subtotal_price = p_subtotal,
      discount_amount = p_discount,
      shipping_cost = p_shipping,
      total_price = p_total,
      stock_deducted = coalesce(stock_deducted, '[]'::jsonb) || v_deducted
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true, 'order_number', p_order_number, 'updated_existing', true,
    'stock_deducted', v_should_deduct
  );
end;
$$;

grant execute on function public.update_order_with_stock(
  text, uuid, uuid, jsonb, jsonb, text, numeric, numeric, numeric, numeric
) to service_role;

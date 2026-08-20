-- Reserve inventory for every accepted order, including manual-payment orders.
-- New manual orders already carry stock_deducted entries. Payment confirmation
-- therefore only changes payment state and records offers; legacy pending rows
-- with no deduction keep the previous verify-and-deduct behaviour.

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
  v_offers     integer := 0;
  v_reserved   boolean := false;
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
  if coalesce(v_order.payment_status, 'confirmed') = 'confirmed' then
    v_offers := public.record_order_offer_redemptions(p_order_id, p_merchant_id);
    return jsonb_build_object(
      'ok', true, 'already_confirmed', true, 'offers_handled', true,
      'offers_recorded', v_offers
    );
  end if;

  v_reserved := jsonb_typeof(v_order.stock_deducted) = 'array'
    and jsonb_array_length(v_order.stock_deducted) > 0;

  -- Backward compatibility: pending orders created before immediate reservation
  -- still need their stock verified and deducted at confirmation.
  if not v_reserved then
    select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

    for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb))
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
      return jsonb_build_object(
        'ok', false, 'error', 'insufficient_stock', 'shortages', v_shortages
      );
    end if;

    for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb))
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
          update public.product_variants
          set stock = greatest(coalesce(stock, 0), 0) - v_take
          where id = v_row.id;
          v_deducted := v_deducted || jsonb_build_object(
            'variant_id', v_row.id, 'quantity', v_take
          );
          v_need := v_need - v_take;
        end if;
      end loop;

      if v_need > 0 then
        raise exception 'insufficient stock for %', v_item->>'product_name';
      end if;
    end loop;
  end if;

  update public.orders
  set payment_status       = 'confirmed',
      payment_confirmed_at = now(),
      stock_deducted       = coalesce(stock_deducted, '[]'::jsonb) || v_deducted
  where id = p_order_id;

  v_offers := public.record_order_offer_redemptions(p_order_id, p_merchant_id);
  return jsonb_build_object(
    'ok', true, 'stock_already_reserved', v_reserved, 'offers_handled', true,
    'offers_recorded', v_offers
  );
end;
$$;

grant execute on function public.confirm_order_payment(uuid, uuid) to service_role;
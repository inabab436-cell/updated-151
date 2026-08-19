-- =============================================================================
-- CUPAI — Fix the MISSING LINK in stock deduction: product / colour / size are
-- now matched the SAME lenient way the rest of the app matches them.
--
-- The problem
-- -----------
-- `create_order_with_stock`, `check_order_stock` and `confirm_order_payment`
-- located the rows to deduct with an EXACT comparison:
--     lower(btrim(products.name)) = lower(btrim(item->>'product_name'))
-- while the agent (and the availability pre-check) match leniently: ignoring
-- diacritics, hamza forms (أ/ا), ة/ه, ى/ي, punctuation and spacing, and
-- accepting a shorter product title. Result, for any wording difference:
--   * pass 1 concluded "this product is not stock-tracked" and skipped it, so
--     NO stock was ever deducted for an automatic payment, silently, and
--   * pass 2 (which had no such skip) then raised
--     `insufficient stock for <product>`, rolling the whole order back,
--   * the merchant's later "تأكيد الدفع" on a manual order hit exactly the
--     same dead end, so confirming the payment deducted nothing.
--
-- The fix
-- -------
--   1. `p_items[i].product_id`, which the app already stores on every line, is
--      the primary key used to find the variants.
--   2. When it is absent, the product name is matched on a NORMALIZED form,
--      falling back to a unique containment match.
--   3. Colour / size are compared normalized too.
--   4. Pass 2 skips lines with no tracked product instead of raising, so a
--      non-tracked product can never abort a valid order.
--
-- Everything else (locking, atomicity, idempotency, offers) is unchanged.
-- Safe to re-run.
-- =============================================================================

-- 1. Normalization shared by every matcher -----------------------------------
create or replace function public.cupai_norm(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(
           translate(
             regexp_replace(lower(coalesce(p_value, '')), '[\u064B-\u0652]', '', 'g'),
             'أإآةى', 'ااايهي'
           ),
           '[^[:alnum:]\u0600-\u06FF]', '', 'g'
         );
$$;

-- 2. Resolve the product of one order line -----------------------------------
--    Returns null when the line matches no stock-tracked product.
create or replace function public.cupai_resolve_product(
  p_item    jsonb,
  p_user_id uuid
)
returns uuid
language plpgsql
stable
set search_path = public
as $$
declare
  v_id   uuid;
  v_key  text;
  v_hits uuid[];
begin
  -- (a) explicit product_id carried by the order line
  begin
    v_id := nullif(p_item->>'product_id', '')::uuid;
  exception when others then
    v_id := null;
  end;
  if v_id is not null then
    select p.id into v_id
    from public.products p
    where p.id = v_id
      and (p_user_id is null or p.user_id = p_user_id)
      and exists (select 1 from public.product_variants pv where pv.product_id = p.id);
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_key := public.cupai_norm(p_item->>'product_name');
  if v_key = '' then
    return null;
  end if;

  -- (b) normalized exact name
  select array_agg(p.id) into v_hits
  from public.products p
  where (p_user_id is null or p.user_id = p_user_id)
    and public.cupai_norm(p.name) = v_key
    and exists (select 1 from public.product_variants pv where pv.product_id = p.id);
  if v_hits is not null and array_length(v_hits, 1) = 1 then
    return v_hits[1];
  end if;

  -- (c) unique containment match ("هودي مخطط" ⊂ "IKE BRAS هودي مخطط")
  select array_agg(p.id) into v_hits
  from public.products p
  where (p_user_id is null or p.user_id = p_user_id)
    and public.cupai_norm(p.name) <> ''
    and (public.cupai_norm(p.name) like '%' || v_key || '%'
      or v_key like '%' || public.cupai_norm(p.name) || '%')
    and exists (select 1 from public.product_variants pv where pv.product_id = p.id);
  if v_hits is not null and array_length(v_hits, 1) = 1 then
    return v_hits[1];
  end if;

  return null;
end;
$$;

-- 3. check_order_stock (read-only pre-check) ---------------------------------
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
  v_product   uuid;
  v_color     text;
  v_size      text;
  v_qty       integer;
  v_available integer;
  v_shortages jsonb := '[]'::jsonb;
begin
  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_qty <= 0 then
      continue;
    end if;
    v_product := public.cupai_resolve_product(v_item, v_user_id);
    if v_product is null then
      continue; -- product is not stock-tracked
    end if;
    v_color := nullif(public.cupai_norm(v_item->>'color'), '');
    v_size  := nullif(public.cupai_norm(v_item->>'size'), '');

    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from public.product_variants pv
    where pv.product_id = v_product
      and (v_color is null or public.cupai_norm(pv.color) = v_color)
      and (v_size  is null or public.cupai_norm(pv.size)  = v_size);

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

-- 4. create_order_with_stock -------------------------------------------------
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
begin
  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  -- Pass 1: lock + verify availability for every item (both behaviours).
  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_qty <= 0 then
      continue;
    end if;
    v_product := public.cupai_resolve_product(v_item, v_user_id);
    if v_product is null then
      continue;
    end if;
    v_color := nullif(public.cupai_norm(v_item->>'color'), '');
    v_size  := nullif(public.cupai_norm(v_item->>'size'), '');

    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from (
      select pv.*
      from public.product_variants pv
      where pv.product_id = v_product
        and (v_color is null or public.cupai_norm(pv.color) = v_color)
        and (v_size  is null or public.cupai_norm(pv.size)  = v_size)
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
      v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
      if v_qty <= 0 then
        continue;
      end if;
      v_product := public.cupai_resolve_product(v_item, v_user_id);
      if v_product is null then
        continue; -- not stock-tracked: never abort the order for it
      end if;
      v_color := nullif(public.cupai_norm(v_item->>'color'), '');
      v_size  := nullif(public.cupai_norm(v_item->>'size'), '');
      v_need  := v_qty;

      for v_row in
        select pv.id, greatest(coalesce(pv.stock, 0), 0) as stock
        from public.product_variants pv
        where pv.product_id = v_product
          and (v_color is null or public.cupai_norm(pv.color) = v_color)
          and (v_size  is null or public.cupai_norm(pv.size)  = v_size)
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
    payment_method, stock_deducted, payment_status,
    payment_confirmed_at
  ) values (
    p_order_number, p_customer_name, p_customer_phone, p_customer_address,
    p_items, p_notes, 'new', p_conversation_id, p_merchant_id, p_customer_id,
    p_payment_method, v_deducted, coalesce(p_payment_status, 'confirmed'),
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

-- 5. confirm_order_payment ---------------------------------------------------
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
      'ok', true,
      'already_confirmed', true,
      'offers_handled', true,
      'offers_recorded', v_offers
    );
  end if;

  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;

  -- Pass 1: lock + re-verify against the latest committed stock.
  for v_item in select * from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb))
  loop
    v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_qty <= 0 then
      continue;
    end if;
    v_product := public.cupai_resolve_product(v_item, v_user_id);
    if v_product is null then
      continue;
    end if;
    v_color := nullif(public.cupai_norm(v_item->>'color'), '');
    v_size  := nullif(public.cupai_norm(v_item->>'size'), '');

    select coalesce(sum(greatest(coalesce(pv.stock, 0), 0)), 0)::integer
      into v_available
    from (
      select pv.*
      from public.product_variants pv
      where pv.product_id = v_product
        and (v_color is null or public.cupai_norm(pv.color) = v_color)
        and (v_size  is null or public.cupai_norm(pv.size)  = v_size)
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
    v_qty := coalesce((v_item->>'quantity')::numeric, 0)::integer;
    if v_qty <= 0 then
      continue;
    end if;
    v_product := public.cupai_resolve_product(v_item, v_user_id);
    if v_product is null then
      continue;
    end if;
    v_color := nullif(public.cupai_norm(v_item->>'color'), '');
    v_size  := nullif(public.cupai_norm(v_item->>'size'), '');
    v_need  := v_qty;

    for v_row in
      select pv.id, greatest(coalesce(pv.stock, 0), 0) as stock
      from public.product_variants pv
      where pv.product_id = v_product
        and (v_color is null or public.cupai_norm(pv.color) = v_color)
        and (v_size  is null or public.cupai_norm(pv.size)  = v_size)
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

  v_offers := public.record_order_offer_redemptions(p_order_id, p_merchant_id);

  return jsonb_build_object(
    'ok', true,
    'offers_handled', true,
    'offers_recorded', v_offers
  );
end;
$$;

grant execute on function public.cupai_norm(text) to service_role;
grant execute on function public.cupai_resolve_product(jsonb, uuid) to service_role;
grant execute on function public.check_order_stock(jsonb, uuid) to service_role;
grant execute on function public.create_order_with_stock(
  text, text, text, text, jsonb, text, uuid, uuid, uuid, text, boolean, text
) to service_role;
grant execute on function public.confirm_order_payment(uuid, uuid) to service_role;

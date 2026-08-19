-- =============================================================================
-- CUPAI — Payment confirmation, stock deduction and offer redemption in ONE
-- atomic transaction.
--
-- Why: stock deduction used to happen inside `confirm_order_payment` while the
-- offer redemption was recorded afterwards from application code. If that
-- second step failed (or the app crashed / the request was cut), the stock was
-- already gone but the customer was never registered as a beneficiary and the
-- counter never moved. Both halves now live in the SAME function, so either
-- everything happens or nothing does.
--
-- The business logic is UNCHANGED — it is the exact same logic that used to run
-- in `offer-redemptions.server.ts`:
--   * an offer counts only for a PAID order,
--   * live window (is_active, starts_at, ends_at) and sold-out check on
--     beneficiary_count vs max_redemptions,
--   * min_order_total against the real order total,
--   * scope 'all' or the offer's product present in the order items,
--   * usage_limit_type 'once_per_customer' → a customer counts once only,
--   * unique (offer_id, order_id) → confirming twice never inflates anything,
--   * redemption_count = total rows, beneficiary_count = unique customers.
--
-- Safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Order total: the stored total, or the sum of the item lines when absent.
create or replace function public.order_total_value(p_order public.orders)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item  jsonb;
  v_total numeric := 0;
begin
  if p_order.total_price is not null then
    return coalesce(p_order.total_price, 0);
  end if;
  for v_item in select * from jsonb_array_elements(coalesce(p_order.items, '[]'::jsonb))
  loop
    v_total := v_total
      + coalesce(
          nullif(v_item->>'price', '')::numeric,
          nullif(v_item->>'unit_price', '')::numeric,
          0
        )
      * coalesce(nullif(nullif(v_item->>'quantity', '')::numeric, 0), 1);
  end loop;
  return v_total;
end;
$$;

-- Stable identity of the customer behind an order (same order of precedence as
-- customerKeyOf() in the application code).
create or replace function public.order_customer_key(p_order public.orders)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when coalesce(btrim(p_order.customer_id::text), '') <> ''      then 'c:' || btrim(p_order.customer_id::text)
    when coalesce(btrim(p_order.customer_phone), '') <> ''         then 'p:' || btrim(p_order.customer_phone)
    when coalesce(btrim(p_order.conversation_id::text), '') <> ''  then 'v:' || btrim(p_order.conversation_id::text)
    else 'o:' || p_order.id::text
  end;
$$;

-- ---------------------------------------------------------------------------
-- record_order_offer_redemptions — records every offer that applies to an
-- already PAID order and refreshes that offer's counters. Idempotent.
-- ---------------------------------------------------------------------------
create or replace function public.record_order_offer_redemptions(
  p_order_id    uuid,
  p_merchant_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order        public.orders;
  v_user_id      uuid;
  v_total        numeric;
  v_key          text;
  v_offer        record;
  v_applies      boolean;
  v_already_used boolean;
  v_inserted     integer;
  v_recorded     integer := 0;
begin
  select * into v_order
  from public.orders
  where id = p_order_id and merchant_id = p_merchant_id;
  if not found then
    return 0;
  end if;

  -- Never count an order that is not actually paid.
  if coalesce(v_order.payment_status, 'confirmed') <> 'confirmed' then
    return 0;
  end if;
  if v_order.status = 'cancelled' then
    return 0;
  end if;

  select m.user_id into v_user_id from public.merchants m where m.id = p_merchant_id;
  if v_user_id is null then
    return 0;
  end if;

  v_total := public.order_total_value(v_order);
  v_key   := public.order_customer_key(v_order);

  for v_offer in
    select o.*, p.name as product_name
    from public.offers o
    left join public.products p on p.id = o.product_id
    where o.user_id = v_user_id
      and o.is_active is not false
      and coalesce(o.starts_at, now()) <= now()
      and (o.ends_at is null or o.ends_at > now())
      and (
        o.max_redemptions is null
        or o.max_redemptions <= 0
        or coalesce(o.beneficiary_count, 0) < o.max_redemptions
      )
    order by o.id
    for update of o
  loop
    -- min_order_total
    if v_offer.min_order_total is not null and v_total < v_offer.min_order_total then
      continue;
    end if;

    -- scope
    if coalesce(v_offer.scope, 'product') = 'all' then
      v_applies := true;
    elsif coalesce(btrim(v_offer.product_name), '') = '' then
      v_applies := false;
    else
      select exists (
        select 1
        from jsonb_array_elements(coalesce(v_order.items, '[]'::jsonb)) it
        where lower(btrim(coalesce(it->>'product_name', ''))) = lower(btrim(v_offer.product_name))
      ) into v_applies;
    end if;
    if not v_applies then
      continue;
    end if;

    -- "once per customer": a customer who already benefited never counts again.
    select exists (
      select 1 from public.offer_redemptions r
      where r.offer_id = v_offer.id and r.customer_key = v_key
    ) into v_already_used;
    if coalesce(v_offer.usage_limit_type, 'per_order') = 'once_per_customer' and v_already_used then
      continue;
    end if;

    insert into public.offer_redemptions (
      offer_id, order_id, conversation_id, customer_name, order_total, customer_key
    ) values (
      v_offer.id, v_order.id, v_order.conversation_id, v_order.customer_name, v_total, v_key
    )
    on conflict (offer_id, order_id) do nothing;

    get diagnostics v_inserted = row_count;
    v_recorded := v_recorded + coalesce(v_inserted, 0);

    -- Counters are always recomputed from the rows themselves, so they self-heal
    -- even if an earlier run stopped half-way.
    update public.offers o
      set redemption_count = stats.uses,
          beneficiary_count = stats.customers
    from (
      select count(*)::integer as uses,
             count(distinct coalesce(r.customer_key, r.order_id::text))::integer as customers
      from public.offer_redemptions r
      where r.offer_id = v_offer.id
    ) stats
    where o.id = v_offer.id
      and (o.redemption_count is distinct from stats.uses
        or o.beneficiary_count is distinct from stats.customers);
  end loop;

  return v_recorded;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_order_payment — merchant confirms a manual payment.
--   Pass 1: lock + verify the latest stock (fails BEFORE anything changes).
--   Pass 2: deduct the stock.
--   Then  : mark the payment confirmed and record the offer redemptions.
-- All of it in one transaction, and idempotent on a second call.
-- ---------------------------------------------------------------------------
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

  -- Already paid → no stock movement. The redemption recording still runs
  -- because it is idempotent; it only fixes a previous half-finished run.
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

  -- Not enough stock → nothing at all happens (no deduction, no redemption).
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
      -- Unreachable (pass 1 verified) — raising rolls the whole thing back.
      raise exception 'insufficient stock for %', v_item->>'product_name';
    end if;
  end loop;

  update public.orders
    set payment_status       = 'confirmed',
        payment_confirmed_at = now(),
        stock_deducted       = coalesce(stock_deducted, '[]'::jsonb) || v_deducted
    where id = p_order_id;

  -- Same transaction: if this fails, the stock deduction above is rolled back.
  v_offers := public.record_order_offer_redemptions(p_order_id, p_merchant_id);

  return jsonb_build_object(
    'ok', true,
    'offers_handled', true,
    'offers_recorded', v_offers
  );
end;
$$;

grant execute on function public.record_order_offer_redemptions(uuid, uuid) to service_role;
grant execute on function public.confirm_order_payment(uuid, uuid) to service_role;

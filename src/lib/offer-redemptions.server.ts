/**
 * OFFER REDEMPTIONS — the only place where an offer is counted as "used".
 *
 * Hard rule: a discount/offer is NEVER counted for a customer before the
 * merchant confirms the payment of that order, because the discount is tied to
 * the real value of a paid order. Both confirmation entry points (orders page
 * and conversation page) call `recordOfferRedemptionsForOrders` right after a
 * successful confirmation.
 *
 * Recording is idempotent through the unique (offer_id, order_id) constraint.
 * Server-only (service-role client).
 */
import { isLive, mapOfferRow, type OfferRow } from "@/lib/offers.server";
import { evaluateOffer } from "@/lib/offer-engine.server";

function toNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Order total: the stored total, or the sum of item lines when absent. */
export function orderTotal(order: Record<string, unknown>): number {
  if (order.total_price != null) return toNumber(order.total_price);
  const items = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : [];
  return items.reduce(
    (sum, it) => sum + toNumber(it.price ?? it.unit_price) * (toNumber(it.quantity) || 1),
    0,
  );
}

/** Priced cart lines stored on the order, when the order was priced. */
function pricedLines(order: Record<string, unknown>) {
  const items = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : [];
  return items
    .filter((it) => it.product_id && toNumber(it.unit_price ?? it.price) > 0)
    .map((it) => ({
      product_id: String(it.product_id),
      unit_price: toNumber(it.unit_price ?? it.price),
      quantity: toNumber(it.quantity) || 1,
      name: String(it.product_name ?? ""),
    }));
}

/**
 * True when the paid order is actually covered by the offer.
 *
 * When the order carries priced lines (the normal case since orders are priced
 * at creation), the DETERMINISTIC offer engine decides — so a product-scoped
 * minimum is checked against that product's own subtotal, exactly like the
 * quote the customer received. Older, price-less orders fall back to the
 * simple order-total comparison.
 */
export function offerAppliesToOrder(
  offer: OfferRow,
  productName: string | null,
  order: Record<string, unknown>,
): boolean {
  const lines = pricedLines(order);
  if (lines.length) {
    return evaluateOffer(offer, lines).applies;
  }
  const total = orderTotal(order);
  if (offer.min_order_total != null && total < offer.min_order_total) return false;
  if (offer.scope === "all") return true;
  if (!productName) return false;
  const target = productName.trim().toLowerCase();
  const items = Array.isArray(order.items) ? (order.items as Record<string, unknown>[]) : [];
  return items.some((it) => String(it.product_name ?? "").trim().toLowerCase() === target);
}


/** Stable identity of the customer behind an order. */
export function customerKeyOf(order: Record<string, unknown>): string {
  const id = order.customer_id ? String(order.customer_id).trim() : "";
  if (id) return `c:${id}`;
  const phone = order.customer_phone ? String(order.customer_phone).trim() : "";
  if (phone) return `p:${phone}`;
  const convo = order.conversation_id ? String(order.conversation_id).trim() : "";
  if (convo) return `v:${convo}`;
  return `o:${String(order.id ?? "")}`;
}

/**
 * Records the beneficiaries for every offer that applies to the given, now
 * PAID orders, and bumps each offer's redemption counter.
 */
export async function recordOfferRedemptionsForOrders(
  admin: any,
  opts: { merchantId: string; orderIds: string[] },
): Promise<number> {
  const ids = (opts.orderIds ?? []).filter(Boolean);
  if (!ids.length) return 0;

  try {
    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", opts.merchantId)
      .maybeSingle();
    const userId = merchant?.user_id ? String(merchant.user_id) : null;
    if (!userId) return 0;

    const { data: offerRows } = await admin.from("offers").select("*").eq("user_id", userId);
    const offers = ((offerRows ?? []) as Record<string, unknown>[])
      .map(mapOfferRow)
      .filter((o) => isLive(o));
    if (!offers.length) return 0;

    const productIds = offers.map((o) => o.product_id).filter(Boolean) as string[];
    const names = new Map<string, string>();
    if (productIds.length) {
      const { data: prods } = await admin.from("products").select("id, name").in("id", productIds);
      for (const p of (prods ?? []) as any[]) names.set(String(p.id), String(p.name ?? ""));
    }

    const { data: orders } = await admin
      .from("orders")
      .select(
        "id, conversation_id, customer_id, customer_phone, customer_name, total_price, items, payment_status",
      )
      .in("id", ids);

    let recorded = 0;
    for (const order of ((orders ?? []) as Record<string, unknown>[])) {
      // Belt and braces: never count an order that is not actually paid.
      if (String(order.payment_status ?? "confirmed") === "pending") continue;
      const customerKey = customerKeyOf(order);
      for (const offer of offers) {
        const pname = offer.product_id ? names.get(offer.product_id) ?? null : null;
        if (!offerAppliesToOrder(offer, pname, order)) continue;

        // "Once per customer": a customer who already benefited is never
        // counted again, and the offer simply does not apply to that order.
        const { data: prior } = await admin
          .from("offer_redemptions")
          .select("id")
          .eq("offer_id", offer.id)
          .eq("customer_key", customerKey)
          .limit(1);
        const alreadyUsed = ((prior ?? []) as any[]).length > 0;
        if (offer.usage_limit_type === "once_per_customer" && alreadyUsed) continue;

        const { error } = await admin.from("offer_redemptions").insert({
          offer_id: offer.id,
          order_id: String(order.id),
          conversation_id: order.conversation_id ?? null,
          customer_name: order.customer_name ?? null,
          order_total: orderTotal(order),
          customer_key: customerKey,
        });
        // A duplicate row means this order was already recorded (idempotent);
        // the counters are still refreshed below so a previous half-finished
        // run can never leave the offer counter behind.
        if (!error) recorded += 1;

        // Uses = every recorded row. Beneficiaries = unique customers.
        const { data: allRows } = await admin
          .from("offer_redemptions")
          .select("customer_key, order_id")
          .eq("offer_id", offer.id);
        const rows = (allRows ?? []) as any[];
        const uniq = new Set(rows.map((r) => String(r.customer_key ?? r.order_id)));
        await admin
          .from("offers")
          .update({ redemption_count: rows.length, beneficiary_count: uniq.size })
          .eq("id", offer.id);

      }
    }
    return recorded;
  } catch {
    return 0;
  }
}

/**
 * Same recording, but keyed by order NUMBER.
 *
 * Orders paid through an AUTOMATIC method (cash on delivery, …) are stored as
 * `confirmed` at creation time, so they never pass through the merchant's
 * "confirm payment" action — which used to be the only place offers were
 * counted. Those orders are counted here, right after creation, so the offer
 * counters reflect every customer who actually benefited.
 */
export async function recordOfferRedemptionsForOrderNumbers(
  admin: any,
  opts: { merchantId: string; orderNumbers: string[] },
): Promise<number> {
  const numbers = (opts.orderNumbers ?? []).filter(Boolean);
  if (!numbers.length) return 0;
  try {
    const { data } = await admin
      .from("orders")
      .select("id")
      .eq("merchant_id", opts.merchantId)
      .in("order_number", numbers);
    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => String(r.id));
    if (!ids.length) return 0;
    return await recordOfferRedemptionsForOrders(admin, {
      merchantId: opts.merchantId,
      orderIds: ids,
    });
  } catch {
    return 0;
  }
}

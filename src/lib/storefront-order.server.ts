/**
 * Pure helpers for the storefront (customer page) order flow.
 *
 * The storefront reuses the SAME order creation path as the chat agent
 * (`create_order_with_stock` RPC → atomic stock check + deduct + insert).
 * This module only holds the small pure pieces around it: order number
 * generation and total computation, so they can be unit tested.
 */

export interface StorefrontOrderLine {
  product_name: string;
  quantity: number;
  price?: number | null;
  currency?: string | null;
  color?: string | null;
  size?: string | null;
}

export interface OrderTotals {
  subtotal: number;
  shipping: number;
  total: number;
  currency: string | null;
}

/** Same format the chat agent uses: ORD-YYYYMMDD-#####. */
export function newOrderNumber(now: Date = new Date()): string {
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, "0");
  return `ORD-${yyyy}${mm}${dd}-${rand}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Order total = sum(line price × quantity) + shipping price.
 * Missing prices count as 0 (never NaN). No other adjustments exist in the
 * project today; discounts, when introduced, belong here so chat and
 * storefront keep sharing one formula.
 */
export function computeOrderTotals(
  items: StorefrontOrderLine[],
  shippingPrice: number | null | undefined,
  currency?: string | null,
): OrderTotals {
  const subtotal = round2(
    (items ?? []).reduce((sum, it) => {
      const price = Number(it?.price ?? 0);
      const qty = Number(it?.quantity ?? 0);
      if (!Number.isFinite(price) || !Number.isFinite(qty)) return sum;
      return sum + price * Math.max(qty, 0);
    }, 0),
  );
  const ship = Number(shippingPrice ?? 0);
  const shipping = Number.isFinite(ship) && ship > 0 ? round2(ship) : 0;
  const cur =
    (currency ?? "").trim() ||
    (items ?? []).map((i) => (i.currency ?? "").trim()).find((c) => c) ||
    null;
  return { subtotal, shipping, total: round2(subtotal + shipping), currency: cur };
}

/**
 * The merchant-facing note stored on the order: the customer's own note plus
 * the shipping zone, payment method and the final total breakdown.
 */
export function buildOrderNotes(input: {
  customerNotes?: string | null;
  shippingLabel?: string | null;
  paymentMethod?: string | null;
  totals: OrderTotals;
}): string {
  const cur = input.totals.currency ?? "";
  const lines: string[] = [];
  const own = (input.customerNotes ?? "").trim();
  if (own) lines.push(own);
  lines.push("— تفاصيل الأوردر (من صفحة المتجر) —");
  if (input.shippingLabel) lines.push(`منطقة الشحن: ${input.shippingLabel}`);
  if (input.paymentMethod) lines.push(`طريقة الدفع: ${input.paymentMethod}`);
  lines.push(`إجمالي المنتجات: ${input.totals.subtotal} ${cur}`.trim());
  lines.push(`الشحن: ${input.totals.shipping} ${cur}`.trim());
  lines.push(`الإجمالي النهائي: ${input.totals.total} ${cur}`.trim());
  return lines.join("\n").slice(0, 2000);
}

/**
 * Single place that decides WHEN stock is deducted, shared by the storefront
 * checkout and the chat agent so the two paths can never drift.
 *
 *  - automatic method → stock is verified AND deducted at order creation.
 *  - manual method    → stock is verified but NOT deducted; the order is
 *    stored as `pending` and the deduction happens only when the merchant
 *    confirms the payment.
 */
export function paymentDeductionPlan(behavior: string | null | undefined): {
  deductStock: boolean;
  paymentStatus: "pending" | "confirmed";
  requiresPayment: boolean;
} {
  const manual = behavior === "manual";
  return {
    deductStock: !manual,
    paymentStatus: manual ? "pending" : "confirmed",
    requiresPayment: manual,
  };
}

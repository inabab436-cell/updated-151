/**
 * ALREADY-DEDUCTED QUANTITY RECONCILIATION.
 *
 * When a customer adds more of a product they ALREADY ordered in this
 * conversation, the agent states the new TOTAL quantity of the line (1 piece
 * ordered + 1 more = 2). The stock for the first piece was already taken out
 * of `product_variants`, so deducting the stated total again double-charges
 * the inventory and the order is wrongly rejected as out of stock.
 *
 * This module computes, per line, the quantity that still has to be deducted:
 *
 *     delta = requested_total - already_deducted_for_the_same_line
 *
 * It is a pure numeric reconciliation — no keyword matching, no intent
 * detection. Lines are paired by STABLE IDENTITY first:
 *   1. `variant_id` when both sides carry one (exact physical stock row),
 *   2. `product_id` + colour/size when both sides carry a product id,
 *   3. only as a last resort (legacy rows with no ids) the normalized
 *      product name + colour + size.
 * Call sites canonicalize both the requested line and the stored order lines
 * against the catalogue first, so ids are present on both sides in practice
 * and the name path is never the deciding factor.
 *
 * Only orders whose stock was ACTUALLY deducted count (a non-empty
 * `stock_deducted` array and a non-cancelled status). An order still waiting
 * for a manual payment has taken nothing out of stock, so nothing is
 * subtracted for it.
 */

export interface DeductedOrderRow {
  status?: string | null;
  items?: unknown;
  stock_deducted?: unknown;
}

export interface DeltaItem {
  product_id?: string | null;
  variant_id?: string | null;
  product_name?: string | null;
  color?: string | null;
  size?: string | null;
  quantity?: number | null;
  [key: string]: unknown;
}

export interface QuantityDeltaResult<T extends DeltaItem> {
  /** Items whose quantity is the amount still to be deducted (> 0 only). */
  items: T[];
  /** True when every requested line was already fully deducted before. */
  allAlreadyDeducted: boolean;
  /** Per-line report, for the agent's tool result. */
  adjustments: Array<{
    product_name: string | null;
    color: string | null;
    size: string | null;
    requested_total: number;
    already_deducted: number;
    to_deduct: number;
  }>;
}

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[يى]/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

interface LinePart {
  productId: string;
  variantId: string;
  product: string;
  color: string;
  size: string;
}

function idOf(v: unknown): string {
  const s = String(v ?? "").trim();
  return s.toLowerCase();
}

function lineParts(item: {
  product_id?: unknown;
  variant_id?: unknown;
  product_name?: unknown;
  color?: unknown;
  size?: unknown;
}): LinePart {
  return {
    productId: idOf(item.product_id),
    variantId: idOf(item.variant_id),
    product: norm(item.product_name),
    color: norm(item.color),
    size: norm(item.size),
  };
}

/**
 * A stored line and a requested line describe the SAME physical line when the
 * product matches and the requested line either repeats each attribute or
 * omits it. A missing attribute on the NEW request means "same selection, not
 * restated". A missing attribute on the STORED line cannot credit a later,
 * explicit variant: that could consume the stock delta of a genuinely new
 * colour/size. Two different non-empty values are always a contradiction.
 */
function storedAttributeMatchesRequest(stored: string, requested: string): boolean {
  return stored === requested || requested === "";
}

function linesPair(stored: LinePart, requested: LinePart): boolean {
  // 1. Same physical variant row — unambiguous, nothing else is consulted.
  if (stored.variantId && requested.variantId) {
    return stored.variantId === requested.variantId;
  }
  // 2. Same product by id; colour/size still guard different variants.
  const sameProduct =
    stored.productId && requested.productId
      ? stored.productId === requested.productId
      : // 3. One side has no id (legacy row): normalized name comparison.
        stored.product !== "" && stored.product === requested.product;
  return (
    Boolean(sameProduct) &&
    storedAttributeMatchesRequest(stored.color, requested.color) &&
    storedAttributeMatchesRequest(stored.size, requested.size)
  );
}

function qtyOf(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function hasDeductedStock(order: DeductedOrderRow): boolean {
  if (String(order.status ?? "").toLowerCase() === "cancelled") return false;
  const deducted = order.stock_deducted;
  if (!Array.isArray(deducted) || deducted.length === 0) return false;
  return deducted.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    return qtyOf((entry as Record<string, unknown>).quantity) > 0;
  });
}

/**
 * Lists, per stored line, the quantities of this conversation's orders that are
 * already reflected in the live stock.
 */
export function alreadyDeductedQuantities(
  orders: DeductedOrderRow[],
): Array<LinePart & { quantity: number }> {
  const out: Array<LinePart & { quantity: number }> = [];
  for (const order of orders ?? []) {
    if (!hasDeductedStock(order)) continue;
    const items = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const qty = qtyOf(item.quantity);
      if (qty <= 0) continue;
      out.push({ ...lineParts(item), quantity: qty });
    }
  }
  return out;
}


/**
 * Rewrites the requested items so each line carries only the quantity that
 * still has to be taken out of stock. Lines whose full quantity was already
 * deducted are dropped.
 */
export function alreadyDeductedForSelection(
  selection: { product_name?: unknown; color?: unknown; size?: unknown },
  orders: DeductedOrderRow[],
): number {
  const parts = lineParts(selection);
  if (!parts.product) return 0;
  return alreadyDeductedQuantities(orders)
    .filter((entry) => linesPair(entry, parts))
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

export function subtractAlreadyDeducted<T extends DeltaItem>(
  requestedItems: T[],
  orders: DeductedOrderRow[],
): QuantityDeltaResult<T> {
  const remaining = alreadyDeductedQuantities(orders);
  const adjustments: QuantityDeltaResult<T>["adjustments"] = [];
  const items: T[] = [];
  let sawAdjustment = false;

  for (const item of requestedItems ?? []) {
    const requested = qtyOf(item.quantity);
    const parts = lineParts(item);
    // Exact lines are consumed first, then the compatible (attribute missing on
    // one side) ones, so a precise line never steals another's credit.
    const candidates = [
      ...remaining.filter((r) => r.color === parts.color && r.size === parts.size),
      ...remaining.filter((r) => !(r.color === parts.color && r.size === parts.size)),
    ].filter((r) => linesPair(r, parts));

    let used = 0;
    for (const entry of candidates) {
      if (used >= requested) break;
      const take = Math.min(entry.quantity, requested - used);
      if (take <= 0) continue;
      entry.quantity -= take;
      used += take;
    }
    const toDeduct = requested - used;
    if (used > 0) {
      sawAdjustment = true;
      adjustments.push({
        product_name: (item.product_name as string) ?? null,
        color: (item.color as string) ?? null,
        size: (item.size as string) ?? null,
        requested_total: requested,
        already_deducted: used,
        to_deduct: toDeduct,
      });
    }
    if (toDeduct > 0) items.push({ ...item, quantity: toDeduct });
  }


  return {
    items,
    allAlreadyDeducted: sawAdjustment && items.length === 0,
    adjustments,
  };
}

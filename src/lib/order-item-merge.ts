export interface MergeableOrderItem {
  product_name?: string | null;
  color?: string | null;
  size?: string | null;
  quantity?: number | null;
  [key: string]: unknown;
}

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[يى]/g, "ي")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function sameLine(a: MergeableOrderItem, b: MergeableOrderItem): boolean {
  return (
    norm(a.product_name) === norm(b.product_name) &&
    norm(a.color) === norm(b.color) &&
    norm(a.size) === norm(b.size)
  );
}

/**
 * Applies the customer's newly requested TOTALS to an existing order basket.
 * Existing lines not mentioned in the request are retained unchanged; a new
 * variant is appended. This is deliberately separate from stock delta logic:
 * the order row stores the complete basket while stock receives only the delta.
 */
export function mergeOrderItemTotals<T extends MergeableOrderItem>(
  existingItems: T[],
  requestedTotals: T[],
): T[] {
  const merged = (existingItems ?? []).map((item) => ({ ...item }));
  for (const requested of requestedTotals ?? []) {
    const index = merged.findIndex((item) => sameLine(item, requested));
    if (index >= 0) {
      merged[index] = { ...merged[index], ...requested };
    } else {
      merged.push({ ...requested });
    }
  }
  return merged;
}

/**
 * Mandatory per-variant quantity.
 *
 * Root cause it fixes: the product forms treated quantity as optional, so
 * variants were persisted with `stock = null`. A null stock is later rendered
 * as "غير متوفر", and then silently flips to available once the merchant fills
 * the number in — producing an availability contradiction inside a single
 * conversation.
 *
 * Every colour/size row must therefore carry an explicit, finite,
 * non-negative integer quantity (0 is valid and means "out of stock").
 */
export function requireQuantity(raw: string, colorLabel: string): number {
  const text = String(raw ?? "").trim();
  if (text === "") {
    throw new Error(`أدخل الكمية للون "${colorLabel}" (اكتب 0 إذا كان غير متوفر).`);
  }
  const n = Number(text);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`الكمية للون "${colorLabel}" يجب أن تكون رقماً صحيحاً 0 أو أكبر.`);
  }
  return n;
}

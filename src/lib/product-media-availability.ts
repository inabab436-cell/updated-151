/**
 * Availability gate for the deterministic media fallbacks in the chat agent.
 *
 * Point 5 of the prompt-flow handoff: attaching product media is the agent's
 * decision (the `attach_product_media` tool). The remaining deterministic
 * fallbacks are only allowed for a product that exists in THIS turn's fresh
 * snapshot and is not sold out — i.e. at least one variant still has stock.
 *
 * Pure function: no network, no database, no Arabic keyword matching.
 */

export type MediaAvailabilityVariant = { stock?: number | null };
export type MediaAvailabilityProduct = {
  id?: string | null;
  variants?: MediaAvailabilityVariant[] | null;
};

/** A product is showable when one of its variants has quantity >= 1. */
export function isProductShowable(product: MediaAvailabilityProduct | null | undefined): boolean {
  if (!product) return false;
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (variants.length === 0) return false;
  return variants.some((v) => Number(v?.stock ?? 0) > 0);
}

/**
 * Resolve a product id against the current snapshot and return it only when
 * that product is still showable. Sold-out or unknown ids return null, so the
 * fallback simply does not fire.
 */
export function showableProductId(
  products: MediaAvailabilityProduct[] | null | undefined,
  productId: string | null | undefined,
): string | null {
  const id = String(productId ?? "").trim();
  if (!id) return null;
  const list = Array.isArray(products) ? products : [];
  const product = list.find((p) => String(p?.id ?? "") === id);
  return isProductShowable(product) ? id : null;
}

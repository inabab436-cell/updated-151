/**
 * Deterministic "what may I even offer?" gate.
 *
 * The agent used to ask "تحب تشوف موديلات تانية؟" / "عندنا ألوان تانية" and
 * then answer "مفيش" one turn later, because nothing in the context told it
 * how many REAL alternatives exist. This module derives that fact from this
 * turn's fresh snapshot only: a product counts as available when at least one
 * of its variants has stock >= 1, and a colour/size counts only when that
 * exact line has stock >= 1. Everything marked SOLD_OUT / SOLD_OUT_VARIANT
 * (i.e. stock <= 0) is treated as non-existent.
 *
 * Pure functions: no network, no database, no keyword matching.
 */

export type OptionVariant = { color?: string | null; size?: string | null; stock?: number | null };
export type OptionProduct = {
  id?: string | null;
  name?: string | null;
  variants?: OptionVariant[] | null;
};

const label = (v: unknown) => String(v ?? "").trim();
const hasStock = (v: OptionVariant | null | undefined) => Number(v?.stock ?? 0) > 0;

/** Products that have at least one variant with real stock right now. */
export function availableProducts(products: OptionProduct[] | null | undefined): OptionProduct[] {
  return (products ?? []).filter((p) => (p?.variants ?? []).some(hasStock));
}

/** In-stock colour labels of one product (deduped, snapshot order). */
export function availableColors(product: OptionProduct | null | undefined): string[] {
  const out: string[] = [];
  for (const v of product?.variants ?? []) {
    if (!hasStock(v)) continue;
    const c = label(v.color);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * In-stock size labels of one product, optionally restricted to one colour.
 * A size only counts when that exact colour+size line has stock.
 */
export function availableSizes(
  product: OptionProduct | null | undefined,
  color?: string | null,
): string[] {
  const want = label(color).toLowerCase();
  const out: string[] = [];
  for (const v of product?.variants ?? []) {
    if (!hasStock(v)) continue;
    if (want && label(v.color).toLowerCase() !== want) continue;
    const s = label(v.size);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/** Available products other than the one currently being discussed. */
export function otherAvailableProducts(
  products: OptionProduct[] | null | undefined,
  currentProductId?: string | null,
): OptionProduct[] {
  const id = label(currentProductId);
  return availableProducts(products).filter((p) => !id || label(p.id) !== id);
}

export interface SuggestableOptions {
  otherModels: string[];
  colors: string[];
  sizes: string[];
  canOfferOtherModels: boolean;
  canOfferOtherColors: boolean;
  canOfferOtherSizes: boolean;
}

/** Everything the agent is allowed to propose in THIS turn. */
export function computeSuggestableOptions(
  products: OptionProduct[] | null | undefined,
  currentProductId?: string | null,
): SuggestableOptions {
  const current =
    (products ?? []).find((p) => label(p.id) && label(p.id) === label(currentProductId)) ?? null;
  const otherModels = otherAvailableProducts(products, currentProductId)
    .map((p) => label(p.name))
    .filter(Boolean);
  const colors = current ? availableColors(current) : [];
  const sizes = current ? availableSizes(current) : [];
  return {
    otherModels,
    colors,
    sizes,
    canOfferOtherModels: otherModels.length > 0,
    canOfferOtherColors: colors.length > 1,
    canOfferOtherSizes: sizes.length > 1,
  };
}

const list = (v: string[]) => (v.length ? v.join("، ") : "NONE");

/**
 * Context block pinned with the fresh snapshot: hard facts about which
 * alternatives may be proposed, so the agent never asks about options that
 * do not exist.
 */
export function buildSuggestableOptionsBlock(
  products: OptionProduct[] | null | undefined,
  currentProductId?: string | null,
): string {
  const o = computeSuggestableOptions(products, currentProductId);
  const lines = [
    "",
    "",
    "<available_alternatives> (verified from this turn's stock; SOLD_OUT and SOLD_OUT_VARIANT lines are excluded and do not exist)",
    `OTHER_MODELS_IN_STOCK: ${list(o.otherModels)}`,
    `COLORS_IN_STOCK_FOR_CURRENT_PRODUCT: ${list(o.colors)}`,
    `SIZES_IN_STOCK_FOR_CURRENT_PRODUCT: ${list(o.sizes)}`,
    `MAY_OFFER_OTHER_MODELS: ${o.canOfferOtherModels ? "YES" : "NO"}`,
    `MAY_OFFER_OTHER_COLORS: ${o.canOfferOtherColors ? "YES" : "NO"}`,
    `MAY_OFFER_OTHER_SIZES: ${o.canOfferOtherSizes ? "YES" : "NO"}`,
    "RULE: when a MAY_OFFER_* line is NO, you must not ask, hint at, or imply that such an alternative might exist (no \"تحب تشوف موديلات تانية؟\", \"عندنا ألوان تانية\", \"فيه مقاسات تانية\"). Say plainly what exists and move forward. When it is YES, you may only name the exact items listed above.",
    "</available_alternatives>",
  ];
  return lines.join("\n");
}

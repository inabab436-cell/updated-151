/**
 * OFFER ENGINE — the only place where a discount is DECIDED.
 *
 * The agent must never reason about eligibility in natural language. It sends a
 * basket, this engine answers with numbers, and the agent reads the answer.
 *
 * Core rule enforced here (and impossible to bend by wording):
 *   For a PRODUCT-SCOPED offer, `min_order_total` is a condition on the
 *   ELIGIBLE product's own subtotal — never on the basket total. Prices of
 *   products outside the offer are NOT counted toward the minimum, and the
 *   discount is NEVER applied to them.
 *   For a STORE-WIDE offer (scope 'all'), every product is eligible, so the
 *   minimum is the basket subtotal.
 *
 * Each line receives at most ONE discount: the biggest one it qualifies for.
 *
 * Server-only. Never import from client code.
 */
import type { OfferRow } from "@/lib/offers.server";

export interface CartLine {
  product_id: string;
  /** Public unit price from the inventory snapshot. */
  unit_price: number;
  quantity: number;
  name?: string | null;
}

export interface OfferEvaluation {
  offer_id: string;
  title: string;
  scope: OfferRow["scope"];
  /** Product the offer is limited to, when scope is 'product'. */
  product_id: string | null;
  discount_type: OfferRow["discount_type"];
  discount_value: number;
  min_order_total: number | null;
  /** Subtotal of the ELIGIBLE lines only — what the minimum is compared to. */
  eligible_subtotal: number;
  /** Subtotal of every other line: informational, never counted. */
  ineligible_subtotal: number;
  applies: boolean;
  /** Machine reason, so the agent never invents one. */
  reason:
    | "applies"
    | "no_eligible_product_in_cart"
    | "eligible_subtotal_below_minimum"
    | "no_discount_value";
  /** How much more of the ELIGIBLE product is needed. 0 when it applies. */
  shortfall: number;
  discount_amount: number;
}

export interface CartQuote {
  currency: string | null;
  subtotal: number;
  discount_total: number;
  total: number;
  offers: OfferEvaluation[];
  /** Human-safe, deterministic explanation lines the agent may paraphrase. */
  notes: string[];
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

function lineTotal(l: CartLine): number {
  const price = Number(l.unit_price);
  const qty = Number(l.quantity);
  return (Number.isFinite(price) ? price : 0) * (Number.isFinite(qty) && qty > 0 ? qty : 0);
}

/** Lines an offer can legally touch. */
export function eligibleLines(offer: OfferRow, lines: CartLine[]): CartLine[] {
  if (offer.scope === "all") return lines;
  if (!offer.product_id) return [];
  return lines.filter((l) => String(l.product_id) === String(offer.product_id));
}

/** Decides a single offer against a basket. Pure and deterministic. */
export function evaluateOffer(offer: OfferRow, lines: CartLine[]): OfferEvaluation {
  const mine = eligibleLines(offer, lines);
  const eligible = round2(mine.reduce((s, l) => s + lineTotal(l), 0));
  const all = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const ineligible = round2(all - eligible);
  const min = offer.min_order_total == null ? null : Number(offer.min_order_total);

  const base: OfferEvaluation = {
    offer_id: offer.id,
    title: offer.title,
    scope: offer.scope,
    product_id: offer.product_id,
    discount_type: offer.discount_type,
    discount_value: offer.discount_value,
    min_order_total: min,
    eligible_subtotal: eligible,
    ineligible_subtotal: ineligible,
    applies: false,
    reason: "no_eligible_product_in_cart",
    shortfall: 0,
    discount_amount: 0,
  };

  if (!(offer.discount_value > 0)) return { ...base, reason: "no_discount_value" };
  if (mine.length === 0 || eligible <= 0) return base;

  if (min != null && min > 0 && eligible < min) {
    return {
      ...base,
      reason: "eligible_subtotal_below_minimum",
      shortfall: round2(min - eligible),
    };
  }

  const raw =
    offer.discount_type === "percent"
      ? (eligible * offer.discount_value) / 100
      : offer.discount_value;
  const amount = round2(Math.min(Math.max(raw, 0), eligible));

  return { ...base, applies: true, reason: "applies", shortfall: 0, discount_amount: amount };
}

/**
 * Prices a whole basket. Every line is discounted at most once, by the offer
 * that gives it the largest saving.
 */
export function quoteCart(
  offers: OfferRow[],
  lines: CartLine[],
  currency: string | null = null,
): CartQuote {
  const subtotal = round2(lines.reduce((s, l) => s + lineTotal(l), 0));
  const evaluations = offers.map((o) => evaluateOffer(o, lines));

  // Resolve overlaps: a line keeps only the best applying offer.
  const applying = evaluations
    .filter((e) => e.applies)
    .sort((a, b) => b.discount_amount - a.discount_amount);
  const claimed = new Set<string>();
  let discountTotal = 0;
  for (const e of applying) {
    const offer = offers.find((o) => o.id === e.offer_id)!;
    const mine = eligibleLines(offer, lines);
    if (mine.some((l) => claimed.has(String(l.product_id)))) {
      e.applies = false;
      e.discount_amount = 0;
      continue;
    }
    for (const l of mine) claimed.add(String(l.product_id));
    discountTotal += e.discount_amount;
  }
  discountTotal = round2(discountTotal);

  const notes: string[] = [];
  for (const e of evaluations) {
    if (e.applies) {
      notes.push(
        `«${e.title}»: مطبّق على ${e.scope === "all" ? "كل المنتجات" : "المنتج المشمول فقط"} — الخصم ${e.discount_amount}${currency ? " " + currency : ""}.`,
      );
    } else if (e.reason === "eligible_subtotal_below_minimum") {
      notes.push(
        `«${e.title}»: غير مطبّق. الحد الأدنى ${e.min_order_total}${currency ? " " + currency : ""} محسوب على ${e.scope === "all" ? "إجمالي الطلب" : "قيمة المنتج المشمول بالعرض وحده"} = ${e.eligible_subtotal}. الناقص ${e.shortfall}. أسعار المنتجات الأخرى (${e.ineligible_subtotal}) لا تُحتسب في الحد الأدنى.`,
      );
    } else if (e.reason === "no_eligible_product_in_cart") {
      notes.push(`«${e.title}»: غير مطبّق — لا يوجد في الطلب أي منتج مشمول بالعرض.`);
    }
  }

  return {
    currency,
    subtotal,
    discount_total: discountTotal,
    total: round2(subtotal - discountTotal),
    offers: evaluations,
    notes,
  };
}

import { describe, it, expect } from "vitest";
import { mapOfferRow, buildOffersBlock } from "@/lib/offers.server";
import { evaluateOffer, quoteCart } from "@/lib/offer-engine.server";

const offer = (over: Record<string, unknown> = {}) =>
  mapOfferRow({
    id: "o1",
    title: "خصم الفساتين",
    scope: "product",
    product_id: "dress",
    discount_type: "percent",
    discount_value: 60,
    min_order_total: 1000,
    starts_at: new Date(Date.now() - 3600_000).toISOString(),
    is_active: true,
    ...over,
  });

const dress = { product_id: "dress", unit_price: 120, quantity: 1, name: "فستان بنات" };
const sweat = { product_id: "sweat", unit_price: 850, quantity: 1, name: "سويت شيرت" };

describe("product-scoped minimum is a product condition, not a cart total", () => {
  it("does not apply when the eligible product alone is below the minimum", () => {
    const e = evaluateOffer(offer(), [dress]);
    expect(e.applies).toBe(false);
    expect(e.reason).toBe("eligible_subtotal_below_minimum");
    expect(e.shortfall).toBe(880);
  });

  it("adding a non-eligible product never reaches the minimum", () => {
    const e = evaluateOffer(offer(), [dress, sweat]);
    expect(e.applies).toBe(false);
    expect(e.eligible_subtotal).toBe(120);
    expect(e.ineligible_subtotal).toBe(850);
    const q = quoteCart([offer()], [dress, sweat], "جنيه");
    expect(q.subtotal).toBe(970);
    expect(q.discount_total).toBe(0);
    expect(q.total).toBe(970);
  });

  it("even a cart total above the minimum stays ineligible", () => {
    const q = quoteCart([offer()], [dress, { ...sweat, unit_price: 900 }], null);
    expect(q.subtotal).toBe(1020);
    expect(q.discount_total).toBe(0);
  });

  it("applies once the eligible product itself reaches the minimum", () => {
    const e = evaluateOffer(offer(), [{ ...dress, unit_price: 1200 }]);
    expect(e.applies).toBe(true);
    expect(e.discount_amount).toBe(720);
  });

  it("discount never touches non-eligible lines", () => {
    const q = quoteCart([offer()], [{ ...dress, unit_price: 1000 }, sweat], null);
    expect(q.subtotal).toBe(1850);
    expect(q.discount_total).toBe(600);
    expect(q.total).toBe(1250);
  });
});

describe("store-wide offers", () => {
  const all = offer({ id: "o2", scope: "all", product_id: null, discount_value: 10 });
  it("uses the cart total for the minimum", () => {
    expect(evaluateOffer(all, [dress, sweat]).applies).toBe(false); // 970 < 1000
    const e = evaluateOffer(all, [dress, { ...sweat, unit_price: 900 }]);
    expect(e.applies).toBe(true);
    expect(e.discount_amount).toBe(102);
  });
});

describe("edge cases", () => {
  it("no eligible product in the cart", () => {
    expect(evaluateOffer(offer(), [sweat]).reason).toBe("no_eligible_product_in_cart");
  });
  it("fixed-amount discount is capped by the eligible subtotal", () => {
    const o = offer({ discount_type: "amount", discount_value: 5000, min_order_total: null });
    expect(evaluateOffer(o, [dress]).discount_amount).toBe(120);
  });
  it("a line is discounted by only one offer", () => {
    const a = offer({ id: "a", min_order_total: null, discount_value: 20 });
    const b = offer({ id: "b", min_order_total: null, discount_value: 50 });
    const q = quoteCart([a, b], [{ ...dress, unit_price: 100 }], null);
    expect(q.discount_total).toBe(50);
  });
});

describe("prompt block is explicit, not marketing copy", () => {
  const block = buildOffersBlock(
    { live: [offer()], past: [] },
    new Map([["dress", "فستان بنات"]]),
    "جنيه",
  );
  it("states every decisive field", () => {
    expect(block).toContain("الخصم: خصم 60%");
    expect(block).toContain("الحد الأدنى: 1000 جنيه");
    expect(block).toContain("النطاق: فستان بنات فقط");
    expect(block).toContain("هل المنتجات الأخرى تُحتسب في الحد الأدنى؟ لا");
    expect(block).toContain("هل الخصم يطبق على المنتجات الأخرى؟ لا");
  });
  it("carries the mandatory rule and the engine handoff", () => {
    expect(block).toContain("ممنوع جمع أسعار منتجات غير مؤهلة");
    expect(block).toContain("calculate_offer_price");
  });
  it("store-wide offers say yes to both questions", () => {
    const b = buildOffersBlock(
      { live: [offer({ scope: "all", product_id: null })], past: [] },
      new Map(),
      "جنيه",
    );
    expect(b).toContain("هل الخصم يطبق على المنتجات الأخرى؟ نعم");
  });
});

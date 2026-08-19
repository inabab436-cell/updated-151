import { describe, it, expect } from "vitest";
import { priceOrderItems } from "@/lib/order-pricing.server";
import { offerAppliesToOrder } from "@/lib/offer-redemptions.server";

const dress = {
  id: "p-dress",
  name: "فستان بنات",
  price: 120,
  currency: "جنيه",
  variants: [{ color: "وردي", size: "S", price: 120 }],
};
const sweat = {
  id: "p-sweat",
  name: "سويت شيرت",
  price: 850,
  currency: "جنيه",
  variants: [],
};

const offer = (over: any = {}) => ({
  id: "o1",
  user_id: "u1",
  title: "عرض الفستان",
  scope: "product",
  product_id: "p-dress",
  discount_type: "percent",
  discount_value: 60,
  min_order_total: 1000,
  is_active: true,
  starts_at: null,
  ends_at: null,
  ...over,
}) as any;

const item = (name: string, qty = 1, color: string | null = null, size: string | null = null) => ({
  product_name: name,
  color,
  size,
  quantity: qty,
});

describe("order pricing", () => {
  it("prices every line and stores the product id", () => {
    const r = priceOrderItems({
      products: [dress, sweat],
      offers: [],
      items: [item("فستان بنات", 1, "وردي", "S"), item("سويت شيرت")],
    });
    expect(r.items[0].unit_price).toBe(120);
    expect(r.items[0].product_id).toBe("p-dress");
    expect(r.subtotal).toBe(970);
    expect(r.total).toBe(970);
  });

  it("does not reach a product-scoped minimum with other products", () => {
    const r = priceOrderItems({
      products: [dress, sweat],
      offers: [offer()],
      items: [item("فستان بنات"), item("سويت شيرت")],
    });
    expect(r.discount_total).toBe(0);
    expect(r.applied_offers).toHaveLength(0);
  });

  it("applies the discount only on the eligible product subtotal", () => {
    const r = priceOrderItems({
      products: [dress, sweat],
      offers: [offer()],
      items: [item("فستان بنات", 10), item("سويت شيرت")],
    });
    expect(r.subtotal).toBe(2050);
    expect(r.discount_total).toBe(720); // 60% of 1200 only
    expect(r.total).toBe(1330);
    expect(r.applied_offers[0].offer_id).toBe("o1");
  });
});

describe("redemption eligibility on a priced order", () => {
  const priced = (items: any[]) => ({
    id: "ord1",
    items,
    total_price: items.reduce((s, i) => s + i.unit_price * i.quantity, 0),
  });

  it("records nothing when the eligible product is below the minimum", () => {
    const order = priced([
      { product_id: "p-dress", unit_price: 120, quantity: 1, product_name: "فستان بنات" },
      { product_id: "p-sweat", unit_price: 850, quantity: 1, product_name: "سويت شيرت" },
    ]);
    expect(offerAppliesToOrder(offer(), "فستان بنات", order)).toBe(false);
  });

  it("records the beneficiary when the eligible product meets the minimum", () => {
    const order = priced([
      { product_id: "p-dress", unit_price: 120, quantity: 10, product_name: "فستان بنات" },
    ]);
    expect(offerAppliesToOrder(offer(), "فستان بنات", order)).toBe(true);
  });
});

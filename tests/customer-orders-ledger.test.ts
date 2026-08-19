import { describe, expect, it } from "vitest";
import { buildCustomerOrdersLedger, stampWithAge } from "@/lib/customer-orders-ledger";

const NOW = "2026-08-13T03:00:00.000Z";

const zones = [
  { country: "مصر", region: "القاهرة", price: 60, currency: "EGP", eta: "2-3 أيام" },
  { country: "مصر", region: "الاسكندرية", price: 75, currency: "EGP", eta: "4 أيام" },
];

const orderA = {
  order_number: "ORD-20260810-00001",
  status: "shipped",
  payment_status: "confirmed",
  payment_method: "تحويل بنكي",
  payment_confirmed_at: "2026-08-10T10:00:00.000Z",
  created_at: "2026-08-10T09:00:00.000Z",
  prepared_at: "2026-08-11T09:00:00.000Z",
  shipped_at: "2026-08-12T03:00:00.000Z",
  delivered_at: null,
  subtotal_price: 500,
  discount_amount: 50,
  shipping_cost: 60,
  total_price: 510,
  customer_address: "القاهرة - مدينة نصر",
  items: [{ product_name: "تيشيرت", color: "أسود", size: "L", quantity: 2, price: 250 }],
};

const orderB = {
  order_number: "ORD-20260812-00002",
  status: "new",
  payment_status: "pending",
  payment_method: "انستاباي",
  created_at: "2026-08-12T09:00:00.000Z",
  customer_address: "الاسكندرية - سموحة",
  total_price: 275,
  items: [{ name: "بنطلون", color: "أزرق", size: "M", quantity: 1, price: 200 }],
};

describe("customer orders ledger", () => {
  it("returns nothing when the customer has no orders", () => {
    expect(buildCustomerOrdersLedger([], { zones, nowIso: NOW })).toBe("");
  });

  it("includes product, shipping, payment, status and amount details", () => {
    const out = buildCustomerOrdersLedger([orderA], { zones, nowIso: NOW });
    expect(out).toContain("ORD-20260810-00001");
    expect(out).toContain("تيشيرت");
    expect(out).toContain("color: أسود");
    expect(out).toContain("size: L");
    expect(out).toContain("quantity: 2");
    expect(out).toContain("2-3 أيام");
    expect(out).toContain("shipping cost: 60");
    expect(out).toContain("CONFIRMED");
    expect(out).toContain("discount / offer applied: -50");
    expect(out).toContain("FINAL TOTAL: 510");
    expect(out).toContain("shipped at:");
    expect(out).toContain(NOW);
  });

  it("keeps multiple orders separated and numbered", () => {
    const out = buildCustomerOrdersLedger([orderA, orderB], { zones, nowIso: NOW });
    expect(out).toContain("This customer has 2 orders in total.");
    expect(out).toContain("ORDER 1 — Order Number: ORD-20260810-00001");
    expect(out).toContain("ORDER 2 — Order Number: ORD-20260812-00002");
    expect(out).toContain("PENDING (not confirmed yet)");
    expect(out).toContain("4 أيام");
  });

  it("carries the privacy rule about other customers", () => {
    const out = buildCustomerOrdersLedger([orderA], { zones, nowIso: NOW });
    expect(out).toContain("SECURITY:");
    expect(out.toLowerCase()).toContain("no access to any other customer");
  });

  it("computes the age of a timestamp", () => {
    expect(stampWithAge("2026-08-12T03:00:00.000Z", NOW)).toContain("1 day ago");
    expect(stampWithAge(null, NOW)).toBeNull();
  });
});

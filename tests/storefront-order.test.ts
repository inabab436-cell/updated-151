import { describe, expect, it } from "vitest";

import {
  buildOrderNotes,
  computeOrderTotals,
  newOrderNumber,
  paymentDeductionPlan,
} from "@/lib/storefront-order.server";

describe("newOrderNumber", () => {
  it("matches the chat agent format ORD-YYYYMMDD-#####", () => {
    const n = newOrderNumber(new Date(Date.UTC(2026, 7, 2)));
    expect(n).toMatch(/^ORD-20260802-\d{5}$/);
  });
});

describe("computeOrderTotals", () => {
  it("sums price × quantity and adds shipping", () => {
    const t = computeOrderTotals(
      [
        { product_name: "A", quantity: 2, price: 100, currency: "EGP" },
        { product_name: "B", quantity: 1, price: 49.5, currency: "EGP" },
      ],
      30,
    );
    expect(t.subtotal).toBe(249.5);
    expect(t.shipping).toBe(30);
    expect(t.total).toBe(279.5);
    expect(t.currency).toBe("EGP");
  });

  it("treats missing prices and shipping as zero", () => {
    const t = computeOrderTotals([{ product_name: "A", quantity: 3, price: null }], null);
    expect(t).toMatchObject({ subtotal: 0, shipping: 0, total: 0 });
  });

  it("ignores negative shipping and negative quantities", () => {
    const t = computeOrderTotals(
      [{ product_name: "A", quantity: -2, price: 100 }],
      -50,
    );
    expect(t.subtotal).toBe(0);
    expect(t.shipping).toBe(0);
    expect(t.total).toBe(0);
  });

  it("prefers the explicit currency over item currency", () => {
    const t = computeOrderTotals(
      [{ product_name: "A", quantity: 1, price: 10, currency: "USD" }],
      5,
      "EGP",
    );
    expect(t.currency).toBe("EGP");
  });
});

describe("buildOrderNotes", () => {
  it("keeps the customer note and appends shipping, payment and totals", () => {
    const totals = computeOrderTotals(
      [{ product_name: "A", quantity: 1, price: 100, currency: "EGP" }],
      30,
    );
    const notes = buildOrderNotes({
      customerNotes: "من فضلك اتصل قبل التوصيل",
      shippingLabel: "مصر / القاهرة",
      paymentMethod: "فودافون كاش",
      totals,
    });
    expect(notes).toContain("من فضلك اتصل قبل التوصيل");
    expect(notes).toContain("منطقة الشحن: مصر / القاهرة");
    expect(notes).toContain("طريقة الدفع: فودافون كاش");
    expect(notes).toContain("الإجمالي النهائي: 130 EGP");
  });

  it("works without a customer note or shipping zone", () => {
    const notes = buildOrderNotes({
      totals: computeOrderTotals([], 0),
    });
    expect(notes).toContain("الإجمالي النهائي: 0");
    expect(notes).not.toContain("منطقة الشحن");
  });
});

describe("paymentDeductionPlan", () => {
  it("manual payment never deducts stock at creation", () => {
    const plan = paymentDeductionPlan("manual");
    expect(plan.deductStock).toBe(false);
    expect(plan.paymentStatus).toBe("pending");
    expect(plan.requiresPayment).toBe(true);
  });

  it("automatic payment deducts stock at creation", () => {
    const plan = paymentDeductionPlan("auto");
    expect(plan.deductStock).toBe(true);
    expect(plan.paymentStatus).toBe("confirmed");
    expect(plan.requiresPayment).toBe(false);
  });

  it("no configured method behaves like automatic", () => {
    expect(paymentDeductionPlan(null)).toEqual({
      deductStock: true,
      paymentStatus: "confirmed",
      requiresPayment: false,
    });
  });
});

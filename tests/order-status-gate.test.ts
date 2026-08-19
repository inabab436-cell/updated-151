import { describe, expect, it } from "vitest";

import { PAYMENT_REQUIRED_MESSAGE, canStartFulfillment, isOrderPaid } from "@/lib/order-status-gate";

describe("order fulfilment payment gate", () => {
  it("blocks unpaid orders", () => {
    expect(canStartFulfillment("pending")).toBe(false);
    expect(isOrderPaid("pending")).toBe(false);
  });

  it("allows confirmed / legacy orders", () => {
    expect(canStartFulfillment("confirmed")).toBe(true);
    expect(canStartFulfillment(null)).toBe(true);
    expect(canStartFulfillment(undefined)).toBe(true);
  });

  it("exposes the exact user-facing message", () => {
    expect(PAYMENT_REQUIRED_MESSAGE).toBe(
      "لا يمكن بدء تنفيذ الطلب قبل تأكيد الدفع، لضمان عدم تجهيز أو شحن طلب غير مدفوع.",
    );
  });
});

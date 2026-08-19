import { describe, expect, it } from "vitest";

import {
  formatShortages,
  summarizeConfirmations,
  type ConfirmationOutcome,
} from "@/lib/order-payment.server";

describe("summarizeConfirmations", () => {
  it("no pending orders → success with nothing confirmed", () => {
    expect(summarizeConfirmations([])).toMatchObject({
      ok: true,
      confirmed: 0,
      alreadyConfirmed: 0,
    });
  });

  it("counts freshly confirmed and already confirmed orders", () => {
    const results: ConfirmationOutcome[] = [
      { orderNumber: "A", ok: true },
      { orderNumber: "B", ok: true, alreadyConfirmed: true },
    ];
    expect(summarizeConfirmations(results)).toMatchObject({
      ok: true,
      confirmed: 1,
      alreadyConfirmed: 1,
    });
  });

  it("a single shortage fails the whole confirmation and keeps the shortages", () => {
    const s = summarizeConfirmations([
      { orderNumber: "A", ok: true },
      {
        orderNumber: "B",
        ok: false,
        error: "insufficient_stock",
        shortages: [{ product_name: "قميص", requested: 3, available: 1 }],
      },
    ]);
    expect(s.ok).toBe(false);
    expect(s.error).toBe("insufficient_stock");
    expect(s.orderNumber).toBe("B");
    expect(s.shortages).toHaveLength(1);
    expect(s.confirmed).toBe(0);
  });

  it("keeps non-stock errors as they are", () => {
    const s = summarizeConfirmations([{ orderNumber: "A", ok: false, error: "cancelled" }]);
    expect(s).toMatchObject({ ok: false, error: "cancelled", shortages: [] });
  });
});

describe("formatShortages", () => {
  it("renders product, color, size and quantities", () => {
    expect(
      formatShortages([
        { product_name: "قميص", color: "أزرق", size: "L", requested: 2, available: 0 },
      ]),
    ).toBe("قميص - أزرق - L: المطلوب 2 / المتاح 0");
  });
});

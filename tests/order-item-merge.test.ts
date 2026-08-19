import { describe, expect, it } from "vitest";
import { mergeOrderItemTotals } from "@/lib/order-item-merge";

describe("mergeOrderItemTotals", () => {
  it("raises the total on the existing line without losing other products or line settings", () => {
    const existing = [
      { product_name: "هودي سادة", color: "أسود", size: "S", quantity: 1, unit_price: 200 },
      { product_name: "بنطلون", color: "رمادي", size: "M", quantity: 1, unit_price: 300 },
    ];
    const merged = mergeOrderItemTotals(existing, [
      { product_name: "هودي سادة", color: "اسود", size: "S", quantity: 2 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({ quantity: 2, unit_price: 200 });
    expect(merged[1]).toEqual(existing[1]);
  });

  it("appends a genuinely new product variant", () => {
    const merged = mergeOrderItemTotals(
      [{ product_name: "هودي", color: "أسود", size: "S", quantity: 1 }],
      [{ product_name: "هودي", color: "أسود", size: "L", quantity: 1 }],
    );
    expect(merged).toHaveLength(2);
  });
});

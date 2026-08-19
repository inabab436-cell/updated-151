import { describe, expect, it } from "vitest";
import { canonicalizeOrderItems, normKey } from "@/lib/order-catalog-match";

const products = [
  {
    id: "p1",
    name: "IKE BRAS هودي مخطط",
    variants: [
      { color: "ابيض", size: "L", stock: 3 },
      { color: "اسود", size: "M", stock: 1 },
    ],
  },
  { id: "p2", name: "فستان أطفال رسمي", variants: [{ color: "بيج", size: "S", stock: 2 }] },
];

describe("canonicalizeOrderItems", () => {
  it("rewrites a partial product name to the exact catalogue name", () => {
    const [line] = canonicalizeOrderItems(products, [
      { product_name: "هودي مخطط", color: "أبيض", size: "l", quantity: 1 },
    ]);
    expect(line.product_name).toBe("IKE BRAS هودي مخطط");
    expect(line.color).toBe("ابيض");
    expect(line.size).toBe("L");
    expect(line.product_id).toBe("p1");
  });

  it("prefers the resolved product_id over the written name", () => {
    const [line] = canonicalizeOrderItems(products, [
      { product_id: "p2", product_name: "فستان اطفال", quantity: 2 },
    ]);
    expect(line.product_name).toBe("فستان أطفال رسمي");
  });

  it("leaves unmatched lines untouched", () => {
    const [line] = canonicalizeOrderItems(products, [
      { product_name: "حاجة تانية خالص", color: "أحمر", quantity: 1 },
    ]);
    expect(line.product_name).toBe("حاجة تانية خالص");
    expect(line.color).toBe("أحمر");
  });

  it("normalizes Arabic variants of the same word", () => {
    expect(normKey("أبيض")).toBe(normKey("ابيض"));
  });
});

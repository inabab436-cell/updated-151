import { describe, it, expect } from "vitest";
import { buildShippingLookupBlock } from "@/lib/shipping-lookup.server";

const base = [
  { country: "مصر", region: "القاهرة", price: 60, currency: "ج.م", eta: "2-3 أيام" },
  { country: "مصر", region: "الجيزة", price: 65, currency: "ج.م", eta: "2-3 أيام" },
];

describe("shipping lookup", () => {
  it("answers a newly added governorate straight from the table", () => {
    const zones = [...base, { country: "مصر", region: "أسوان", price: 95, currency: "ج.م", eta: "4-5 أيام" }];
    const b = buildShippingLookupBlock({ zones, texts: ["الشحن لأسوان بكام؟"] });
    expect(b).toContain("95");
    expect(b).toContain("4-5 أيام");
    expect(b).toContain("موجود في الجدول");
  });
  it("does not defer for a governorate absent from the table", () => {
    const b = buildShippingLookupBlock({ zones: base, texts: ["انا من اسوان"] });
    expect(b).toContain("مش موجودة في جدول الشحن");
  });
  it("matches a city alias to its governorate row", () => {
    const b = buildShippingLookupBlock({ zones: base, texts: ["انا في المعادي"] });
    expect(b).toContain("60");
  });
});

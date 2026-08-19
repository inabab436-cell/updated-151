import { describe, expect, it } from "vitest";
import {
  buildLiveAvailabilityBlock,
  checkSelectionAvailability,
} from "@/lib/order-availability";

const selection = { product_name: "قميص", color: "أزرق", size: "M", quantity: 1 };

function verdict(stock: number) {
  return checkSelectionAvailability(
    [{ id: "p1", name: "قميص", variants: [{ color: "أزرق", size: "M", stock }] }],
    selection,
  );
}

describe("live availability verdict", () => {
  it("changes deterministically whenever canonical stock changes in one conversation", () => {
    const soldOut = buildLiveAvailabilityBlock(verdict(0));
    const available = buildLiveAvailabilityBlock(verdict(4));
    const soldOutAgain = buildLiveAvailabilityBlock(verdict(0));

    expect(soldOut).toContain("status: product_sold_out");
    expect(available).toContain("status: ok");
    expect(available).toContain("available_quantity: 4");
    expect(soldOutAgain).toBe(soldOut);
  });

  it("never classifies a fully sold-out product as available when no variant was selected", () => {
    const result = checkSelectionAvailability(
      [
        {
          id: "p1",
          name: "قميص",
          variants: [
            { color: "أزرق", size: "M", stock: 0 },
            { color: "أسود", size: "L", stock: 0 },
          ],
        },
      ],
      { product_name: "قميص" },
    );

    expect(result.status).toBe("product_sold_out");
    expect(result.available).toBe(0);
    expect(buildLiveAvailabilityBlock(result)).toContain("status: product_sold_out");
  });
});
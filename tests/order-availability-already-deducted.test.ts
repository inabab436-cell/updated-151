import { describe, expect, it } from "vitest";
import {
  buildExistingOrderAdditionCapacityBlock,
  buildLiveAvailabilityBlock,
  checkSelectionAvailability,
} from "@/lib/order-availability";
import { alreadyDeductedForSelection } from "@/lib/order-quantity-delta";

const products = [
  { id: "p1", name: "كوب سيراميك", variants: [{ color: "أزرق", size: "M", stock: 1 }] },
];
const selection = { product_name: "كوب سيراميك", color: "أزرق", size: "M", quantity: 2 };
const orders = [
  {
    status: "new",
    items: [{ product_name: "كوب سيراميك", color: "أزرق", size: "M", quantity: 1 }],
    stock_deducted: [{ variant_id: "v1", quantity: 1 }],
  },
];

describe("availability with already-deducted credit", () => {
  it("credits the already deducted piece from this conversation", () => {
    expect(alreadyDeductedForSelection(selection, orders as any)).toBe(1);
  });

  it("accepts total 2 when 1 is already deducted and 1 remains in stock", () => {
    const res = checkSelectionAvailability(products as any, selection, { alreadyDeducted: 1 });
    expect(res.status).toBe("ok");
    expect(res.additionalNeeded).toBe(1);
    expect(buildLiveAvailabilityBlock(res)).toContain("additional_quantity_needed: 1");
  });

  it("still refuses when even the difference does not fit", () => {
    const res = checkSelectionAvailability(products as any, { ...selection, quantity: 4 }, { alreadyDeducted: 1 });
    expect(res.status).toBe("insufficient_quantity");
  });

  it("unchanged behaviour without credit", () => {
    expect(checkSelectionAvailability(products as any, selection).status).toBe("insufficient_quantity");
  });

  it("states the exact extra capacity and valid new total for an existing order", () => {
    const block = buildExistingOrderAdditionCapacityBlock(products as any, orders as any);
    expect(block).toContain("quantity_already_in_order: 1");
    expect(block).toContain("extra_pieces_available_now: 1");
    expect(block).toContain("maximum_valid_new_total: 2");
    expect(block).toContain("adding any quantity from 1 through 1 is AVAILABLE");
  });
});

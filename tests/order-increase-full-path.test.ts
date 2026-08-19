/**
 * FULL PATH: increasing the quantity of an existing order.
 *
 * Reproduces the real create_order pipeline order of operations:
 *   agent wording → canonicalizeOrderItems → subtractAlreadyDeducted → RPC
 * The stored order rows hold CANONICAL catalogue strings, so the delta can
 * only pair correctly if canonicalization happens BEFORE the reconciliation.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { canonicalizeOrderItems } from "@/lib/order-catalog-match";
import { subtractAlreadyDeducted } from "@/lib/order-quantity-delta";

const products = [
  {
    id: "p1",
    name: "IKE BRAS هودي مخطط",
    variants: [{ color: "ابيض", size: "M", stock: 2 }],
  },
];

/** What the agent writes (its own wording, not the catalogue strings). */
const agentLine = (quantity: number) => ({
  product_name: "هودي مخطط",
  color: "أبيض",
  size: "m",
  quantity,
});

/** What create_order actually stores after canonicalization. */
function storedOrder(quantity: number) {
  const items = canonicalizeOrderItems(products as any, [agentLine(quantity)]);
  return {
    status: "new",
    items,
    stock_deducted: [{ variant_id: "v1", quantity }],
  };
}

function pipeline(requestedTotal: number, existing: ReturnType<typeof storedOrder>[]) {
  const cleaned = canonicalizeOrderItems(products as any, [agentLine(requestedTotal)]);
  return subtractAlreadyDeducted(cleaned as any, existing as any);
}

describe("increase quantity on an existing order — full path", () => {
  it("deducts only the difference (stock 2, ordered 1, raised to 2 → deduct 1)", () => {
    const res = pipeline(2, [storedOrder(1)]);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.quantity).toBe(1);
    expect(res.adjustments[0]).toMatchObject({
      requested_total: 2,
      already_deducted: 1,
      to_deduct: 1,
    });
  });

  it("re-stating the same total deducts nothing at all", () => {
    const res = pipeline(1, [storedOrder(1)]);
    expect(res.items).toHaveLength(0);
    expect(res.allAlreadyDeducted).toBe(true);
  });

  it("canonicalization runs before the already-deducted reconciliation", () => {
    const src = readFileSync("src/routes/api/chat-ai.ts", "utf8");
    const canon = src.indexOf("canonicalizeOrderItems");
    const delta = src.indexOf("subtractAlreadyDeducted");
    expect(canon).toBeGreaterThan(-1);
    expect(delta).toBeGreaterThan(-1);
    expect(canon).toBeLessThan(delta);
  });

  it("canonicalizes the pre-check selection before crediting existing stock", () => {
    const rawSelection = agentLine(2);
    const canonicalSelection = canonicalizeOrderItems(products as any, [rawSelection])[0];
    const existing = [storedOrder(1)];

    expect(canonicalSelection?.product_name).toBe("IKE BRAS هودي مخطط");
    if (!canonicalSelection) throw new Error("Expected canonical selection");
    expect(subtractAlreadyDeducted([canonicalSelection] as any, existing as any).items[0]?.quantity).toBe(1);
  });

  it("updates the existing order atomically instead of inserting a second order", () => {
    const src = readFileSync("src/routes/api/chat-ai.ts", "utf8");
    expect(src).toContain('supabase.rpc("update_order_with_stock"');
    expect(src).toContain("mergeOrderItemTotals(oldItems, requestedItemTotals)");
    expect(src).toContain("latestConversationOrder && !deductionPlan.requiresPayment");
  });
});

describe("increase quantity when the agent restates the line loosely", () => {
  /** Second call omits the colour/size it already stated earlier. */
  const looseLine = (quantity: number) => ({
    product_name: "هودي مخطط",
    color: null as string | null,
    size: null as string | null,
    quantity,
  });

  it("still credits the already-deducted piece (deduct 1, not 2)", () => {
    const cleaned = canonicalizeOrderItems(products as any, [looseLine(2)]);
    const res = subtractAlreadyDeducted(cleaned as any, [storedOrder(1)] as any);
    expect(res.items).toHaveLength(1);
    expect(res.items[0]!.quantity).toBe(1);
    expect(res.adjustments[0]).toMatchObject({ already_deducted: 1, to_deduct: 1 });
  });

  it("stored line without colour/size does not steal credit from a later precise variant", () => {
    const storedLoose = {
      status: "new",
      items: canonicalizeOrderItems(products as any, [looseLine(1)]),
      stock_deducted: [{ variant_id: "v1", quantity: 1 }],
    };
    const cleaned = canonicalizeOrderItems(products as any, [agentLine(2)]);
    const res = subtractAlreadyDeducted(cleaned as any, [storedLoose] as any);
    expect(res.items[0]!.quantity).toBe(2);
    expect(res.adjustments).toHaveLength(0);
  });

  it("a genuinely different colour gets NO credit", () => {
    const other = { product_name: "هودي مخطط", color: "اسود", size: "M", quantity: 2 };
    const res = subtractAlreadyDeducted([other] as any, [storedOrder(1)] as any);
    expect(res.items[0]!.quantity).toBe(2);
    expect(res.adjustments).toHaveLength(0);
  });
});

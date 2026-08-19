import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  emptyOrderState,
  parseOrderState,
  mergeOrderState,
  promoteOrderState,
  commitOrderState,
  selectionFromOrderState,
  valueOf,
  stageOf,
} from "@/lib/order-state";
import { checkSelectionAvailability } from "@/lib/order-availability";

const products = [
  {
    id: "p1",
    name: "تيشيرت",
    variants: [
      { color: "أسود", size: "L", stock: 3 },
      { color: "أبيض", size: "M", stock: 0 },
    ],
  },
] as any;

describe("structured order state", () => {
  it("never loses a value when a later run extracts nothing", () => {
    let s = mergeOrderState(emptyOrderState(), { product_name: "تيشيرت", size: "L" });
    s = mergeOrderState(s, { product_name: null, size: undefined, quantity: "2" });
    expect(valueOf(s, "product_name")).toBe("تيشيرت");
    expect(valueOf(s, "size")).toBe("L");
    expect(valueOf(s, "quantity")).toBe("2");
  });

  it("distinguishes extracted / verified / confirmed / committed", () => {
    let s = mergeOrderState(emptyOrderState(), { phone: "01000000000" });
    expect(stageOf(s, "phone")).toBe("extracted");
    s = promoteOrderState(s, ["phone"], "verified");
    expect(stageOf(s, "phone")).toBe("verified");
    s = promoteOrderState(s, ["phone"], "confirmed");
    // A re-extraction of the same value must not downgrade the stage.
    s = mergeOrderState(s, { phone: "01000000000" });
    expect(stageOf(s, "phone")).toBe("confirmed");
  });

  it("does not let a new run overwrite a confirmed field from the history", () => {
    let s = mergeOrderState(emptyOrderState(), { address: "المعادي، القاهرة" });
    s = promoteOrderState(s, ["address"], "confirmed");
    s = mergeOrderState(s, { address: "القاهرة" });
    expect(valueOf(s, "address")).toBe("المعادي، القاهرة");
    s = mergeOrderState(s, { address: "طنطا" }, { allowChangeConfirmed: true });
    expect(valueOf(s, "address")).toBe("طنطا");
  });

  it("freezes everything once the order is created", () => {
    let s = mergeOrderState(emptyOrderState(), { product_name: "تيشيرت", quantity: "2" });
    s = commitOrderState(s, {
      orderNumber: "ORD-1",
      values: { product_name: "تيشيرت", quantity: "2", color: "أسود" },
    });
    expect(s.order_placed).toBe(true);
    expect(s.order_number).toBe("ORD-1");
    s = mergeOrderState(s, { product_name: "بنطلون", quantity: "9" });
    expect(valueOf(s, "product_name")).toBe("تيشيرت");
    expect(stageOf(s, "quantity")).toBe("committed");
  });

  it("survives a round-trip through the database column", () => {
    const s = mergeOrderState(emptyOrderState(), { color: "أسود" });
    const back = parseOrderState(JSON.parse(JSON.stringify(s)));
    expect(valueOf(back, "color")).toBe("أسود");
    expect(selectionFromOrderState(back).color).toBe("أسود");
  });
});

describe("pre-order availability", () => {
  it("verifies an available selection", () => {
    const r = checkSelectionAvailability(products, {
      product_name: "تيشيرت",
      color: "أسود",
      size: "L",
      quantity: 2,
    });
    expect(r.status).toBe("ok");
    expect(r.verified).toContain("product_name");
    expect(r.verified).toContain("quantity");
  });

  it("catches an out-of-stock variant and a quantity shortage before ordering", () => {
    expect(
      checkSelectionAvailability(products, { product_name: "تيشيرت", color: "أخضر" }).status,
    ).toBe("color_unavailable");
    expect(
      checkSelectionAvailability(products, {
        product_name: "تيشيرت",
        color: "أسود",
        size: "L",
        quantity: 10,
      }).status,
    ).toBe("insufficient_quantity");
    expect(checkSelectionAvailability(products, { product_name: "حذاء" }).status).toBe(
      "product_not_found",
    );
  });
});

describe("chat route wiring", () => {
  const src = readFileSync(resolve(process.cwd(), "src/routes/api/chat-ai.ts"), "utf8");

  it("loads and persists the structured state instead of re-deriving it", () => {
    expect(src).toContain('.select("order_state")');
    expect(src).toContain("persistOrderState");
    expect(src).toContain("selectionFromOrderState(orderState)");
  });

  it("checks availability before creating the order and commits state after", () => {
    const checkIdx = src.indexOf("checkSelectionAvailability");
    const commitIdx = src.indexOf("orderState = commitOrderState(orderState, {\n              orderNumber,");
    expect(checkIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeGreaterThan(checkIdx);
  });
});

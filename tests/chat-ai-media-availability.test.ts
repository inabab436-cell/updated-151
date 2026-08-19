import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { isProductShowable, showableProductId } from "@/lib/product-media-availability";

const source = readFileSync("src/routes/api/chat-ai.ts", "utf8");

describe("product media availability gate (point 5)", () => {
  it("treats a product with stock as showable", () => {
    expect(isProductShowable({ id: "p1", variants: [{ stock: 0 }, { stock: 3 }] })).toBe(true);
  });

  it("treats a fully sold-out product as not showable", () => {
    expect(isProductShowable({ id: "p1", variants: [{ stock: 0 }, { stock: null }] })).toBe(false);
  });

  it("treats a product with no variants as not showable", () => {
    expect(isProductShowable({ id: "p1", variants: [] })).toBe(false);
    expect(isProductShowable(null)).toBe(false);
  });

  it("resolves a showable id against the current snapshot", () => {
    const products = [
      { id: "live", variants: [{ stock: 2 }] },
      { id: "dead", variants: [{ stock: 0 }] },
    ];
    expect(showableProductId(products, "live")).toBe("live");
    expect(showableProductId(products, "dead")).toBeNull();
    expect(showableProductId(products, "ghost")).toBeNull();
    expect(showableProductId(products, null)).toBeNull();
  });

  it("gates the matched-product fallback through showableProductId", () => {
    expect(source).toContain("showableProductId(merchantData.products, matchedProductId)");
    expect(source).toMatch(/fallbackMatchedId &&\s*\n\s*agentAttachments\.length === 0/);
  });

  it("gates the named-product fallback on stock", () => {
    expect(source).toContain("isProductShowable(p)");
  });

  it("keeps the agent media tool as the primary path", () => {
    expect(source).toContain("attach_product_media");
  });
});

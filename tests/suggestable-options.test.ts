import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  availableProducts,
  availableColors,
  availableSizes,
  otherAvailableProducts,
  computeSuggestableOptions,
  buildSuggestableOptionsBlock,
} from "@/lib/suggestable-options";

const source = readFileSync("src/routes/api/chat-ai.ts", "utf8");
const prompt = readFileSync("src/lib/agent-prompt.ts", "utf8");

describe("suggestable options gate", () => {
  it("single available product → never offers other models", () => {
    const products = [
      { id: "p1", name: "قميص", variants: [{ color: "أبيض", size: "M", stock: 2 }] },
      { id: "p2", name: "فستان", variants: [{ color: "أسود", size: "M", stock: 0 }] },
    ];
    expect(availableProducts(products).map((p) => p.id)).toEqual(["p1"]);
    expect(otherAvailableProducts(products, "p1")).toEqual([]);
    const o = computeSuggestableOptions(products, "p1");
    expect(o.canOfferOtherModels).toBe(false);
    expect(buildSuggestableOptionsBlock(products, "p1")).toContain("MAY_OFFER_OTHER_MODELS: NO");
  });

  it("single in-stock colour → never offers other colours", () => {
    const products = [
      {
        id: "p1",
        name: "قميص",
        variants: [
          { color: "أبيض", size: "M", stock: 3 },
          { color: "أحمر", size: "M", stock: 0 },
        ],
      },
    ];
    expect(availableColors(products[0])).toEqual(["أبيض"]);
    const o = computeSuggestableOptions(products, "p1");
    expect(o.canOfferOtherColors).toBe(false);
    expect(buildSuggestableOptionsBlock(products, "p1")).toContain("MAY_OFFER_OTHER_COLORS: NO");
  });

  it("single in-stock size → never offers other sizes", () => {
    const products = [
      {
        id: "p1",
        name: "قميص",
        variants: [
          { color: "أبيض", size: "M", stock: 1 },
          { color: "أبيض", size: "L", stock: 0 },
        ],
      },
    ];
    expect(availableSizes(products[0])).toEqual(["M"]);
    expect(availableSizes(products[0], "أبيض")).toEqual(["M"]);
    expect(availableSizes(products[0], "أحمر")).toEqual([]);
    expect(computeSuggestableOptions(products, "p1").canOfferOtherSizes).toBe(false);
  });

  it("real extra options → may offer them, listing only in-stock ones", () => {
    const products = [
      {
        id: "p1",
        name: "قميص",
        variants: [
          { color: "أبيض", size: "M", stock: 2 },
          { color: "أسود", size: "L", stock: 1 },
          { color: "أخضر", size: "XL", stock: 0 },
        ],
      },
      { id: "p2", name: "فستان", variants: [{ color: "أسود", size: "M", stock: 4 }] },
      { id: "p3", name: "بنطلون", variants: [{ color: "بيج", size: "M", stock: 0 }] },
    ];
    const o = computeSuggestableOptions(products, "p1");
    expect(o.otherModels).toEqual(["فستان"]);
    expect(o.colors).toEqual(["أبيض", "أسود"]);
    expect(o.sizes).toEqual(["M", "L"]);
    expect(o.canOfferOtherModels).toBe(true);
    expect(o.canOfferOtherColors).toBe(true);
    expect(o.canOfferOtherSizes).toBe(true);
    const block = buildSuggestableOptionsBlock(products, "p1");
    expect(block).toContain("OTHER_MODELS_IN_STOCK: فستان");
    expect(block).not.toContain("أخضر");
    expect(block).not.toContain("بنطلون");
  });

  it("pins the availability facts into the model snapshot", () => {
    expect(source).toContain("buildSuggestableOptionsBlock(merchantData.products as any, matchedProductId)");
    expect(source).toMatch(/freshStoreSnapshot[\s\S]{0,600}buildSuggestableOptionsBlock/);
    expect(prompt).toContain("MAY_OFFER_OTHER_MODELS");
  });
});

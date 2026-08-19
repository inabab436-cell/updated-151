/**
 * Guard tests for the internal visual description contract:
 *  - the vision prompt produces a detailed, purely factual description with
 *    no praise/evaluation and no invented fibre/quality/comfort/weight,
 *    written in dialect-neutral wording;
 *  - the agent treats it as reference material only: never the reply itself,
 *    one tiny point when recommending, the single asked-about point when
 *    questioned, no repetition;
 *  - a leaked VISUAL_REF block never reaches the customer.
 */
import { describe, it, expect } from "vitest";
import { VISION_SYSTEM_PROMPT } from "@/lib/product-vision.server";
import { buildSystemPrompt, sanitizeAssistantReply } from "@/routes/api/chat-ai";
import { buildStoreKnowledgeBlock, emptyMerchantData } from "@/lib/merchant-data.server";

describe("vision prompt — internal_description quality rules", () => {
  const p = VISION_SYSTEM_PROMPT;

  it("asks for the full visible detail set", () => {
    for (const token of [
      "collar/neckline",
      "sleeves",
      "pockets",
      "zippers",
      "embroidery",
      "stitching",
      "texture",
    ]) {
      expect(p).toContain(token);
    }
  });

  it("forbids praise and evaluation", () => {
    expect(p).toMatch(/NO praise and NO evaluation/);
    expect(p).toMatch(/luxurious|premium/);
    expect(p).toMatch(/Only observable facts/);
  });

  it("forbids inventing fibre, quality, comfort, warmth or weight", () => {
    expect(p).toMatch(/NEVER invent anything that is not clearly visible/);
    expect(p).toMatch(/fiber\/material type/);
    expect(p).toMatch(/the comfort, the warmth, or the weight/);
  });

  it("keeps the wording dialect- and language-neutral, not marketing", () => {
    expect(p).toMatch(/Do not use any regional dialect/);
    expect(p).toMatch(/NOT marketing copy/);
  });

  it("keeps the internal-only purpose and the brand rule", () => {
    expect(p).toMatch(/INTERNAL ONLY/);
    expect(p).toMatch(/ABSOLUTE BRAND-IDENTITY RULE/);
  });
});

describe("agent prompt — how the internal description is used", () => {
  const prompt = buildSystemPrompt("- منتج | لون: - | مقاس: - | كمية: 1 | سعر: 100");

  it("declares the visual reference as reference material, not a reply", () => {
    expect(prompt).toContain("VISUAL_REF");
    expect(prompt).toMatch(/REFERENCE MATERIAL for you, never a reply/);
    expect(prompt).toMatch(/never retell it, summarise it/);
  });

  it("allows only one tiny useful point when recommending", () => {
    expect(prompt).toMatch(/only ONE tiny genuinely useful point/);
    expect(prompt).toMatch(/in your own natural conversational words/);
  });

  it("extracts only the asked-about point", () => {
    expect(prompt).toMatch(/pull out THAT point only/);
    expect(prompt).toMatch(/stay silent about everything else/);
  });

  it("forbids repeating a detail already said", () => {
    expect(prompt).toMatch(/Never repeat a product detail or the same feature/);
  });

  it("forbids inventing a missing detail", () => {
    expect(prompt).toMatch(/do not invent it \(especially the fibre\/material/);
  });

  it("permits very sparing human praise while buying", () => {
    expect(prompt).toMatch(/VERY sparingly/);
    expect(prompt).toMatch(/شيك جداً/);
  });
});

describe("store knowledge block — internal visual reference", () => {
  it("renders the internal description behind an internal-only label", () => {
    const data = emptyMerchantData();
    data.products.push({
      id: "p1",
      name: "هودي",
      description: "هودي شتوي",
      category: null,
      price: 850,
      currency: "EGP",
      internalDescription: "قطعة علوية بقلنسوة وحبل رباط، سطح محبوك بخطوط رأسية ظاهرة.",
      variants: [{ color: "بيج", size: "L", stock: 2, price: null }],
    });
    const block = buildStoreKnowledgeBlock(data);
    expect(block).toContain("VISUAL_REF");
    expect(block).toContain("ممنوع سرده للعميل");
    expect(block).toContain("سطح محبوك");
  });
});

describe("sanitizer — leaked visual reference", () => {
  it("drops a leaked VISUAL_REF line and keeps the human reply", () => {
    const raw = [
      "VISUAL_REF (داخلي — للمطابقة والفهم البصري فقط، ممنوع سرده للعميل): قطعة علوية بقلنسوة...",
      "",
      "أيوه يا فندم، ده بيدفي كفاية للشتا.",
    ].join("\n");
    expect(sanitizeAssistantReply(raw)).toBe("أيوه يا فندم، ده بيدفي كفاية للشتا.");
  });
});

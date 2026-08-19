/**
 * Guard test: the agent system prompt must forbid leaking any internal
 * vision signal (internal_description, visual_features, matched-product
 * hint, confidence score) into the customer-facing reply.
 *
 * We assert the confidentiality clauses stay in the prompt so a future
 * refactor cannot silently weaken them.
 */
import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "@/routes/api/chat-ai";

describe("system prompt — internal vision confidentiality", () => {
  const prompt = buildSystemPrompt("- منتج | لون: - | مقاس: - | كمية: 1 | سعر: 100");

  it("mentions the [MATCHED_PRODUCT] hint mechanism", () => {
    expect(prompt).toContain("[MATCHED_PRODUCT]");
  });

  it("forbids quoting/paraphrasing internal description or vision data", () => {
    expect(prompt).toMatch(/NEVER quote, paraphrase, translate, or describe/i);
    expect(prompt).toMatch(/internal[\s\S]{0,4}description/i);
    expect(prompt).toMatch(/confidence/i);
  });

  it("routes product media through the attach_product_media tool, not URLs in text", () => {
    expect(prompt).toContain("attach_product_media");
    expect(prompt).toMatch(/Never paste image URLs/i);
  });

  it("tells the agent to ask for clarification when no match is found", () => {
    expect(prompt).toContain("[MATCHED_PRODUCT: none]");
  });

  it("offers similar products as alternatives and attaches useful product media", () => {
    expect(prompt).toMatch(/match_kind: similar/i);
    expect(prompt).toMatch(/visually close alternative/i);
    expect(prompt).toMatch(/do not wait for the customer to explicitly ask/i);
  });

  it("does not embed any raw internal_description payload from candidates", () => {
    // The prompt is built from inventoryText only; internal_description
    // must never appear as a literal field name reachable to the model
    // as part of its instructions.
    expect(prompt).not.toContain('"internal_description"');
    expect(prompt).not.toContain('"visual_features"');
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildAttachmentContextMessage,
  describeReplyAttachments,
  needsAttachmentAwareRegeneration,
} from "@/lib/reply-attachment-context";

const source = readFileSync("src/routes/api/chat-ai.ts", "utf8");

const whiteDress = {
  kind: "image",
  url: "https://cdn/x/white.jpg",
  source: "agent",
  product_id: "p1",
  product_name: "فستان سواريه",
  color: "أبيض",
  variant_summary: ["أبيض: M, L"],
};

describe("agent knows its own reply attachments before writing text", () => {
  it("exposes product, variant, colour and will_send per attachment", () => {
    const facts = describeReplyAttachments([whiteDress]);
    expect(facts).toEqual([
      {
        index: 1,
        product_id: "p1",
        product_name: "فستان سواريه",
        color: "أبيض",
        variants: ["أبيض: M, L"],
        will_send: true,
      },
    ]);
  });

  it("ignores customer-side media and url-less entries", () => {
    expect(
      describeReplyAttachments([
        { url: "https://cdn/c.jpg", source: "customer" },
        { url: "", source: "agent" },
      ]),
    ).toEqual([]);
  });

  it("puts the attached image into the model context before text generation", () => {
    const msg = buildAttachmentContextMessage([whiteDress]);
    expect(msg?.role).toBe("system");
    expect(msg?.content).toContain("ATTACHMENTS_ALREADY_IN_THIS_REPLY (1)");
    expect(msg?.content).toContain("product_id=p1");
    expect(msg?.content).toContain("أبيض");
    expect(msg?.content).toContain("will_send=true");
    expect(msg?.content).toMatch(/never offer to send them/i);
  });

  it("returns no context message when the reply carries no image", () => {
    expect(buildAttachmentContextMessage([])).toBeNull();
    expect(buildAttachmentContextMessage(null)).toBeNull();
  });

  it("forces a regeneration when images were attached after the draft text", () => {
    expect(
      needsAttachmentAwareRegeneration({
        attachments: [whiteDress],
        attachmentsKnownToModel: 0,
      }),
    ).toBe(true);
    expect(
      needsAttachmentAwareRegeneration({
        attachments: [whiteDress],
        attachmentsKnownToModel: 1,
      }),
    ).toBe(false);
    expect(
      needsAttachmentAwareRegeneration({ attachments: [], attachmentsKnownToModel: 0 }),
    ).toBe(false);
  });

  it("wires the attachment context into the chat pipeline, not just the prompt", () => {
    expect(source).toContain("buildAttachmentContextMessage");
    expect(source).toContain("needsAttachmentAwareRegeneration");
    expect(source).toContain("attachmentsKnownToModel");
    expect(source).toContain("variant_summary: liveVariants");
  });
});

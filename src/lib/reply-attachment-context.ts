/**
 * Response-context binding between the agent's TEXT and the images that are
 * actually attached to the same reply.
 *
 * The attachments used to be assembled on a separate path (tool call plus
 * deterministic fallbacks) AFTER the model had already written its sentence,
 * so the model could send a photo of a white dress and still ask "do you want
 * me to show you the white dress?". These helpers turn the real attachment
 * list into a context message that is part of the SAME model invocation that
 * produces the final text.
 */

export interface ReplyAttachmentLike {
  kind?: string | null;
  url?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  color?: string | null;
  variant_summary?: string[] | null;
  source?: string | null;
}

export interface ReplyAttachmentFact {
  index: number;
  product_id: string | null;
  product_name: string | null;
  color: string | null;
  variants: string[];
  /** True when this image is really shipped with the reply the model writes. */
  will_send: boolean;
}

/** Only agent-side images actually carried by this reply. */
export function describeReplyAttachments(
  attachments: ReadonlyArray<ReplyAttachmentLike> | null | undefined,
): ReplyAttachmentFact[] {
  const list = Array.isArray(attachments) ? attachments : [];
  const facts: ReplyAttachmentFact[] = [];
  for (const a of list) {
    if (!a || typeof a.url !== "string" || !a.url.trim()) continue;
    if (a.source && a.source !== "agent") continue;
    facts.push({
      index: facts.length + 1,
      product_id: a.product_id ? String(a.product_id) : null,
      product_name: a.product_name ? String(a.product_name) : null,
      color: a.color ? String(a.color) : null,
      variants: Array.isArray(a.variant_summary)
        ? (a.variant_summary as unknown[]).map((v) => String(v)).filter(Boolean)
        : [],
      will_send: true,
    });
  }
  return facts;
}

/**
 * The system message pinned into the model context BEFORE the final text is
 * generated. Returns null when this reply carries no image at all.
 */
export function buildAttachmentContextMessage(
  attachments: ReadonlyArray<ReplyAttachmentLike> | null | undefined,
): { role: "system"; content: string } | null {
  const facts = describeReplyAttachments(attachments);
  if (facts.length === 0) return null;
  const lines = facts.map((f) => {
    const parts = [
      `#${f.index}`,
      `product_id=${f.product_id ?? "-"}`,
      `product=${f.product_name ?? "-"}`,
      `color=${f.color ?? "-"}`,
      `variants=${f.variants.join(" | ") || "-"}`,
      `will_send=true`,
    ];
    return parts.join(" ; ");
  });
  return {
    role: "system",
    content: [
      `ATTACHMENTS_ALREADY_IN_THIS_REPLY (${facts.length}):`,
      ...lines,
      "These images are attached to the very message you are writing now and the customer will see them next to your text.",
      "Therefore: never offer to send them, never ask whether the customer wants to see them, never say you will send them later, and never say a photo is unavailable.",
      "Write the text as the caption of these exact images (right product, right colour), then move the conversation forward with one easy question about size, quantity or ordering.",
      "Never paste image URLs in the text.",
    ].join("\n"),
  };
}

/**
 * True when the draft text was produced by a model pass that did not yet see
 * these attachments, so the final text must be regenerated with them in
 * context (single response context for text + images).
 */
export function needsAttachmentAwareRegeneration(args: {
  attachments: ReadonlyArray<ReplyAttachmentLike> | null | undefined;
  attachmentsKnownToModel: number;
}): boolean {
  const count = describeReplyAttachments(args.attachments).length;
  return count > 0 && args.attachmentsKnownToModel < count;
}
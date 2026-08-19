/**
 * Missing-information follow-up engine (server-only).
 *
 * When the agent cannot answer a customer question from the live database, we
 * record the gap as a TOPIC. Topics are grouped semantically (not by exact
 * wording, and across languages) so the same underlying question asked by
 * different customers, in different phrasings, maps to ONE topic and ONE
 * notification.
 *
 * Guarantees implemented here:
 *  - one notification per topic, ever (unique index on notifications.topic_id);
 *  - one ask row per (topic, conversation) — repeated questions by the same
 *    customer never inflate the unique-customer count;
 *  - a new customer asking the same open topic re-alerts the SAME notification
 *    (alert_count + priority go up, is_read flips back to false).
 */
import { safeSlice } from "@/lib/safe-slice";

export type MissingInfoOutcome =
  | "created"
  | "repeat_same_conversation"
  | "new_customer_same_topic";

export interface RecordMissingInfoInput {
  merchantId: string;
  conversationId: string;
  customerId: string | null;
  messageId: string | null;
  question: string;
  product: string | null;
  missingField: string;
}

export interface OpenTopic {
  id: string;
  canonical_question: string;
  product: string | null;
  missing_field: string;
}

/** Cheap deterministic pre-match: identical normalized text. */
export function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // Arabic diacritics
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Ask the model which existing open topic (if any) means the SAME thing as the
 * new question. Language- and phrasing-independent. Returns a topic id or null.
 */
export async function matchTopicSemantically(
  apiKey: string,
  question: string,
  product: string | null,
  missingField: string,
  topics: OpenTopic[],
): Promise<string | null> {
  if (topics.length === 0) return null;
  const list = topics
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id} | field=${t.missing_field} | product=${t.product ?? "-"} | question="${t.canonical_question}"`,
    )
    .join("\n");
  const prompt =
    "You group customer questions that a store could not answer.\n" +
    "Decide whether the NEW question asks about the SAME missing piece of information as one of the EXISTING topics.\n" +
    "Judge by meaning, not wording. Different languages, dialects, typos or phrasings that ask for the same fact about the same product/subject are the SAME topic.\n" +
    "Different products, or a different fact about the same product, are DIFFERENT topics.\n" +
    'Answer with JSON only: {"id":"<existing topic id>"} or {"id":null}.\n\n' +
    `EXISTING TOPICS:\n${list}\n\n` +
    `NEW QUESTION: "${question}"\nfield=${missingField}\nproduct=${product ?? "-"}`;

  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
      }),
      // Fail-open dedupe check: a stalled upstream must never hold the
      // customer's reply. On timeout it behaves exactly like a failed call.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const text = String(json?.choices?.[0]?.message?.content ?? "");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]) as { id?: unknown };
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    return topics.some((t) => t.id === id) ? id : null;
  } catch {
    return null;
  }
}

export function buildTopicNotificationMessage(
  question: string,
  product: string | null,
  field: string,
  customerCount: number,
): string {
  const head = product
    ? `معلومة ناقصة عن "${product}" (${field})`
    : `معلومة ناقصة (${field})`;
  return `${head}: ${question}\nعدد العملاء الذين سألوا: ${customerCount}`;
}

export async function recordMissingInformation(
  supabase: any,
  apiKey: string,
  input: RecordMissingInfoInput,
): Promise<{ outcome: MissingInfoOutcome; topicId: string; customerCount: number }> {
  const question = safeSlice(input.question.trim(), 0, 1000);
  const product = input.product ? safeSlice(input.product.trim(), 0, 200) : null;
  const field = safeSlice(String(input.missingField || "other"), 0, 40);
  const normalized = normalizeQuestion(question);

  // 1) Candidate open topics for this merchant.
  const { data: openTopics } = await supabase
    .from("missing_info_topics")
    .select("id, canonical_question, normalized_key, product, missing_field")
    .eq("merchant_id", input.merchantId)
    .eq("status", "open")
    .order("last_asked_at", { ascending: false })
    .limit(40);
  const topics = (openTopics ?? []) as Array<OpenTopic & { normalized_key: string | null }>;

  // 2) Exact-normalized match first (free), then semantic matching.
  let topicId =
    topics.find((t) => t.normalized_key && t.normalized_key === normalized)?.id ?? null;
  if (!topicId) {
    topicId = await matchTopicSemantically(apiKey, question, product, field, topics);
  }

  let created = false;
  if (!topicId) {
    const { data: inserted, error } = await supabase
      .from("missing_info_topics")
      .insert({
        merchant_id: input.merchantId,
        canonical_question: question,
        normalized_key: normalized,
        product,
        missing_field: field,
        details: {
          first_question: question,
          product,
          missing_field: field,
          first_conversation_id: input.conversationId,
        },
        status: "open",
        alert_count: 1,
        priority: 1,
      })
      .select("id")
      .maybeSingle();
    if (error || !inserted?.id) throw error ?? new Error("topic_insert_failed");
    topicId = inserted.id as string;
    created = true;
  }

  // 3) One ask row per (topic, conversation). Duplicate = same customer asking
  //    again in the same conversation → nothing else changes.
  const { data: existingAsk } = await supabase
    .from("missing_info_asks")
    .select("id")
    .eq("topic_id", topicId)
    .eq("conversation_id", input.conversationId)
    .maybeSingle();

  let isNewAsker = false;
  if (!existingAsk) {
    const { error: askErr } = await supabase.from("missing_info_asks").insert({
      topic_id: topicId,
      merchant_id: input.merchantId,
      conversation_id: input.conversationId,
      customer_id: input.customerId,
      customer_key: input.customerId ?? input.conversationId,
      message_id: input.messageId,
      question_text: question,
    });
    // A concurrent insert hitting the unique index is treated as a repeat.
    isNewAsker = !askErr;
  }

  // 4) Unique customers = distinct customer_key across ask rows.
  const { data: askRows } = await supabase
    .from("missing_info_asks")
    .select("customer_key")
    .eq("topic_id", topicId);
  const customerCount = new Set(
    ((askRows ?? []) as Array<{ customer_key: string }>).map((r) => r.customer_key),
  ).size;

  const nowIso = new Date().toISOString();
  const message = buildTopicNotificationMessage(question, product, field, customerCount);

  if (created) {
    await supabase.from("notifications").insert({
      type: "missing_information",
      conversation_id: input.conversationId,
      topic_id: topicId,
      message,
      is_read: false,
      alert_count: 1,
      priority: 1,
    });
    try {
      const { notifyMerchantByEmail, missingInfoEmail } = await import(
        "@/lib/email-notify.server"
      );
      const mail = missingInfoEmail(question, product);
      await notifyMerchantByEmail({
        admin: supabase as any,
        merchantId: input.merchantId,
        event: "missing_information",
        subject: mail.subject,
        html: mail.html,
      });
    } catch (e) {
      console.error("[missing-info] email notify skipped", e);
    }

  } else {
    // NEVER a second notification. A brand-new asker re-alerts the same row.
    const { data: topicRow } = await supabase
      .from("missing_info_topics")
      .select("alert_count, priority")
      .eq("id", topicId)
      .maybeSingle();
    const patch: Record<string, unknown> = { last_asked_at: nowIso, updated_at: nowIso };
    if (isNewAsker) {
      patch.alert_count = Number(topicRow?.alert_count ?? 1) + 1;
      patch.priority = Number(topicRow?.priority ?? 1) + 1;
    }
    await supabase.from("missing_info_topics").update(patch).eq("id", topicId);

    const notifPatch: Record<string, unknown> = { message, updated_at: nowIso };
    if (isNewAsker) {
      notifPatch.is_read = false;
      notifPatch.alert_count = Number(topicRow?.alert_count ?? 1) + 1;
      notifPatch.priority = Number(topicRow?.priority ?? 1) + 1;
    }
    await supabase.from("notifications").update(notifPatch).eq("topic_id", topicId);
  }

  const outcome: MissingInfoOutcome = created
    ? "created"
    : isNewAsker
      ? "new_customer_same_topic"
      : "repeat_same_conversation";

  return { outcome, topicId: topicId as string, customerCount };
}

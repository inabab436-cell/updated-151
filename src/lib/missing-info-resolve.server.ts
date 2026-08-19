/**
 * Resolve missing-information topics from a DASHBOARD INTERFACE (server-only).
 *
 * The brand owner can answer a missing-information question in two ways:
 *   1) the manual-entry box on the missing-information page, or
 *   2) the dedicated interface the notification points to (shipping table,
 *      policies, contacts, …).
 *
 * Both paths must behave identically. This module is the (2) path: after a row
 * is saved in one of those interfaces, we check the OPEN topics of this
 * merchant, ask the model which of them are now answered by the saved data,
 * mark them resolved (with the exact answer text) and run the SAME follow-up
 * engine used by manual entry, so waiting customers are contacted.
 *
 * The missing-information logic and flow itself are unchanged — only the entry
 * point is new. Every failure is best-effort and never blocks the save.
 */

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER = process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV = process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const AI_MODEL = process.env.CUPAI_APP_AI_MODEL || "google/gemini-2.5-flash";

export interface InterfaceKnowledge {
  /** Short Arabic title, e.g. "سعر شحن القاهرة". */
  title: string;
  /** The saved data rendered as plain Arabic text. */
  content: string;
  /** Optional row id of the saved record. */
  entryId?: string | null;
  /** Which missing_field values this interface can answer. */
  fields?: string[];
}

interface OpenTopicRow {
  id: string;
  canonical_question: string;
  product: string | null;
  missing_field: string;
}

/** Ask the model which open topics are answered by the newly saved data. */
export async function pickAnsweredTopics(
  apiKey: string,
  knowledge: InterfaceKnowledge,
  topics: OpenTopicRow[],
): Promise<string[]> {
  if (!topics.length) return [];
  const list = topics
    .map(
      (t, i) =>
        `${i + 1}. id=${t.id} | field=${t.missing_field} | product=${t.product ?? "-"} | question="${t.canonical_question}"`,
    )
    .join("\n");
  const prompt =
    "صاحب متجر أضاف للتو بيانات جديدة من إحدى واجهات لوحة التحكم.\n" +
    "حدّد أي من الأسئلة المفتوحة التالية أصبحت الآن مُجابة بشكل كامل وصريح بهذه البيانات.\n" +
    "لا تختر سؤالًا إلا إذا كانت البيانات الجديدة تجيب عنه فعلاً (نفس المنطقة/المنتج/الحقيقة المطلوبة).\n" +
    'أعد JSON فقط: {"ids":["…"]} أو {"ids":[]}.\n\n' +
    `البيانات الجديدة (${knowledge.title}):\n${knowledge.content}\n\n` +
    `الأسئلة المفتوحة:\n${list}`;
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [AI_AUTH_HEADER]: apiKey },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.1,
      }),
    });
    if (!res.ok) return [];
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content ?? "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as { ids?: unknown };
    const ids = Array.isArray(parsed.ids) ? parsed.ids : [];
    const valid = new Set(topics.map((t) => t.id));
    return ids
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v && valid.has(v));
  } catch {
    return [];
  }
}

export interface InterfaceResolveResult {
  resolvedTopicIds: string[];
}

export async function resolveMissingInfoFromInterface(
  admin: any,
  merchantId: string,
  knowledge: InterfaceKnowledge,
): Promise<InterfaceResolveResult> {
  const apiKey = process.env[AI_API_KEY_ENV];
  if (!apiKey) return { resolvedTopicIds: [] };
  if (!knowledge.content.trim()) return { resolvedTopicIds: [] };

  let query = admin
    .from("missing_info_topics")
    .select("id, canonical_question, product, missing_field")
    .eq("merchant_id", merchantId)
    .eq("status", "open")
    .order("last_asked_at", { ascending: false })
    .limit(40);
  if (knowledge.fields?.length) query = query.in("missing_field", knowledge.fields);
  const { data } = await query;
  const topics = (data ?? []) as OpenTopicRow[];
  if (!topics.length) return { resolvedTopicIds: [] };

  const answered = await pickAnsweredTopics(apiKey, knowledge, topics);
  if (!answered.length) return { resolvedTopicIds: [] };

  const { runFollowupForTopic } = await import("@/lib/missing-info-followup.server");
  for (const topicId of answered) {
    const nowIso = new Date().toISOString();
    await admin
      .from("missing_info_topics")
      .update({
        status: "resolved",
        resolved_at: nowIso,
        updated_at: nowIso,
        resolved_entry_id: knowledge.entryId ?? null,
        resolved_title: knowledge.title,
        resolved_answer: knowledge.content,
      })
      .eq("id", topicId);
    await admin
      .from("notifications")
      .update({ is_read: true, updated_at: nowIso })
      .eq("topic_id", topicId);
    try {
      await runFollowupForTopic(admin, topicId, {
        title: knowledge.title,
        content: knowledge.content,
      });
    } catch (e) {
      console.error("[missing-info] interface followup failed", e);
    }
  }
  return { resolvedTopicIds: answered };
}

/**
 * Convenience entry point for dashboard interfaces (shipping table, policies,
 * contacts …). Resolves the merchant from the authenticated dashboard user and
 * runs the interface path above. Best-effort: never throws.
 */
export async function resolveMissingInfoForUser(
  userId: string,
  knowledge: InterfaceKnowledge,
): Promise<InterfaceResolveResult> {
  try {
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin as any, userId);
    if (!merchantId) return { resolvedTopicIds: [] };
    return await resolveMissingInfoFromInterface(admin, merchantId, knowledge);
  } catch (e) {
    console.error("[missing-info] interface resolve skipped", e);
    return { resolvedTopicIds: [] };
  }
}

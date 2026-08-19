/**
 * Manual-entry ingestion for brand-owner knowledge.
 *
 * The brand owner types free-form text (any language). We ask the AI to
 * produce a short Arabic title and cleaned content, then store it in the
 * `knowledge_base` table — which the chat agent reads directly on every
 * customer message. When the entry originates from a missing-information
 * notification, the notification and its topic are marked resolved.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV =
  process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const DEFAULT_MODEL =
  process.env.CUPAI_APP_AI_MODEL || "google/gemini-2.5-flash";

async function classifyEntry(
  text: string,
  hint: string | null,
): Promise<{ title: string; content: string }> {
  const apiKey = process.env[AI_API_KEY_ENV];
  const fallback = {
    title: text.split(/\r?\n/)[0].slice(0, 80) || "معلومة يدوية",
    content: text.trim(),
  };
  if (!apiKey) return fallback;
  const prompt =
    "أنت مساعد يهيّئ معلومات صاحب متجر ليقرأها وكيل الذكاء الاصطناعي في المحادثات.\n" +
    "من نص المُدخل التالي أعد JSON فقط بالصيغة {\"title\":\"…\",\"content\":\"…\"}.\n" +
    "- title: عنوان عربي مختصر (٨ كلمات كحد أقصى) يصف الموضوع.\n" +
    "- content: نفس المعلومة بلغة عربية واضحة، مرتّبة ومنسّقة كنقاط عند الحاجة، بدون إضافة معلومات لم يذكرها المستخدم.\n" +
    (hint ? `سياق الإشعار (سؤال العميل): "${hint}"\n` : "") +
    `النص:\n"""${text}"""`;
  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", [AI_AUTH_HEADER]: apiKey },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    if (!res.ok) return fallback;
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content ?? "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]) as { title?: unknown; content?: unknown };
    const title =
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 120)
        : fallback.title;
    const content =
      typeof parsed.content === "string" && parsed.content.trim()
        ? parsed.content.trim()
        : fallback.content;
    return { title, content };
  } catch {
    return fallback;
  }
}

export const submitManualEntry = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        text: z.string().min(1).max(10000),
        notificationId: z.string().uuid().optional().nullable(),
        topicId: z.string().uuid().optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true; id: string; resolvedNotificationId: string | null }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin, userId);
    if (!merchantId) throw new Error("لا يوجد متجر لهذا الحساب.");

    // Load the topic if provided — gives context to the classifier and lets us
    // verify ownership before resolving anything.
    let topic:
      | { id: string; canonical_question: string; merchant_id: string }
      | null = null;
    const topicId = data.topicId ?? null;
    if (topicId) {
      const { data: t } = await admin
        .from("missing_info_topics")
        .select("id, canonical_question, merchant_id")
        .eq("id", topicId)
        .maybeSingle();
      if (t && (t as any).merchant_id === merchantId) topic = t as any;
    }

    const { title, content } = await classifyEntry(
      data.text,
      topic?.canonical_question ?? null,
    );

    const { data: inserted, error } = await admin
      .from("knowledge_base")
      .insert({
        merchant_id: merchantId,
        file_name: title,
        content_text: content,
        status: "approved",
      })
      .select("id")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "فشل الحفظ.");
    const entryId = String((inserted as { id: string }).id);

    // Resolve the originating notification + topic (if any and if owned).
    let resolvedNotificationId: string | null = null;
    let followupTopicId: string | null = null;
    if (topic) {
      const nowIso = new Date().toISOString();
      await admin
        .from("missing_info_topics")
        .update({
          status: "resolved",
          resolved_at: nowIso,
          updated_at: nowIso,
          resolved_entry_id: entryId,
          resolved_title: title,
          resolved_answer: content,
        })
        .eq("id", topic.id);
      const { data: notif } = await admin
        .from("notifications")
        .update({ is_read: true, updated_at: nowIso })
        .eq("topic_id", topic.id)
        .select("id")
        .maybeSingle();
      if (notif) resolvedNotificationId = (notif as any).id as string;
      followupTopicId = topic.id;
    } else if (data.notificationId) {
      // No topic supplied but a notification id was — verify ownership then mark read.
      const { data: n } = await admin
        .from("notifications")
        .select("id, conversation_id, topic_id")
        .eq("id", data.notificationId)
        .maybeSingle();
      if (n) {
        const { data: convo } = await admin
          .from("conversations")
          .select("merchant_id")
          .eq("id", (n as any).conversation_id)
          .maybeSingle();
        if (convo && (convo as any).merchant_id === merchantId) {
          await admin
            .from("notifications")
            .update({ is_read: true, updated_at: new Date().toISOString() })
            .eq("id", data.notificationId);
          resolvedNotificationId = (n as any).id as string;
          if ((n as any).topic_id) {
            const nowIso = new Date().toISOString();
            await admin
              .from("missing_info_topics")
              .update({
                status: "resolved",
                resolved_at: nowIso,
                updated_at: nowIso,
                resolved_entry_id: entryId,
                resolved_title: title,
                resolved_answer: content,
              })
              .eq("id", (n as any).topic_id);
            followupTopicId = (n as any).topic_id as string;
          }
        }
      }
    }

    // Best-effort: notify every waiting customer whose original question is
    // answered by this new knowledge. Failures must not block the save.
    if (followupTopicId) {
      try {
        const { runFollowupForTopic } = await import(
          "@/lib/missing-info-followup.server"
        );
        await runFollowupForTopic(admin, followupTopicId, { title, content });
      } catch (e) {
        console.error("followup_run_failed", e);
      }
    }

    return { ok: true, id: entryId, resolvedNotificationId };
  });

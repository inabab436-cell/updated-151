/**
 * Missing-information follow-up engine (server-only).
 *
 * When the brand owner adds knowledge that resolves a missing_info_topic, we
 * revisit every conversation that asked about that topic and decide, per
 * conversation, whether the customer still needs the answer. If they do, the
 * agent posts a natural in-chat message referencing the earlier promise. If
 * not, we record the decision and move on. All auto-sent messages are
 * flagged so the merchant UI can highlight them.
 */

interface AskRow {
  id: string;
  conversation_id: string;
  customer_id: string | null;
  message_id: string | null;
  question_text: string | null;
}

interface TopicRow {
  id: string;
  merchant_id: string;
  canonical_question: string;
  product: string | null;
  missing_field: string;
}

interface RecentMsg {
  role: string;
  content: string;
  created_at: string;
}

interface FollowupDecision {
  still_needed: boolean;
  reason: string;
  reply: string | null;
}

const AI_BASE_URL =
  process.env.CUPAI_APP_AI_BASE_URL || "https://ai.gateway.lovable.dev/v1";
const AI_AUTH_HEADER =
  process.env.CUPAI_APP_AI_AUTH_HEADER || "Lovable-API-Key";
const AI_API_KEY_ENV = process.env.CUPAI_APP_AI_KEY_ENV || "LOVABLE_API_KEY";
const AI_MODEL =
  process.env.CUPAI_APP_AI_MODEL || "google/gemini-2.5-flash";

async function decideAndDraft(
  apiKey: string,
  topic: TopicRow,
  knowledge: { title: string; content: string },
  ask: AskRow,
  recent: RecentMsg[],
): Promise<FollowupDecision> {
  const transcript = recent
    .map(
      (m) =>
        `${m.role === "user" ? "العميل" : m.role === "assistant" ? "الوكيل" : m.role}: ${m.content}`,
    )
    .join("\n");
  const prompt =
    "أنت وكيل خدمة عملاء لمتجر. المعلومة التي كان العميل ينتظرها أصبحت متاحة الآن. عليك دراسة المحادثة كاملة وتحديد ما إذا كان العميل ما زال يحتاج هذه المعلومة، ثم في حال كان يحتاجها اكتب له رسالة طبيعية بلغته/لهجته كأنك رجعت له كما وعدته.\n" +
    "قواعد صارمة:\n" +
    "- لا ترسل شيئًا إذا انتهت المحادثة أو غيّر العميل موضوعه أو لم تعد المعلومة ذات صلة أو أُجيب عنها بطريقة أخرى.\n" +
    "- إذا كان يحتاجها فاكتب رسالة قصيرة ودافئة، تبدأ بالإشارة إلى أنك رجعت له بالمعلومة التي طلبها سابقًا، ثم قدّم الحقيقة/المعلومة كما هي مذكورة أدناه، بدون اختراع تفاصيل.\n" +
    "- اكتب الرد بنفس اللغة أو اللهجة المستعملة في المحادثة.\n" +
    'أعد JSON فقط بالصيغة: {"still_needed": true|false, "reason": "سبب قصير بالعربية", "reply": "الرسالة أو null"}.\n\n' +
    `الموضوع الأصلي: "${topic.canonical_question}"${topic.product ? ` (المنتج: ${topic.product})` : ""}\n` +
    `تصنيف المعلومة: ${topic.missing_field}\n` +
    `السؤال الأصلي للعميل: "${ask.question_text ?? topic.canonical_question}"\n\n` +
    `المعلومة الجديدة المتاحة الآن (${knowledge.title}):\n${knowledge.content}\n\n` +
    `آخر رسائل المحادثة (بالترتيب الزمني):\n${transcript || "(لا توجد رسائل)"}\n`;

  try {
    const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [AI_AUTH_HEADER]: apiKey,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0.3,
      }),
    });
    if (!res.ok) return { still_needed: false, reason: "ai_http_error", reply: null };
    const json = await res.json();
    const raw = String(json?.choices?.[0]?.message?.content ?? "");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { still_needed: false, reason: "ai_parse_error", reply: null };
    const parsed = JSON.parse(m[0]) as Partial<FollowupDecision>;
    const still = parsed.still_needed === true;
    const reply =
      still && typeof parsed.reply === "string" && parsed.reply.trim()
        ? parsed.reply.trim()
        : null;
    return {
      still_needed: still && !!reply,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim()
          ? parsed.reason.trim().slice(0, 400)
          : still
            ? "أرسلت المعلومة الجديدة."
            : "لم تعد المعلومة مطلوبة.",
      reply: still ? reply : null,
    };
  } catch {
    return { still_needed: false, reason: "ai_exception", reply: null };
  }
}

export interface FollowupResult {
  topicId: string;
  processed: number;
  sent: number;
  skipped: number;
}

export async function runFollowupForTopic(
  admin: any,
  topicId: string,
  knowledge: { title: string; content: string },
): Promise<FollowupResult> {
  const apiKey = process.env[AI_API_KEY_ENV];
  const { data: topic } = await admin
    .from("missing_info_topics")
    .select("id, merchant_id, canonical_question, product, missing_field")
    .eq("id", topicId)
    .maybeSingle();
  if (!topic) return { topicId, processed: 0, sent: 0, skipped: 0 };
  const t = topic as TopicRow;

  const { data: asks } = await admin
    .from("missing_info_asks")
    .select("id, conversation_id, customer_id, message_id, question_text, followup_status")
    .eq("topic_id", topicId);
  const pending = ((asks ?? []) as any[]).filter(
    (a) => (a.followup_status ?? "pending") === "pending",
  );

  let sent = 0;
  let skipped = 0;
  const sentConversationIds: string[] = [];

  for (const ask of pending as AskRow[]) {
    // Recent messages give the AI enough context to judge relevance.
    const { data: msgs } = await admin
      .from("messages")
      .select("role, content, created_at")
      .eq("conversation_id", ask.conversation_id)
      .order("created_at", { ascending: false })
      .limit(30);
    const recent = (((msgs ?? []) as any[]).reverse()) as RecentMsg[];

    const decision: FollowupDecision = apiKey
      ? await decideAndDraft(apiKey, t, knowledge, ask, recent)
      : { still_needed: false, reason: "ai_key_missing", reply: null };

    const nowIso = new Date().toISOString();
    if (decision.still_needed && decision.reply) {
      // Same shape scrubber as the live chat turn: this draft is model-written
      // from internal material (the topic record + the merchant's raw knowledge
      // entry), so internal delimiters, headings and technical wording must be
      // stripped before it reaches a customer. The knowledge answer itself is
      // the whole point of this message, so it is intentionally not scrubbed
      // as internal copy here.
      const { sanitizeAssistantReply } = await import("@/routes/api/chat-ai");
      const safeReply = sanitizeAssistantReply(decision.reply).trim() || null;

      if (!safeReply) {
        skipped++;
        continue;
      }
      const { data: inserted, error: insErr } = await admin
        .from("messages")
        .insert({
          conversation_id: ask.conversation_id,
          role: "assistant",
          content: safeReply,
          is_auto_followup: true,
          followup_topic_id: t.id,
        })
        .select("id")

        .single();
      if (!insErr && inserted) {
        await admin
          .from("missing_info_asks")
          .update({
            followup_status: "sent",
            followup_message_id: (inserted as any).id,
            followup_reason: decision.reason,
            followup_decided_at: nowIso,
          })
          .eq("id", ask.id);
        sent += 1;
        sentConversationIds.push(ask.conversation_id);
        continue;
      }
      // Fell through on insert error → treat as skipped.
    }
    await admin
      .from("missing_info_asks")
      .update({
        followup_status: "skipped",
        followup_reason: decision.reason,
        followup_decided_at: nowIso,
      })
      .eq("id", ask.id);
    skipped += 1;
  }

  // Post a single summary notification for the merchant.
  const message =
    sent > 0
      ? `تم إرسال المعلومة الجديدة (${knowledge.title}) إلى ${sent} عميل${sent > 1 ? " كانوا في انتظارها." : " كان في انتظارها."}`
      : `تمت مراجعة العملاء الذين سألوا عن "${t.canonical_question}"؛ لم يعد أحد منهم بحاجة للمعلومة.`;

  // Upsert: one summary notification per topic (unique partial index).
  const { data: existing } = await admin
    .from("notifications")
    .select("id, conversation_id")
    .eq("followup_topic_id", t.id)
    .maybeSingle();
  if (existing) {
    await admin
      .from("notifications")
      .update({
        message,
        sent_count: sent,
        is_read: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", (existing as any).id);
  } else {
    const anchorConversation =
      sentConversationIds[0] ?? (pending[0]?.conversation_id ?? null);
    if (anchorConversation) {
      await admin.from("notifications").insert({
        type: "missing_info_followup",
        conversation_id: anchorConversation,
        followup_topic_id: t.id,
        message,
        sent_count: sent,
        is_read: false,
        alert_count: 1,
        priority: 1,
      });
    }
  }

  return { topicId, processed: pending.length, sent, skipped };
}

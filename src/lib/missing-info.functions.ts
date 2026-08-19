// Merchant-facing missing-information topics: who asked, and where.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export interface MissingInfoAsker {
  conversation_id: string;
  customer_id: string | null;
  customer_name: string | null;
  message_id: string | null;
  question_text: string | null;
  asked_at: string;
}

export interface MissingInfoTopicDetail {
  id: string;
  canonical_question: string;
  product: string | null;
  missing_field: string;
  status: string;
  alert_count: number;
  priority: number;
  customer_count: number;
  first_asked_at: string;
  last_asked_at: string;
  askers: MissingInfoAsker[];
}

export const getMissingInfoTopic = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ topicId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<MissingInfoTopicDetail> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();

    const { data: topic, error } = await admin
      .from("missing_info_topics")
      .select(
        "id, merchant_id, canonical_question, product, missing_field, status, alert_count, priority, first_asked_at, last_asked_at",
      )
      .eq("id", data.topicId)
      .maybeSingle();
    if (error) throw error;
    if (!topic) throw new Error("العنصر غير موجود.");

    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", (topic as any).merchant_id)
      .maybeSingle();
    if (!merchant || (merchant as any).user_id !== userId) throw new Error("غير مصرح.");

    const { data: asks } = await admin
      .from("missing_info_asks")
      .select("conversation_id, customer_id, customer_key, message_id, question_text, created_at")
      .eq("topic_id", data.topicId)
      .order("created_at", { ascending: true });
    const rows = (asks ?? []) as any[];

    const customerIds = Array.from(
      new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
    );
    const nameById = new Map<string, string | null>();
    if (customerIds.length) {
      const { data: customers } = await admin
        .from("customers")
        .select("id, name")
        .in("id", customerIds);
      for (const c of (customers ?? []) as any[]) nameById.set(c.id, c.name ?? null);
    }

    const askers: MissingInfoAsker[] = rows.map((r) => ({
      conversation_id: r.conversation_id as string,
      customer_id: (r.customer_id as string | null) ?? null,
      customer_name: r.customer_id ? nameById.get(r.customer_id) ?? null : null,
      message_id: (r.message_id as string | null) ?? null,
      question_text: (r.question_text as string | null) ?? null,
      asked_at: r.created_at as string,
    }));

    const customerCount = new Set(rows.map((r) => r.customer_key as string)).size;

    return {
      id: (topic as any).id,
      canonical_question: (topic as any).canonical_question,
      product: (topic as any).product ?? null,
      missing_field: (topic as any).missing_field ?? "other",
      status: (topic as any).status ?? "open",
      alert_count: Number((topic as any).alert_count ?? 1),
      priority: Number((topic as any).priority ?? 1),
      customer_count: customerCount,
      first_asked_at: (topic as any).first_asked_at,
      last_asked_at: (topic as any).last_asked_at,
      askers,
    };
  });

// -----------------------------------------------------------------------------
// Follow-up recipients: list of customers who were auto-notified after the
// brand owner added the missing information.
// -----------------------------------------------------------------------------

export interface FollowupRecipient {
  conversation_id: string;
  customer_id: string | null;
  customer_name: string | null;
  /** Original message where the customer asked. */
  original_message_id: string | null;
  /** Auto-sent assistant message with the new information. */
  followup_message_id: string | null;
  question_text: string | null;
  decided_at: string | null;
}

export interface FollowupSummary {
  topic_id: string;
  canonical_question: string;
  sent: FollowupRecipient[];
  skipped: FollowupRecipient[];
}

export const getFollowupRecipients = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => z.object({ topicId: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<FollowupSummary> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();

    const { data: topic } = await admin
      .from("missing_info_topics")
      .select("id, merchant_id, canonical_question")
      .eq("id", data.topicId)
      .maybeSingle();
    if (!topic) throw new Error("العنصر غير موجود.");
    const { data: merchant } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", (topic as any).merchant_id)
      .maybeSingle();
    if (!merchant || (merchant as any).user_id !== userId) throw new Error("غير مصرح.");

    const { data: asks } = await admin
      .from("missing_info_asks")
      .select(
        "conversation_id, customer_id, message_id, question_text, followup_status, followup_message_id, followup_decided_at",
      )
      .eq("topic_id", data.topicId);
    const rows = ((asks ?? []) as any[]).filter(
      (a) => a.followup_status === "sent" || a.followup_status === "skipped",
    );

    const customerIds = Array.from(
      new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
    );
    const nameById = new Map<string, string | null>();
    if (customerIds.length) {
      const { data: customers } = await admin
        .from("customers")
        .select("id, name")
        .in("id", customerIds);
      for (const c of (customers ?? []) as any[]) nameById.set(c.id, c.name ?? null);
    }

    const toRecipient = (r: any): FollowupRecipient => ({
      conversation_id: r.conversation_id,
      customer_id: (r.customer_id as string | null) ?? null,
      customer_name: r.customer_id ? nameById.get(r.customer_id) ?? null : null,
      original_message_id: (r.message_id as string | null) ?? null,
      followup_message_id: (r.followup_message_id as string | null) ?? null,
      question_text: (r.question_text as string | null) ?? null,
      decided_at: (r.followup_decided_at as string | null) ?? null,
    });

    return {
      topic_id: (topic as any).id,
      canonical_question: (topic as any).canonical_question,
      sent: rows.filter((r) => r.followup_status === "sent").map(toRecipient),
      skipped: rows.filter((r) => r.followup_status === "skipped").map(toRecipient),
    };
  });

// -----------------------------------------------------------------------------
// Dedicated dashboard page: every missing-information topic ever recorded, with
// the customers who asked, whether the information was added (and what was
// added), and the customers the agent went back to with the answer.
// -----------------------------------------------------------------------------

export interface MissingInfoOverviewRow {
  id: string;
  canonical_question: string;
  product: string | null;
  missing_field: string;
  status: string;
  alert_count: number;
  priority: number;
  customer_count: number;
  first_asked_at: string;
  last_asked_at: string;
  resolved_at: string | null;
  /** The knowledge the brand owner added to answer this topic (if any). */
  resolved_title: string | null;
  resolved_answer: string | null;
  /** Notification row for this topic — used by the manual-entry deep link. */
  notification_id: string | null;
  askers: MissingInfoAsker[];
  followed_up: FollowupRecipient[];
  followup_skipped: FollowupRecipient[];
}

export const listMissingInfoTopics = createServerFn({ method: "GET" }).handler(
  async (): Promise<MissingInfoOverviewRow[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin, userId);
    if (!merchantId) return [];

    const { data: topics, error } = await admin
      .from("missing_info_topics")
      .select(
        "id, canonical_question, product, missing_field, status, alert_count, priority, first_asked_at, last_asked_at, resolved_at, resolved_title, resolved_answer",
      )
      .eq("merchant_id", merchantId)
      .order("last_asked_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const topicRows = (topics ?? []) as any[];
    if (topicRows.length === 0) return [];
    const topicIds = topicRows.map((t) => t.id as string);

    const { data: asks } = await admin
      .from("missing_info_asks")
      .select(
        "topic_id, conversation_id, customer_id, customer_key, message_id, question_text, created_at, followup_status, followup_message_id, followup_decided_at",
      )
      .in("topic_id", topicIds)
      .order("created_at", { ascending: true });
    const askRows = (asks ?? []) as any[];

    const customerIds = Array.from(
      new Set(askRows.map((r) => r.customer_id).filter(Boolean) as string[]),
    );
    const nameById = new Map<string, string | null>();
    if (customerIds.length) {
      const { data: customers } = await admin
        .from("customers")
        .select("id, name")
        .in("id", customerIds);
      for (const c of (customers ?? []) as any[]) nameById.set(c.id, c.name ?? null);
    }

    const { data: notifs } = await admin
      .from("notifications")
      .select("id, topic_id")
      .in("topic_id", topicIds);
    const notifByTopic = new Map<string, string>();
    for (const n of (notifs ?? []) as any[]) {
      if (n.topic_id) notifByTopic.set(n.topic_id as string, n.id as string);
    }

    const nameOf = (r: any) =>
      r.customer_id ? nameById.get(r.customer_id) ?? null : null;

    return topicRows.map<MissingInfoOverviewRow>((t) => {
      const mine = askRows.filter((a) => a.topic_id === t.id);
      const toRecipient = (r: any): FollowupRecipient => ({
        conversation_id: r.conversation_id,
        customer_id: (r.customer_id as string | null) ?? null,
        customer_name: nameOf(r),
        original_message_id: (r.message_id as string | null) ?? null,
        followup_message_id: (r.followup_message_id as string | null) ?? null,
        question_text: (r.question_text as string | null) ?? null,
        decided_at: (r.followup_decided_at as string | null) ?? null,
      });
      return {
        id: t.id,
        canonical_question: t.canonical_question,
        product: t.product ?? null,
        missing_field: t.missing_field ?? "other",
        status: t.status ?? "open",
        alert_count: Number(t.alert_count ?? 1),
        priority: Number(t.priority ?? 1),
        customer_count: new Set(mine.map((a) => a.customer_key as string)).size,
        first_asked_at: t.first_asked_at,
        last_asked_at: t.last_asked_at,
        resolved_at: t.resolved_at ?? null,
        resolved_title: t.resolved_title ?? null,
        resolved_answer: t.resolved_answer ?? null,
        notification_id: notifByTopic.get(t.id as string) ?? null,
        askers: mine.map((a) => ({
          conversation_id: a.conversation_id as string,
          customer_id: (a.customer_id as string | null) ?? null,
          customer_name: nameOf(a),
          message_id: (a.message_id as string | null) ?? null,
          question_text: (a.question_text as string | null) ?? null,
          asked_at: a.created_at as string,
        })),
        followed_up: mine.filter((a) => a.followup_status === "sent").map(toRecipient),
        followup_skipped: mine
          .filter((a) => a.followup_status === "skipped")
          .map(toRecipient),
      };
    });
  },
);

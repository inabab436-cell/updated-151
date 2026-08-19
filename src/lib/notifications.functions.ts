// Merchant-facing notifications: list + mark-read. Uses the admin client
// after verifying the caller's session, then scopes strictly to that
// merchant's conversations.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type NotificationType =
  | "ai_error"
  | "new_order"
  | "human_needed"
  | "missing_information"
  | "missing_info_followup";

export interface NotificationRow {
  id: string;
  type: NotificationType;
  conversation_id: string;
  message: string | null;
  is_read: boolean;
  created_at: string;
  /** Set for `missing_information` rows: the grouped missing-info topic. */
  topic_id: string | null;
  /** Set for `missing_info_followup` rows: the topic that was just resolved. */
  followup_topic_id: string | null;
  /** How many customers were successfully auto-followed-up (followup rows). */
  sent_count: number | null;
  /** How many times the same topic was re-raised by NEW customers. */
  alert_count: number;
  priority: number;
  /** Unique customers who asked about this topic (same customer counts once). */
  customer_count: number;
  /** Classification of the missing information (price/size/policy/…). */
  missing_field: string | null;
}

export const listNotifications = createServerFn({ method: "GET" }).handler(
  async (): Promise<NotificationRow[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();

    const { data: merchants } = await admin
      .from("merchants")
      .select("id")
      .eq("user_id", userId);
    const merchantIds = (merchants ?? []).map((m: any) => m.id as string);
    if (merchantIds.length === 0) return [];

    const { data: convos } = await admin
      .from("conversations")
      .select("id")
      .in("merchant_id", merchantIds);
    const convoIds = (convos ?? []).map((c: any) => c.id as string);
    if (convoIds.length === 0) return [];

    const { data, error } = await admin
      .from("notifications")
      .select(
        "id, type, conversation_id, message, is_read, created_at, topic_id, followup_topic_id, sent_count, alert_count, priority",
      )
      .in("conversation_id", convoIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as any[];

    // Unique-customer counts for missing-information topics (one ask row per
    // conversation, deduped by customer_key so repeats never inflate it).
    const topicIds = Array.from(
      new Set(
        rows
          .flatMap((r) => [r.topic_id, r.followup_topic_id])
          .filter(Boolean) as string[],
      ),
    );
    const countByTopic = new Map<string, number>();
    const fieldByTopic = new Map<string, string | null>();
    if (topicIds.length) {
      const { data: asks } = await admin
        .from("missing_info_asks")
        .select("topic_id, customer_key")
        .in("topic_id", topicIds);
      const seen = new Map<string, Set<string>>();
      for (const a of (asks ?? []) as any[]) {
        const set = seen.get(a.topic_id) ?? new Set<string>();
        set.add(a.customer_key as string);
        seen.set(a.topic_id, set);
      }
      for (const [t, set] of seen) countByTopic.set(t, set.size);

      const { data: topics } = await admin
        .from("missing_info_topics")
        .select("id, missing_field")
        .in("id", topicIds);
      for (const t of (topics ?? []) as any[]) {
        fieldByTopic.set(t.id as string, (t.missing_field as string | null) ?? null);
      }
    }

    return rows.map<NotificationRow>((r) => {
      const anyTopic = (r.topic_id as string | null) ?? (r.followup_topic_id as string | null);
      return {
        id: r.id,
        type: r.type,
        conversation_id: r.conversation_id,
        message: r.message ?? null,
        is_read: !!r.is_read,
        created_at: r.created_at,
        topic_id: (r.topic_id as string | null) ?? null,
        followup_topic_id: (r.followup_topic_id as string | null) ?? null,
        sent_count: r.sent_count == null ? null : Number(r.sent_count),
        alert_count: Number(r.alert_count ?? 1),
        priority: Number(r.priority ?? 1),
        customer_count: anyTopic ? countByTopic.get(anyTopic) ?? 0 : 0,
        missing_field: anyTopic ? fieldByTopic.get(anyTopic) ?? null : null,
      };
    });
  },
);

export const markNotificationRead = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { userId } = await requireUserId();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();

    // Ownership check: the notification's conversation → merchant → user.
    const { data: notif } = await admin
      .from("notifications")
      .select("id, conversation_id")
      .eq("id", data.id)
      .maybeSingle();
    if (!notif) throw new Error("Notification not found.");

    const { data: convo } = await admin
      .from("conversations")
      .select("merchant_id")
      .eq("id", (notif as any).conversation_id)
      .maybeSingle();
    if (!convo) throw new Error("Conversation not found.");

    const { data: m } = await admin
      .from("merchants")
      .select("user_id")
      .eq("id", (convo as any).merchant_id)
      .maybeSingle();
    if (!m || (m as any).user_id !== userId) throw new Error("Forbidden.");

    const { error } = await admin
      .from("notifications")
      .update({ is_read: true })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

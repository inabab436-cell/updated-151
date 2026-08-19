// Merchant-facing conversations list + per-conversation controls.
// Read/write server functions used by the dashboard messaging UI.
import { createServerFn } from "@tanstack/react-start";

export interface ConversationRow {
  id: string;
  merchant_id: string;
  status: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  customer_id: string | null;
  customer_name: string | null;
  visitor_number: number | null;
  agent_enabled: boolean;
  /** Customer picked a manual payment method and the agent is parked. */
  awaiting_payment: boolean;
}

export interface ConversationDetail {
  id: string;
  merchant_id: string;
  status: string | null;
  customer_id: string | null;
  customer_name: string | null;
  visitor_number: number | null;
  agent_enabled: boolean;
  awaiting_payment: boolean;
  agent_globally_disabled: boolean;

  messages: Array<{
    id: string;
    role: string;
    content: string;
    created_at: string;
    is_auto_followup: boolean;
    followup_topic_id: string | null;
  }>;
}


async function loadUserAdmin() {
  const { requireUserId } = await import("@/lib/session-guard.server");
  const { userId } = await requireUserId();
  const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
  return { userId, admin: getSupabaseAdmin() };
}

async function assertOwnedConversation(admin: any, userId: string, conversationId: string) {
  // NOTE: The `conversations.merchant_id` -> `merchants.id` foreign key is not
  // present in the live schema, so PostgREST cannot embed `merchants(...)`
  // ("Could not find a relationship between 'conversations' and 'merchants'").
  // Fetch the merchant with a separate query instead of relying on an embed.
  const { data, error } = await admin
    .from("conversations")
    .select("id, merchant_id, status, customer_id, agent_enabled")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("المحادثة غير موجودة.");
  const { data: merchant, error: mErr } = await admin
    .from("merchants")
    .select("id, user_id, agent_globally_disabled")
    .eq("id", (data as any).merchant_id)
    .maybeSingle();
  if (mErr) throw mErr;
  if (!merchant || merchant.user_id !== userId) throw new Error("غير مصرح.");
  return { ...(data as any), merchants: merchant } as any;
}

export const listConversations = createServerFn({ method: "GET" }).handler(
  async (): Promise<ConversationRow[]> => {
    const { userId, admin } = await loadUserAdmin();

    const { data: merchants } = await admin
      .from("merchants")
      .select("id")
      .eq("user_id", userId);
    const merchantIds = (merchants ?? []).map((m: any) => m.id as string);
    if (merchantIds.length === 0) return [];

    const { data: convos, error } = await admin
      .from("conversations")
      .select("id, merchant_id, status, created_at, customer_id, agent_enabled")
      .in("merchant_id", merchantIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (convos ?? []) as any[];
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id as string);
    const [msgsRes, custRes] = await Promise.all([
      admin
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(1000),
      (async () => {
        const cids = Array.from(
          new Set(rows.map((r) => r.customer_id).filter(Boolean) as string[]),
        );
        if (cids.length === 0) return { data: [] as any[] };
        return admin.from("customers").select("id, name").in("id", cids);
      })(),
    ]);
    const msgs = (msgsRes as any).data ?? [];
    const custs = (custRes as any).data ?? [];

    const lastByConvo = new Map<string, { created_at: string; content: string | null }>();
    for (const m of msgs as any[]) {
      const cid = m.conversation_id as string;
      if (!lastByConvo.has(cid)) {
        lastByConvo.set(cid, {
          created_at: m.created_at as string,
          content: (m.content as string | null) ?? null,
        });
      }
    }
    const nameByCust = new Map<string, string | null>();
    for (const c of custs as any[]) {
      nameByCust.set(c.id as string, (c.name as string | null) ?? null);
    }

    // Sequential visitor numbering per merchant, ascending by created_at,
    // for conversations that don't have a resolvable customer name.
    const asc = [...rows].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    const seqByConvo = new Map<string, number>();
    const perMerchantCounter = new Map<string, number>();
    for (const r of asc) {
      const cname = r.customer_id ? nameByCust.get(r.customer_id) ?? null : null;
      if (cname && cname.trim()) continue;
      const next = (perMerchantCounter.get(r.merchant_id) ?? 0) + 1;
      perMerchantCounter.set(r.merchant_id, next);
      seqByConvo.set(r.id as string, next);
    }

    // Conversations parked for payment. The status is the primary signal;
    // an open (unread) payment notification is the fallback for databases
    // where the status CHECK does not accept 'awaiting_payment' yet.
    const { data: payNotifs } = await admin
      .from("notifications")
      .select("conversation_id")
      .eq("type", "human_needed")
      .eq("is_read", false)
      .in("conversation_id", ids);
    const openPaymentNotif = new Set(
      ((payNotifs ?? []) as any[]).map((n) => n.conversation_id as string),
    );

    return rows.map<ConversationRow>((r) => {
      const last = lastByConvo.get(r.id as string) ?? null;
      const cname = r.customer_id ? nameByCust.get(r.customer_id) ?? null : null;
      const agentEnabled = r.agent_enabled !== false;
      return {
        id: r.id as string,
        merchant_id: r.merchant_id as string,
        status: (r.status as string | null) ?? null,
        created_at: r.created_at as string,
        last_message_at: last?.created_at ?? null,
        last_message_preview: last?.content ?? null,
        customer_id: (r.customer_id as string | null) ?? null,
        customer_name: cname,
        visitor_number: seqByConvo.get(r.id as string) ?? null,
        agent_enabled: agentEnabled,
        awaiting_payment:
          r.status === "awaiting_payment" ||
          (!agentEnabled && openPaymentNotif.has(r.id as string)),
      };
    });

  },
);

export const getConversationDetail = createServerFn({ method: "GET" })
  .inputValidator((d: { id: string }) => {
    if (!d || typeof d.id !== "string" || !d.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }): Promise<ConversationDetail> => {
    const { userId, admin } = await loadUserAdmin();
    const convo = await assertOwnedConversation(admin, userId, data.id);
    const [msgsRes, custRes] = await Promise.all([
      admin
        .from("messages")
        .select("id, role, content, created_at, is_auto_followup, followup_topic_id")
        .eq("conversation_id", data.id)
        .order("created_at", { ascending: true }),
      convo.customer_id
        ? admin.from("customers").select("id, name").eq("id", convo.customer_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const messages = ((msgsRes as any).data ?? []) as any[];
    const cname = ((custRes as any).data?.name as string | null) ?? null;

    // Visitor number derived from ascending order across same merchant.
    let visitor_number: number | null = null;
    if (!cname) {
      const { data: peers } = await admin
        .from("conversations")
        .select("id, created_at, customer_id")
        .eq("merchant_id", convo.merchant_id)
        .order("created_at", { ascending: true });
      const list = (peers ?? []) as any[];
      const cids = Array.from(
        new Set(list.map((p) => p.customer_id).filter(Boolean) as string[]),
      );
      const namedIds = new Set<string>();
      if (cids.length > 0) {
        const { data: cs } = await admin
          .from("customers")
          .select("id, name")
          .in("id", cids);
        for (const c of (cs ?? []) as any[]) {
          if (c.name && String(c.name).trim()) namedIds.add(c.id as string);
        }
      }
      let counter = 0;
      for (const p of list) {
        const hasName = p.customer_id && namedIds.has(p.customer_id);
        if (hasName) continue;
        counter += 1;
        if (p.id === data.id) {
          visitor_number = counter;
          break;
        }
      }
    }

    const { count: openPayNotifs } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", data.id)
      .eq("type", "human_needed")
      .eq("is_read", false);

    const agentEnabled = convo.agent_enabled !== false;

    return {
      id: convo.id,
      merchant_id: convo.merchant_id,
      status: convo.status ?? null,
      customer_id: convo.customer_id ?? null,
      customer_name: cname,
      visitor_number,
      agent_enabled: agentEnabled,
      awaiting_payment:
        convo.status === "awaiting_payment" || (!agentEnabled && (openPayNotifs ?? 0) > 0),
      agent_globally_disabled: !!convo.merchants?.agent_globally_disabled,

      messages: messages.map((m) => ({
        id: m.id as string,
        role: m.role as string,
        content: (m.content as string) ?? "",
        created_at: m.created_at as string,
        is_auto_followup: !!m.is_auto_followup,
        followup_topic_id: (m.followup_topic_id as string | null) ?? null,
      })),
    };
  });

export const setConversationAgent = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; enabled: boolean }) => {
    if (!d || typeof d.id !== "string") throw new Error("id required");
    if (typeof d.enabled !== "boolean") throw new Error("enabled required");
    return d;
  })
  .handler(async ({ data }) => {
    const { userId, admin } = await loadUserAdmin();
    await assertOwnedConversation(admin, userId, data.id);
    const { error } = await admin
      .from("conversations")
      .update({ agent_enabled: data.enabled })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

/**
 * "تأكيد الدفع واستئناف الوكيل" — clears the awaiting-payment hold so the
 * agent starts replying to that customer again.
 */
export const confirmPaymentAndResumeAgent = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d || typeof d.id !== "string" || !d.id) throw new Error("id required");
    return d;
  })
  .handler(async ({ data }) => {
    const { userId, admin } = await loadUserAdmin();
    const convo = await assertOwnedConversation(admin, userId, data.id);

    // Manual payment → the stock was NOT deducted at order creation. Confirming
    // the payment here must deduct it through the same atomic DB function the
    // orders page uses, BEFORE the agent is resumed.
    const { confirmPendingOrdersForConversation } = await import(
      "@/lib/order-payment.server"
    );
    const summary = await confirmPendingOrdersForConversation(admin, {
      conversationId: data.id,
      merchantId: convo.merchant_id as string,
    });
    if (!summary.ok) {
      // Nothing was deducted and the conversation stays parked.
      return {
        ok: false as const,
        error: summary.error ?? "unknown",
        shortages: summary.shortages,
        orderNumber: summary.orderNumber,
      };
    }

    // Un-park the conversation (status + agent toggle) and close the payment
    // notification. Verified + retried so a stale status CHECK can never leave
    // the agent asleep.
    const { resumeAgentAfterPaymentConfirmed } = await import("@/lib/agent-resume.server");
    await resumeAgentAfterPaymentConfirmed(admin, data.id);
    return {
      ok: true as const,
      confirmedOrders: summary.confirmed,
      alreadyConfirmed: summary.alreadyConfirmed,
    };
  });

export const sendMerchantReply = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; content: string }) => {
    if (!d || typeof d.id !== "string") throw new Error("id required");
    if (typeof d.content !== "string" || !d.content.trim())
      throw new Error("content required");
    return d;
  })
  .handler(async ({ data }) => {
    const { userId, admin } = await loadUserAdmin();
    await assertOwnedConversation(admin, userId, data.id);
    const { error } = await admin.from("messages").insert({
      conversation_id: data.id,
      role: "assistant",
      content: data.content.trim(),
    });
    if (error) throw error;
    return { ok: true };
  });

export interface MerchantAgentSettings {
  merchant_id: string | null;
  agent_globally_disabled: boolean;
}

export const getMerchantAgentSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<MerchantAgentSettings> => {
    const { userId, admin } = await loadUserAdmin();
    const { data } = await admin
      .from("merchants")
      .select("id, agent_globally_disabled")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    return {
      merchant_id: (data?.id as string | null) ?? null,
      agent_globally_disabled: !!data?.agent_globally_disabled,
    };
  },
);

export const setMerchantAgentGloballyDisabled = createServerFn({ method: "POST" })
  .inputValidator((d: { disabled: boolean }) => {
    if (typeof d?.disabled !== "boolean") throw new Error("disabled required");
    return d;
  })
  .handler(async ({ data }) => {
    const { userId, admin } = await loadUserAdmin();
    const { error } = await admin
      .from("merchants")
      .update({ agent_globally_disabled: data.disabled })
      .eq("user_id", userId);
    if (error) throw error;
    return { ok: true };
  });

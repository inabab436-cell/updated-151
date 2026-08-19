/**
 * Manual-payment handover for storefront orders.
 *
 * Reuses the EXISTING payment mechanism (no new payment system):
 *   * auto methods   → nothing happens here, the order flow ends normally.
 *   * manual methods → the conversation the agent already uses is parked in
 *     `awaiting_payment` with `agent_enabled: false` (the same hard stop the
 *     chat agent applies), a payment notification is raised for the merchant,
 *     and the order is linked to that conversation so the agent/merchant can
 *     read the FULL order details from the system.
 *
 * The customer-visible chat message contains ONLY the payment sentence — never
 * the order lines, address or totals; those stay in the order data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const DEFAULT_MANUAL_HANDOVER_MESSAGE =
  "تمام يا فندم، فاضل بس إتمام الدفع لتأكيد الأوردر.";

function newSessionToken(): string {
  const c: Crypto | undefined = typeof crypto !== "undefined" ? (crypto as Crypto) : undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * The single short sentence the customer sees in the chat. Falls back to the
 * default wording, collapses whitespace and caps the length so a merchant
 * template can never turn into a wall of order details.
 */
export function buildHandoverChatMessage(confirmationMessage?: string | null): string {
  const text = String(confirmationMessage ?? "").replace(/\s+/g, " ").trim();
  const base = text.length > 0 ? text : DEFAULT_MANUAL_HANDOVER_MESSAGE;
  return base.slice(0, 400);
}

export async function findOrCreateCustomerConversation(
  admin: SupabaseClient,
  opts: { merchantId: string; customerId: string | null; visitorId: string | null },
): Promise<string | null> {
  const { merchantId, customerId, visitorId } = opts;
  try {
    if (customerId) {
      const { data } = await admin
        .from("conversations")
        .select("id")
        .eq("merchant_id", merchantId)
        .eq("customer_id", customerId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((data as any)?.id) return String((data as any).id);
    }
    if (visitorId) {
      const { data } = await admin
        .from("conversations")
        .select("id")
        .eq("merchant_id", merchantId)
        .eq("session_token", visitorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if ((data as any)?.id) return String((data as any).id);
    }
    const { data: created, error } = await admin
      .from("conversations")
      .insert({
        merchant_id: merchantId,
        session_token: visitorId || newSessionToken(),
        status: "active",
        customer_id: customerId,
      })
      .select("id")
      .single();
    if (error) throw error;
    return String((created as any).id);
  } catch {
    return null;
  }
}

/**
 * Parks the conversation for manual payment exactly like the chat agent does
 * and links the order to it. Returns the conversation id when the handover
 * succeeded, otherwise null (the order itself is never rolled back here).
 */
export async function handoverForManualPayment(
  admin: SupabaseClient,
  opts: {
    merchantId: string;
    customerId: string | null;
    visitorId: string | null;
    orderNumber: string;
    paymentMethodName: string | null;
    confirmationMessage: string;
  },
): Promise<string | null> {
  const conversationId = await findOrCreateCustomerConversation(admin, opts);
  if (!conversationId) return null;

  // Only the payment sentence reaches the customer.
  try {
    await admin.from("messages").insert({
      conversation_id: conversationId,
      role: "assistant",
      content: buildHandoverChatMessage(opts.confirmationMessage),
    });
  } catch { /* non-fatal */ }

  // Same hard stop the chat flow uses: status + agent_enabled false.
  const { error: parkErr } = await admin
    .from("conversations")
    .update({ status: "awaiting_payment", agent_enabled: false })
    .eq("id", conversationId);
  if (parkErr) {
    try {
      await admin.from("conversations").update({ agent_enabled: false }).eq("id", conversationId);
    } catch { /* non-fatal */ }
  }

  try {
    await admin.from("notifications").insert({
      type: "human_needed",
      conversation_id: conversationId,
      message: `عميل بانتظار استكمال الدفع (${opts.paymentMethodName ?? "دفع يدوي"}) — الطلب ${opts.orderNumber}`,
      is_read: false,
    });
  } catch { /* non-fatal */ }

  // Link the order so the agent/merchant can open its full details.
  try {
    await admin
      .from("orders")
      .update({ conversation_id: conversationId })
      .eq("order_number", opts.orderNumber)
      .eq("merchant_id", opts.merchantId);
  } catch { /* non-fatal */ }

  return conversationId;
}

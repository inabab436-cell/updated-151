/**
 * Orders server functions for cupai.
 *
 * - listOrders: current merchant's orders (newest first).
 * - getOrderStatusMessages / setOrderStatusMessages: per-merchant editable
 *   templates for the "shipped" and "delivered" chat messages.
 * - updateOrderStatus: transitions an order to shipped/delivered, stamps the
 *   timestamp, and posts an Arabic status message into the order's chat
 *   conversation on behalf of the assistant.
 */
import { createServerFn } from "@tanstack/react-start";

export const DEFAULT_SHIPPED_MESSAGE = "تم شحن طلبك وهيوصلك قريب 🚚❤️";
export const DEFAULT_PREPARED_MESSAGE = "تم تجهيز طلبك وجاري تسليمه لشركة الشحن 📦✨";
export const DEFAULT_DELIVERED_MESSAGE =
  "أهلاً بحضرتك ❤️ بنطمن إن الطلب وصل، ياريت لو حابب تشاركنا رأيك أو أي ملاحظات — تجربتك بتفرق معانا جداً.";

export interface OrderItem {
  product_name: string | null;
  color: string | null;
  size: string | null;
  quantity: number | null;
  price?: number | null;
  unit_price?: number | null;
  line_total?: number | null;
  currency?: string | null;
}

export interface OrderRow {
  id: string;
  order_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  status: string;
  items: OrderItem[];
  notes: string | null;
  created_at: string;
  prepared_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  conversation_id: string | null;
  payment_method: string | null;
  /** 'pending' = manual payment not confirmed yet → no stock deducted. */
  payment_status: string;
  payment_confirmed_at: string | null;
  /** Final value of the order: products − discount + shipping. */
  total_price: number | null;
  subtotal_price: number | null;
  discount_amount: number | null;
  shipping_cost: number | null;
}



async function getMerchantId(userId: string): Promise<string | null> {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("merchants")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as any)?.id ?? null;
}

// ---------- LIST ----------------------------------------------------------
export const listOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<OrderRow[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const merchantId = await getMerchantId(userId);
    if (!merchantId) return [];
    const admin = getSupabaseAdmin();
    // `*` so the optional amount-breakdown columns are included when the
    // database has them, without failing on older databases that don't.
    const { data, error } = await admin
      .from("orders")
      .select("*")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data ?? []).map((r: any) => ({
      ...r,
      items: Array.isArray(r.items) ? r.items : [],
      payment_status: r.payment_status ?? "confirmed",
      total_price: r.total_price ?? null,
      subtotal_price: r.subtotal_price ?? null,
      discount_amount: r.discount_amount ?? null,
      shipping_cost: r.shipping_cost ?? null,
    })) as OrderRow[];
  },
);

// ---------- CONFIRM MANUAL PAYMENT ---------------------------------------
/**
 * Merchant confirms a manual payment. The DB re-verifies the LATEST stock and
 * deducts it inside one transaction. Idempotent: an already-confirmed order is
 * a no-op, so double clicks can never deduct twice.
 */
export const confirmOrderPayment = createServerFn({ method: "POST" })
  .inputValidator((v: { id: string }) => v)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; alreadyConfirmed?: boolean }
      | { ok: false; error: "insufficient_stock"; shortages: OrderItem[] }
    > => {
      const { requireUserId } = await import("@/lib/session-guard.server");
      const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { userId } = await requireUserId();
      const merchantId = await getMerchantId(userId);
      if (!merchantId) throw new Error("لا يوجد متجر مرتبط بحسابك.");
      const admin = getSupabaseAdmin();
      const { data: res, error } = await admin.rpc("confirm_order_payment", {
        p_order_id: data.id,
        p_merchant_id: merchantId,
      });
      if (error) throw new Error(error.message);
      const r = (res ?? {}) as any;
      if (r.ok === false) {
        if (r.error === "insufficient_stock") {
          return {
            ok: false,
            error: "insufficient_stock",
            shortages: Array.isArray(r.shortages) ? r.shortages : [],
          };
        }
        throw new Error(r.error === "cancelled" ? "الطلب ملغي." : "الطلب غير موجود.");
      }
      // The offer/discount is counted for this customer ONLY now, after the
      // merchant confirmed the payment of the order. Newer databases do this
      // inside the same transaction as the stock deduction (offers_handled);
      // older ones are covered by the identical application-side pass.
      if (r.offers_handled !== true) {
        const { recordOfferRedemptionsForOrders } = await import(
          "@/lib/offer-redemptions.server"
        );
        await recordOfferRedemptionsForOrders(admin, {
          merchantId,
          orderIds: [String(data.id)],
        });
      }
      // Confirming the payment from the orders page must wake the agent up in
      // the linked conversation too — exactly like the conversation button.
      try {
        const { data: ord } = await admin
          .from("orders")
          .select("conversation_id")
          .eq("id", data.id)
          .maybeSingle();
        const convoId = (ord as any)?.conversation_id as string | null;
        if (convoId) {
          const { resumeAgentAfterPaymentConfirmed } = await import("@/lib/agent-resume.server");
          await resumeAgentAfterPaymentConfirmed(admin, convoId);
        }
      } catch {
        /* non-fatal: the payment itself is already confirmed */
      }
      return { ok: true, alreadyConfirmed: Boolean(r.already_confirmed) };


    },
  );


// ---------- STATUS UPDATE ------------------------------------------------
export const updateOrderStatus = createServerFn({ method: "POST" })
  .inputValidator((v: { id: string; status: "prepared" | "shipped" | "delivered" }) => v)
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const merchantId = await getMerchantId(userId);
    if (!merchantId) throw new Error("لا يوجد متجر مرتبط بحسابك.");
    const admin = getSupabaseAdmin();

    const { data: order, error: oErr } = await admin
      .from("orders")
      .select("id, conversation_id, merchant_id, status, payment_status")
      .eq("id", data.id)
      .maybeSingle();
    if (oErr) throw new Error(oErr.message);
    if (!order || (order as any).merchant_id !== merchantId) {
      throw new Error("الطلب غير موجود.");
    }

    const { canStartFulfillment, PAYMENT_REQUIRED_MESSAGE } = await import("@/lib/order-status-gate");
    if (!canStartFulfillment((order as any).payment_status)) {
      throw new Error(PAYMENT_REQUIRED_MESSAGE);
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = { status: data.status };
    if (data.status === "prepared") patch.prepared_at = nowIso;
    if (data.status === "shipped") patch.shipped_at = nowIso;
    if (data.status === "delivered") patch.delivered_at = nowIso;

    const { error: uErr } = await admin.from("orders").update(patch).eq("id", data.id);
    if (uErr) throw new Error(uErr.message);

    // Fetch the merchant's custom template + enable flags.
    const { data: tmpl } = await admin
      .from("order_status_messages")
      .select("*")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    const t = tmpl as Record<string, unknown> | null;

    const enabledKey =
      data.status === "prepared"
        ? "prepared_enabled"
        : data.status === "shipped"
          ? "shipped_enabled"
          : "delivered_enabled";
    const messageKey =
      data.status === "prepared"
        ? "prepared_message"
        : data.status === "shipped"
          ? "shipped_message"
          : "delivered_message";
    const fallbackMessage =
      data.status === "prepared"
        ? DEFAULT_PREPARED_MESSAGE
        : data.status === "shipped"
          ? DEFAULT_SHIPPED_MESSAGE
          : DEFAULT_DELIVERED_MESSAGE;

    const enabled = t == null ? true : Boolean(t[enabledKey] ?? true);
    const stored = t == null ? null : ((t[messageKey] ?? null) as string | null);
    const message = (stored === null || stored === undefined ? fallbackMessage : stored).trim();

    const convId = (order as any).conversation_id as string | null;
    if (convId && enabled && message) {
      await admin.from("messages").insert({
        conversation_id: convId,
        role: "assistant",
        content: message,
      });
    }
    return { ok: true, messageSent: Boolean(convId && enabled && message) };
  });

// ---------- STATUS MESSAGE TEMPLATES ------------------------------------
export interface StatusMessagesSettings {
  prepared: string;
  shipped: string;
  delivered: string;
  preparedEnabled: boolean;
  shippedEnabled: boolean;
  deliveredEnabled: boolean;
}

export const getOrderStatusMessages = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatusMessagesSettings> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const merchantId = await getMerchantId(userId);
    const fallback: StatusMessagesSettings = {
      prepared: DEFAULT_PREPARED_MESSAGE,
      shipped: DEFAULT_SHIPPED_MESSAGE,
      delivered: DEFAULT_DELIVERED_MESSAGE,
      preparedEnabled: true,
      shippedEnabled: true,
      deliveredEnabled: true,
    };
    if (!merchantId) return fallback;
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from("order_status_messages")
      .select("*")
      .eq("merchant_id", merchantId)
      .maybeSingle();
    const t = data as Record<string, unknown> | null;
    if (!t) return fallback;
    return {
      prepared: (t.prepared_message as string | null) ?? DEFAULT_PREPARED_MESSAGE,
      shipped: (t.shipped_message as string | null) ?? DEFAULT_SHIPPED_MESSAGE,
      delivered: (t.delivered_message as string | null) ?? DEFAULT_DELIVERED_MESSAGE,
      preparedEnabled: Boolean(t.prepared_enabled ?? true),
      shippedEnabled: Boolean(t.shipped_enabled ?? true),
      deliveredEnabled: Boolean(t.delivered_enabled ?? true),
    };
  },
);

export const setOrderStatusMessages = createServerFn({ method: "POST" })
  .inputValidator(
    (v: {
      prepared?: string;
      shipped: string;
      delivered: string;
      preparedEnabled?: boolean;
      shippedEnabled?: boolean;
      deliveredEnabled?: boolean;
    }) => v,
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const merchantId = await getMerchantId(userId);
    if (!merchantId) throw new Error("لا يوجد متجر مرتبط بحسابك.");
    const admin = getSupabaseAdmin();
    // Empty text is allowed: it means the message was deleted → nothing is sent.
    const shipped = String(data.shipped ?? "").trim();
    const delivered = String(data.delivered ?? "").trim();
    const prepared = String(data.prepared ?? DEFAULT_PREPARED_MESSAGE).trim();
    if (shipped.length > 1000 || delivered.length > 1000 || prepared.length > 1000) {
      throw new Error("النصوص طويلة جداً.");
    }
    const { error } = await admin
      .from("order_status_messages")
      .upsert(
        {
          merchant_id: merchantId,
          prepared_message: prepared,
          shipped_message: shipped,
          delivered_message: delivered,
          prepared_enabled: data.preparedEnabled ?? true,
          shipped_enabled: data.shippedEnabled ?? true,
          delivered_enabled: data.deliveredEnabled ?? true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "merchant_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- CANCEL + RESTOCK ---------------------------------------------
/**
 * Cancels an order and returns exactly the quantities that were deducted at
 * creation time back to product_variants — atomically, inside one DB
 * transaction. Idempotent: cancelling twice restocks only once. It changes
 * nothing else about the order lifecycle (shipped/delivered flows untouched).
 */
export const cancelOrder = createServerFn({ method: "POST" })
  .inputValidator((v: { id: string }) => v)
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const merchantId = await getMerchantId(userId);
    if (!merchantId) throw new Error("لا يوجد متجر مرتبط بحسابك.");
    const admin = getSupabaseAdmin();
    const { data: res, error } = await admin.rpc("cancel_order_restock", {
      p_order_id: data.id,
      p_merchant_id: merchantId,
    });
    if (error) throw new Error(error.message);
    if ((res as any)?.ok === false) throw new Error("الطلب غير موجود.");
    return { ok: true };
  });

/**
 * Public server functions for the storefront customer OTP login system.
 *
 * These are the ONLY endpoints the storefront/chat UI uses for customer
 * authentication. They never touch the merchant auth system.
 */
import { createServerFn } from "@tanstack/react-start";

import type {
  CustomerOtpSendResult,
  CustomerOtpVerifyResult,
  CustomerSessionInfo,
} from "@/lib/customer-auth-types";

function ensureUuid(value: unknown, label: string): string {
  const s = String(value ?? "").trim();
  if (!/^[0-9a-f-]{16,}$/i.test(s)) {
    throw new Error(`${label} غير صالح.`);
  }
  return s;
}
function ensureEmail(value: unknown): string {
  const s = String(value ?? "").trim().toLowerCase();
  if (!s.includes("@") || s.length > 200) throw new Error("يرجى إدخال بريد إلكتروني صالح.");
  return s;
}
function ensureCode(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!/^\d{6}$/.test(s)) throw new Error("الرمز يجب أن يتكوّن من ٦ أرقام.");
  return s;
}

export const requestCustomerOtp = createServerFn({ method: "POST" })
  .inputValidator((data: { merchant_id: string; email: string }) => ({
    merchant_id: ensureUuid(data?.merchant_id, "merchant_id"),
    email: ensureEmail(data?.email),
  }))
  .handler(async ({ data }): Promise<CustomerOtpSendResult> => {
    const { sendCustomerOtp } = await import("@/lib/customer-auth.server");
    return sendCustomerOtp(data.merchant_id, data.email);
  });

export const verifyCustomerOtp = createServerFn({ method: "POST" })
  .inputValidator((data: {
    merchant_id: string;
    email: string;
    code: string;
    visitor_id?: string | null;
  }) => ({
    merchant_id: ensureUuid(data?.merchant_id, "merchant_id"),
    email: ensureEmail(data?.email),
    code: ensureCode(data?.code),
    visitor_id: data?.visitor_id ? String(data.visitor_id) : null,
  }))
  .handler(async ({ data }): Promise<CustomerOtpVerifyResult> => {
    const { verifyCustomerOtpAndLogin } = await import("@/lib/customer-auth.server");
    return verifyCustomerOtpAndLogin(
      data.merchant_id,
      data.email,
      data.code,
      data.visitor_id,
    );
  });

export const getCustomerSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerSessionInfo> => {
    const { getCurrentCustomerSession } = await import("@/lib/customer-auth.server");
    const s = await getCurrentCustomerSession();
    if (!s) {
      return {
        loggedIn: false,
        email: null,
        customerId: null,
        merchantId: null,
        sessionId: null,
        expiresAt: null,
      };
    }
    return {
      loggedIn: true,
      email: s.email,
      customerId: s.customerId,
      merchantId: s.merchantId,
      sessionId: s.sessionId,
      expiresAt: s.expiresAt,
    };
  },
);

export const logoutCustomer = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutCurrentCustomer } = await import("@/lib/customer-auth.server");
  await logoutCurrentCustomer();
  return { ok: true as const };
});

export const logoutCustomerAllDevices = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutAllCustomerSessions } = await import("@/lib/customer-auth.server");
  const revoked = await logoutAllCustomerSessions();
  return { ok: true as const, revoked };
});

export interface CustomerConversationRow {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message: string | null;
  message_count: number;
}

export interface CustomerOrderRow {
  id: string;
  order_number: string | null;
  status: string;
  total_price: number | null;
  created_at: string;
  item_count: number;
}

export const listCustomerConversations = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerConversationRow[]> => {
    const { getCurrentCustomerSession } = await import("@/lib/customer-auth.server");
    const s = await getCurrentCustomerSession();
    if (!s) throw new Error("Not logged in.");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const { data: convs, error } = await admin
      .from("conversations")
      .select("id, status, created_at, updated_at")
      .eq("customer_id", s.customerId)
      .eq("merchant_id", s.merchantId)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    const ids = (convs ?? []).map((c: any) => c.id as string);
    let last: Record<string, { content: string; created_at: string }> = {};
    let counts: Record<string, number> = {};
    if (ids.length) {
      const { data: msgs } = await admin
        .from("messages")
        .select("conversation_id, content, created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false });
      for (const m of msgs ?? []) {
        const cid = (m as any).conversation_id as string;
        counts[cid] = (counts[cid] ?? 0) + 1;
        if (!last[cid]) {
          last[cid] = {
            content: String((m as any).content ?? ""),
            created_at: String((m as any).created_at ?? ""),
          };
        }
      }
    }
    return (convs ?? []).map((c: any) => ({
      id: c.id as string,
      status: String(c.status ?? "active"),
      created_at: String(c.created_at),
      updated_at: String(c.updated_at),
      last_message: last[c.id as string]?.content ?? null,
      message_count: counts[c.id as string] ?? 0,
    }));
  },
);

export const listCustomerOrders = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerOrderRow[]> => {
    const { getCurrentCustomerSession } = await import("@/lib/customer-auth.server");
    const s = await getCurrentCustomerSession();
    if (!s) throw new Error("Not logged in.");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("orders")
      .select("id, order_number, status, total_price, created_at, items")
      .eq("customer_id", s.customerId)
      .eq("merchant_id", s.merchantId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return (data ?? []).map((o: any) => ({
      id: o.id as string,
      order_number: (o.order_number as string | null) ?? null,
      status: String(o.status ?? "new"),
      total_price: o.total_price == null ? null : Number(o.total_price),
      created_at: String(o.created_at),
      item_count: Array.isArray(o.items) ? o.items.length : 0,
    }));
  },
);
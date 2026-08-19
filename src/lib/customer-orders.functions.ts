/**
 * Customer-facing order area server functions.
 *
 * Every handler resolves the CURRENT customer session cookie first and scopes
 * all queries to (customer_id, merchant_id) of that session, so a customer can
 * never read another customer's drafts or orders.
 */
import { createServerFn } from "@tanstack/react-start";

export interface CustomerOrderItem {
  product_name: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  price: number | null;
  currency: string | null;
}

export interface CustomerOrderDetail {
  id: string;
  order_number: string | null;
  status: string;
  payment_status: string;
  payment_method: string | null;
  total_price: number | null;
  currency: string | null;
  items: CustomerOrderItem[];
  notes: string | null;
  created_at: string;
  prepared_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  payment_confirmed_at: string | null;
  conversation_id: string | null;
}

export interface CustomerDraftLine {
  productId: string;
  name: string;
  price: number | null;
  currency: string | null;
  quantity: number;
  image?: string | null;
  color?: string | null;
  size?: string | null;
}

export interface CustomerDraft {
  items: CustomerDraftLine[];
  notes: string | null;
  updated_at: string;
}

async function requireCustomer() {
  const { getCurrentCustomerSession } = await import("@/lib/customer-auth.server");
  const s = await getCurrentCustomerSession();
  if (!s) throw new Error("Not logged in.");
  return s;
}

function normalizeLines(raw: unknown): CustomerDraftLine[] {
  if (!Array.isArray(raw)) return [];
  const mapped = raw
    .map((l) => {
      const it = (l ?? {}) as Record<string, unknown>;
      const name = String(it.name ?? it.product_name ?? "").trim();
      if (!name) return null;
      const qty = Math.max(1, Math.floor(Number(it.quantity) || 1));
      const line: CustomerDraftLine = {
        productId: String(it.productId ?? it.product_id ?? ""),
        name,
        price: it.price == null ? null : Number(it.price),
        currency: it.currency == null ? null : String(it.currency),
        quantity: qty,
        image: it.image == null ? null : String(it.image),
        color: it.color == null ? null : String(it.color),
        size: it.size == null ? null : String(it.size),
      };
      return line;
    });
  return mapped.filter((l): l is CustomerDraftLine => l !== null).slice(0, 100);
}

/** All orders of the signed-in customer with the full detail the UI shows. */
export const listCustomerOrdersDetailed = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerOrderDetail[]> => {
    const s = await requireCustomer();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("orders")
      .select(
        "id, order_number, status, payment_status, payment_method, total_price, items, notes, created_at, prepared_at, shipped_at, delivered_at, payment_confirmed_at, conversation_id",
      )
      .eq("customer_id", s.customerId)
      .eq("merchant_id", s.merchantId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);

    return (data ?? []).map((o: any) => {
      const items: CustomerOrderItem[] = Array.isArray(o.items)
        ? o.items.map((it: any) => ({
            product_name: (it?.product_name ?? it?.name ?? null) as string | null,
            color: it?.color ?? null,
            size: it?.size ?? null,
            quantity: Math.max(1, Math.floor(Number(it?.quantity) || 1)),
            price: it?.price == null ? null : Number(it.price),
            currency: it?.currency == null ? null : String(it.currency),
          }))
        : [];
      const currency = items.find((i) => i.currency)?.currency ?? null;
      return {
        id: String(o.id),
        order_number: (o.order_number as string | null) ?? null,
        status: String(o.status ?? "new"),
        payment_status: String(o.payment_status ?? "confirmed"),
        payment_method: (o.payment_method as string | null) ?? null,
        total_price: o.total_price == null ? null : Number(o.total_price),
        currency,
        items,
        notes: (o.notes as string | null) ?? null,
        created_at: String(o.created_at),
        prepared_at: (o.prepared_at as string | null) ?? null,
        shipped_at: (o.shipped_at as string | null) ?? null,
        delivered_at: (o.delivered_at as string | null) ?? null,
        payment_confirmed_at: (o.payment_confirmed_at as string | null) ?? null,
        conversation_id: (o.conversation_id as string | null) ?? null,
      };
    });
  },
);

/** The signed-in customer's in-progress (incomplete) order, if any. */
export const getCustomerDraft = createServerFn({ method: "GET" }).handler(
  async (): Promise<CustomerDraft | null> => {
    const s = await requireCustomer();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("order_drafts")
      .select("items, notes, updated_at")
      .eq("customer_id", s.customerId)
      .eq("merchant_id", s.merchantId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const items = normalizeLines((data as any).items);
    if (items.length === 0) return null;
    return {
      items,
      notes: ((data as any).notes as string | null) ?? null,
      updated_at: String((data as any).updated_at),
    };
  },
);

/** Upserts the in-progress cart. Empty cart → the draft is removed. */
export const saveCustomerDraft = createServerFn({ method: "POST" })
  .inputValidator((v: { items: CustomerDraftLine[]; notes?: string | null }) => v)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const s = await requireCustomer();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    const items = normalizeLines(data?.items);
    if (items.length === 0) {
      await admin
        .from("order_drafts")
        .delete()
        .eq("customer_id", s.customerId)
        .eq("merchant_id", s.merchantId);
      return { ok: true };
    }
    const { error } = await admin.from("order_drafts").upsert(
      {
        merchant_id: s.merchantId,
        customer_id: s.customerId,
        items,
        notes: (data?.notes ?? null) as string | null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "merchant_id,customer_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Called after a successful checkout: the draft is no longer incomplete. */
export const clearCustomerDraft = createServerFn({ method: "POST" }).handler(
  async (): Promise<{ ok: true }> => {
    const s = await requireCustomer();
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const admin = getSupabaseAdmin();
    await admin
      .from("order_drafts")
      .delete()
      .eq("customer_id", s.customerId)
      .eq("merchant_id", s.merchantId);
    return { ok: true };
  },
);

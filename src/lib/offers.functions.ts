/**
 * Offers & discounts — dashboard server functions.
 *
 * Time is the source of truth: an offer stops applying the moment its window
 * ends, with no extra action from the merchant. The one-time broadcast message
 * is sent only when `notify_enabled` is on and a message exists; turning it off
 * silences every message while the discount keeps working normally.
 */
import { createServerFn } from "@tanstack/react-start";

import type { DiscountType, OfferRow, OfferScope, UsageLimitType } from "@/lib/offers.server";
import { DEFAULT_OFFER_BROADCAST, OFFER_PLACEHOLDERS } from "@/lib/offers.server";

export type { OfferRow, OfferScope, DiscountType, UsageLimitType };
export { DEFAULT_OFFER_BROADCAST, OFFER_PLACEHOLDERS };

/** One customer who actually benefited from the offer (payment confirmed). */
export interface OfferBeneficiary {
  id: string;
  conversation_id: string | null;
  order_total: number | null;
  created_at: string;
  /** How many times this same customer used the offer. */
  uses: number;
}

export interface OfferDTO extends OfferRow {
  /** Resolved product name for product-scoped offers. */
  product_name: string | null;
  /** Computed against the real current time at read time. */
  state: "live" | "scheduled" | "ended";
  /** Customers counted only after the merchant confirmed their payment. */
  beneficiaries: OfferBeneficiary[];
  /** Total number of times the offer was used (all customers). */
  use_count: number;
}

export interface OfferInput {
  id?: string | null;
  title: string;
  description?: string | null;
  scope: OfferScope;
  product_id?: string | null;
  discount_type: DiscountType;
  discount_value: number;
  coupon_code?: string | null;
  min_order_total?: number | null;
  max_redemptions?: number | null;
  usage_limit_type?: UsageLimitType;
  starts_at?: string | null;
  ends_at?: string | null;
  is_active?: boolean;
  notify_enabled?: boolean;
  notify_message?: string | null;
}

export const listOffers = createServerFn({ method: "GET" }).handler(
  async (): Promise<OfferDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mapOfferRow, isLive, hasEnded } = await import("@/lib/offers.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("offers")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = ((data ?? []) as Record<string, unknown>[]).map(mapOfferRow);
    const ids = rows.map((r) => r.product_id).filter(Boolean) as string[];
    const names = new Map<string, string>();
    if (ids.length) {
      const { data: prods } = await admin.from("products").select("id, name").in("id", ids);
      for (const p of (prods ?? []) as any[]) names.set(String(p.id), String(p.name ?? ""));
    }

    // Beneficiaries: recorded only after a payment was confirmed.
    const byOffer = new Map<string, OfferBeneficiary[]>();
    const usesByOffer = new Map<string, number>();
    if (rows.length) {
      const { data: reds } = await admin
        .from("offer_redemptions")
        .select("id, offer_id, conversation_id, order_total, created_at, customer_key, order_id")
        .in("offer_id", rows.map((r) => r.id))
        .order("created_at", { ascending: false });
      const seen = new Map<string, Set<string>>();
      for (const r of ((reds ?? []) as any[])) {
        const key = String(r.offer_id);
        usesByOffer.set(key, (usesByOffer.get(key) ?? 0) + 1);
        // One entry per unique customer: beneficiaries ≠ uses.
        const customerKey = String(r.customer_key ?? r.order_id ?? r.id);
        const set = seen.get(key) ?? new Set<string>();
        if (set.has(customerKey)) {
          const existing = (byOffer.get(key) ?? []).find((b) => b.id === `${key}:${customerKey}`);
          if (existing) existing.uses += 1;
          continue;
        }
        set.add(customerKey);
        seen.set(key, set);
        const list = byOffer.get(key) ?? [];
        list.push({
          id: `${key}:${customerKey}`,
          conversation_id: r.conversation_id ? String(r.conversation_id) : null,
          order_total: r.order_total == null ? null : Number(r.order_total),
          created_at: String(r.created_at),
          uses: 1,
        });
        byOffer.set(key, list);
      }
    }

    const now = Date.now();
    return rows.map((o) => ({
      ...o,
      product_name: o.product_id ? names.get(o.product_id) ?? null : null,
      state: isLive(o, now) ? "live" : hasEnded(o, now) ? "ended" : "scheduled",
      beneficiaries: byOffer.get(o.id) ?? [],
      use_count: usesByOffer.get(o.id) ?? o.redemption_count,
    }));
  },
);

export const saveOffer = createServerFn({ method: "POST" })
  .inputValidator((v: OfferInput) => v)
  .handler(async ({ data }): Promise<{ ok: true; id: string; notified: number }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { mapOfferRow, isLive, buildBroadcastMessage } = await import("@/lib/offers.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const title = String(data.title ?? "").trim();
    if (!title) throw new Error("اكتب اسم العرض.");
    const scope: OfferScope = data.scope === "all" ? "all" : "product";
    if (scope === "product" && !data.product_id) throw new Error("اختر المنتج الخاص بالعرض.");
    const value = Number(data.discount_value);
    if (!Number.isFinite(value) || value <= 0) throw new Error("اكتب قيمة خصم صحيحة.");
    if (data.discount_type === "percent" && value > 100) {
      throw new Error("نسبة الخصم لا يمكن أن تتجاوز 100%.");
    }
    const startsAt = data.starts_at ? new Date(data.starts_at).toISOString() : new Date().toISOString();
    const endsAt = data.ends_at ? new Date(data.ends_at).toISOString() : null;
    if (endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
      throw new Error("تاريخ انتهاء العرض يجب أن يكون بعد تاريخ البداية.");
    }

    const row = {
      user_id: userId,
      title,
      description: String(data.description ?? "").trim() || null,
      scope,
      product_id: scope === "product" ? data.product_id : null,
      discount_type: data.discount_type === "amount" ? "amount" : "percent",
      discount_value: value,
      coupon_code: String(data.coupon_code ?? "").trim() || null,
      min_order_total:
        data.min_order_total == null || data.min_order_total === ("" as unknown)
          ? null
          : Number(data.min_order_total),
      max_redemptions:
        data.max_redemptions == null || data.max_redemptions === ("" as unknown)
          ? null
          : Math.max(1, Math.floor(Number(data.max_redemptions))),
      usage_limit_type:
        data.usage_limit_type === "once_per_customer" ? "once_per_customer" : "per_order",
      starts_at: startsAt,
      ends_at: endsAt,
      is_active: data.is_active !== false,
      notify_enabled: data.notify_enabled === true,
      notify_message: String(data.notify_message ?? "").trim() || null,
      updated_at: new Date().toISOString(),
    };

    let id = String(data.id ?? "").trim();
    if (id) {
      const { error } = await admin.from("offers").update(row).eq("id", id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: ins, error } = await admin.from("offers").insert(row).select("*").single();
      if (error) throw new Error(error.message);
      id = String((ins as any).id);
    }

    // ---- One-time broadcast ------------------------------------------------
    // The offer is RE-EVALUATED from the saved row after every edit: if the
    // edit made it unusable (ended, inactive, or its customer limit already
    // reached), no message is sent — turning the toggle on later can never
    // resurrect a dead offer.
    const { data: saved } = await admin.from("offers").select("*").eq("id", id).maybeSingle();
    const offer = saved ? mapOfferRow(saved as Record<string, unknown>) : null;
    let notified = 0;
    const usable = !!offer && isLive(offer);
    if (offer && offer.notify_enabled && !offer.notified_at && usable) {
      const { data: merchants } = await admin.from("merchants").select("id").eq("user_id", userId);
      const merchantIds = (merchants ?? []).map((m: any) => String(m.id));
      if (merchantIds.length) {
        const { data: convos } = await admin
          .from("conversations")
          .select("id")
          .in("merchant_id", merchantIds);
        let pname: string | null = null;
        if (offer.product_id) {
          const { data: p } = await admin
            .from("products")
            .select("name")
            .eq("id", offer.product_id)
            .maybeSingle();
          pname = p ? String((p as any).name ?? "") : null;
        }
        const text = buildBroadcastMessage(offer.notify_message, offer, null, pname);
        const rows = ((convos ?? []) as any[]).map((c) => ({
          conversation_id: String(c.id),
          role: "assistant",
          content: text,
        }));
        if (rows.length && text) {
          const { error: mErr } = await admin.from("messages").insert(rows);
          if (!mErr) notified = rows.length;
        }
      }
      await admin.from("offers").update({ notified_at: new Date().toISOString() }).eq("id", id);
    }

    return { ok: true, id, notified };
  });

export const deleteOffer = createServerFn({ method: "POST" })
  .inputValidator((v: { id: string }) => v)
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("offers")
      .delete()
      .eq("id", String(data.id))
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

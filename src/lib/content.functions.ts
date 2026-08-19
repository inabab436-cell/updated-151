/**
 * CRUD server functions for policies, shipping rates, contact info,
 * and unclassified items. All operations are scoped to the current user.
 */
import { createServerFn } from "@tanstack/react-start";

function invalid(msg: string): never {
  throw new Error(msg);
}

// ---------- POLICIES ----------
export interface PolicyDTO {
  id: string; kind: string; title: string; content: string;
  created_at: string; updated_at: string;
}

export const listPolicies = createServerFn({ method: "GET" }).handler(
  async (): Promise<PolicyDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("policies").select("*")
      .eq("user_id", userId).order("kind").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PolicyDTO[];
  },
);

export const upsertPolicy = createServerFn({ method: "POST" })
  .inputValidator((d: { id?: string; kind: string; title: string; content: string }) => {
    if (!d?.kind || !d?.title) invalid("Missing fields.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    let policyId = data.id ?? "";
    if (data.id) {
      const { error } = await admin.from("policies").update({
        kind: data.kind, title: data.title, content: data.content,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await admin.from("policies").insert({
        user_id: userId, kind: data.kind, title: data.title, content: data.content,
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Insert failed.");
      policyId = String((row as { id: string }).id);
    }
    // Same missing-information flow as the manual-entry box: data saved from
    // this interface can answer an open topic and notify waiting customers.
    const { resolveMissingInfoForUser } = await import("@/lib/missing-info-resolve.server");
    await resolveMissingInfoForUser(userId, {
      title: `سياسة: ${data.title}`,
      content: `سياسة (${data.kind}) — ${data.title}: ${data.content}`,
      entryId: policyId || null,
      fields: ["policy", "other", "brand_preference"],
    });
    return { ok: true, id: policyId };
  });

export const deletePolicy = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => { if (!d?.id) invalid("Missing id."); return d; })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("policies").delete()
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- SHIPPING ----------
export interface ShippingRateDTO {
  id: string; country: string | null; region: string | null;
  price: number | null; currency: string | null;
  eta: string | null; notes: string | null;
  created_at: string; updated_at: string;
}

export const listShippingRates = createServerFn({ method: "GET" }).handler(
  async (): Promise<ShippingRateDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("shipping_rates").select("*")
      .eq("user_id", userId).order("country", { nullsFirst: false }).order("region", { nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ShippingRateDTO[];
  },
);

export const upsertShippingRate = createServerFn({ method: "POST" })
  .inputValidator((d: { id?: string; country?: string | null; region?: string | null; price?: number | null; currency?: string | null; eta?: string | null; notes?: string | null }) => d)
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const patch = {
      country: data.country ?? null, region: data.region ?? null,
      price: data.price ?? null, currency: data.currency ?? null,
      eta: data.eta ?? null, notes: data.notes ?? null,
    };
    let shippingId = data.id ?? "";
    if (data.id) {
      const { error } = await admin.from("shipping_rates")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await admin.from("shipping_rates")
        .insert({ user_id: userId, ...patch }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Insert failed.");
      shippingId = String((row as { id: string }).id);
    }
    const shippingLine = [
      `شحن إلى ${patch.country ?? "-"}${patch.region ? ` — ${patch.region}` : ""}`,
      patch.price != null ? `السعر: ${patch.price} ${patch.currency ?? ""}`.trim() : "",
      patch.eta ? `المدة: ${patch.eta}` : "",
      patch.notes ? `ملاحظات: ${patch.notes}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    // Same missing-information flow as the manual-entry box.
    const { resolveMissingInfoForUser } = await import("@/lib/missing-info-resolve.server");
    await resolveMissingInfoForUser(userId, {
      title: `شحن: ${patch.region ?? patch.country ?? "منطقة"}`,
      content: shippingLine,
      entryId: shippingId || null,
      fields: ["shipping", "other"],
    });
    return { ok: true, id: shippingId };
  });

export const deleteShippingRate = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => { if (!d?.id) invalid("Missing id."); return d; })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("shipping_rates").delete()
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- CONTACTS ----------
export interface ContactInfoDTO {
  id: string; kind: string; label: string | null; value: string;
  created_at: string; updated_at: string;
}

export const listContactInfo = createServerFn({ method: "GET" }).handler(
  async (): Promise<ContactInfoDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("contact_info").select("*")
      .eq("user_id", userId).order("kind").order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ContactInfoDTO[];
  },
);

export const upsertContactInfo = createServerFn({ method: "POST" })
  .inputValidator((d: { id?: string; kind: string; label?: string | null; value: string }) => {
    if (!d?.kind || !d?.value) invalid("Missing fields.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    let contactId = data.id ?? "";
    if (data.id) {
      const { error } = await admin.from("contact_info").update({
        kind: data.kind, label: data.label ?? null, value: data.value,
        updated_at: new Date().toISOString(),
      }).eq("id", data.id).eq("user_id", userId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await admin.from("contact_info").insert({
        user_id: userId, kind: data.kind, label: data.label ?? null, value: data.value,
      }).select("id").single();
      if (error || !row) throw new Error(error?.message ?? "Insert failed.");
      contactId = String((row as { id: string }).id);
    }
    // Same missing-information flow as the manual-entry box.
    const { resolveMissingInfoForUser } = await import("@/lib/missing-info-resolve.server");
    await resolveMissingInfoForUser(userId, {
      title: `تواصل: ${data.label ?? data.kind}`,
      content: `تواصل (${data.kind})${data.label ? ` ${data.label}` : ""}: ${data.value}`,
      entryId: contactId || null,
      fields: ["other", "brand_preference"],
    });
    return { ok: true, id: contactId };
  });

export const deleteContactInfo = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => { if (!d?.id) invalid("Missing id."); return d; })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("contact_info").delete()
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- UNCLASSIFIED ----------
export interface UnclassifiedDTO {
  id: string; batch_id: string | null; file_name: string | null;
  reason: string | null; excerpt: string | null; status: string; created_at: string;
}

export const listUnclassified = createServerFn({ method: "GET" }).handler(
  async (): Promise<UnclassifiedDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("unclassified_items").select("*")
      .eq("user_id", userId).neq("status", "deleted")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as UnclassifiedDTO[];
  },
);

export const setUnclassifiedStatus = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; status: "pending" | "reviewed" | "reclassified" | "deleted" }) => {
    if (!d?.id || !d?.status) invalid("Missing fields.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("unclassified_items")
      .update({ status: data.status })
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Manually reclassify an unclassified excerpt into policies/shipping/contact/products.
export const reclassifyUnclassified = createServerFn({ method: "POST" })
  .inputValidator((d: {
    id: string;
    target: "policy" | "shipping" | "contact";
    payload: Record<string, unknown>;
  }) => {
    if (!d?.id || !d?.target || !d?.payload) invalid("Missing fields.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const p = data.payload as any;
    let insertedKind: "policy" | "shipping" | "contact" | null = null;
    let insertedId: string | null = null;
    if (data.target === "policy") {
      const { data: row } = await admin.from("policies").insert({
        user_id: userId, kind: String(p.kind ?? "other"),
        title: String(p.title ?? "بدون عنوان"),
        content: String(p.content ?? ""),
      }).select("id").single();
      if (row) { insertedKind = "policy"; insertedId = String((row as any).id); }
    } else if (data.target === "shipping") {
      const { data: row } = await admin.from("shipping_rates").insert({
        user_id: userId, country: p.country ?? null, region: p.region ?? null,
        price: typeof p.price === "number" ? p.price : null,
        currency: p.currency ?? null, eta: p.eta ?? null, notes: p.notes ?? null,
      }).select("id").single();
      if (row) { insertedKind = "shipping"; insertedId = String((row as any).id); }
    } else if (data.target === "contact") {
      const { data: row } = await admin.from("contact_info").insert({
        user_id: userId, kind: String(p.kind ?? "other"),
        label: p.label ?? null, value: String(p.value ?? ""),
      }).select("id").single();
      if (row) { insertedKind = "contact"; insertedId = String((row as any).id); }
    }
    await admin.from("unclassified_items")
      .update({ status: "reclassified" })
      .eq("id", data.id).eq("user_id", userId);
    return { ok: true };
  });

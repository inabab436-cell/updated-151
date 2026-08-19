/**
 * Merge shell/temporary customer rows into a verified customer.
 *
 * When a customer verifies (or logs in with) an email that matches other
 * anonymous customer rows for the same merchant, we consolidate onto a
 * single canonical row so long-term memory, past conversations, and orders
 * follow the identity — not the browser.
 *
 * Rules:
 *  - Only merges rows within the same `merchant_id` (never across tenants).
 *  - The target row is marked `email_verified = true`.
 *  - `conversations`, `orders`, and `complaints` are reassigned to the
 *    target `customer_id`.
 *  - The cumulative structured profile (the single customer-memory store)
 *    is carried over when the target has none yet.
 *  - Empty profile columns on the target are filled from the merged rows.
 *  - Merged shell rows are deleted at the end so nothing is orphaned.
 */
import { createServerFn } from "@tanstack/react-start";

interface MergeInput {
  merchant_id: string;
  email: string;
  target_customer_id: string;
}

/** Exported for direct testing without the Start server-fn runtime. */
export function validateMergeInput(data: MergeInput) {
  if (!data?.merchant_id || !data?.email || !data?.target_customer_id) {
    throw new Error("merchant_id, email and target_customer_id are required.");
  }
  return {
    merchant_id: String(data.merchant_id),
    email: String(data.email).trim().toLowerCase(),
    target_customer_id: String(data.target_customer_id),
  };
}

/** Exported for direct testing without the Start server-fn runtime. */
export async function runMergeCustomerAccounts(data: ReturnType<typeof validateMergeInput>) {
  const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = getSupabaseAdmin();

  const { data: target, error: tErr } = await admin
    .from("customers")
    .select("id, merchant_id, name, phone, address, city, country, language, notes, tags, total_orders, total_spent, last_order_at, profile_structured, profile_summary, profile_updated_at, profile_message_count")
    .eq("id", data.target_customer_id)
    .maybeSingle();
  if (tErr) throw tErr;
  if (!target || target.merchant_id !== data.merchant_id) {
    throw new Error("Target customer not found for this merchant.");
  }

  // Find all other rows to merge (same merchant + email, excluding target).
  const { data: shells, error: sErr } = await admin
    .from("customers")
    .select("id, name, phone, address, city, country, language, notes, tags, total_orders, total_spent, last_order_at, profile_structured, profile_summary, profile_updated_at, profile_message_count")
    .eq("merchant_id", data.merchant_id)
    .ilike("email", data.email)
    .neq("id", data.target_customer_id);
  if (sErr) throw sErr;

  // Always mark target verified with the canonical email.
  const patch: Record<string, unknown> = {
    email: data.email,
    email_verified: true,
  };
  let totalOrders = Number((target as any).total_orders ?? 0);
  let totalSpent = Number((target as any).total_spent ?? 0);
  let lastOrderAt: string | null = (target as any).last_order_at ?? null;
  const mergedTags = new Set<string>(Array.isArray((target as any).tags) ? (target as any).tags : []);
  let profileStructured: unknown = (target as any).profile_structured ?? null;
  let profileSummary: string | null = (target as any).profile_summary ?? null;
  let profileUpdatedAt: string | null = (target as any).profile_updated_at ?? null;
  let profileMessageCount = Number((target as any).profile_message_count ?? 0);

  for (const s of shells ?? []) {
    for (const col of ["name", "phone", "address", "city", "country", "language", "notes"] as const) {
      const cur = (target as any)[col];
      const inc = (s as any)[col];
      if ((cur == null || cur === "") && inc) patch[col] = inc;
    }
    for (const t of ((s as any).tags ?? []) as string[]) mergedTags.add(t);
    // Cumulative profile: keep the target's when present, otherwise adopt
    // the merged row's. Never blend two independently-built profiles.
    if (!profileStructured && (s as any).profile_structured) {
      profileStructured = (s as any).profile_structured;
      profileSummary = (s as any).profile_summary ?? null;
      profileUpdatedAt = (s as any).profile_updated_at ?? null;
      profileMessageCount = Number((s as any).profile_message_count ?? 0);
    }
    totalOrders += Number((s as any).total_orders ?? 0);
    totalSpent += Number((s as any).total_spent ?? 0);
    const sLast = (s as any).last_order_at as string | null;
    if (sLast && (!lastOrderAt || sLast > lastOrderAt)) lastOrderAt = sLast;
  }
  if (mergedTags.size) patch.tags = Array.from(mergedTags);
  if (profileStructured) {
    patch.profile_structured = profileStructured;
    patch.profile_summary = profileSummary;
    patch.profile_updated_at = profileUpdatedAt;
    patch.profile_message_count = profileMessageCount;
  }
  patch.total_orders = totalOrders;
  patch.total_spent = totalSpent;
  if (lastOrderAt) patch.last_order_at = lastOrderAt;

  await admin.from("customers").update(patch).eq("id", data.target_customer_id);

  if (!shells || shells.length === 0) {
    return { merged: 0, target_customer_id: data.target_customer_id };
  }
  const shellIds = shells.map((s: any) => s.id as string);

  // Reassign owned rows to the target customer.
  await admin.from("conversations").update({ customer_id: data.target_customer_id }).in("customer_id", shellIds);
  await admin.from("orders").update({ customer_id: data.target_customer_id }).in("customer_id", shellIds);
  await admin.from("complaints").update({ customer_id: data.target_customer_id }).in("customer_id", shellIds);

  // Finally, remove now-empty shell rows.
  await admin.from("customers").delete().in("id", shellIds);

  return { merged: shellIds.length, target_customer_id: data.target_customer_id };
}

export const mergeCustomerAccounts = createServerFn({ method: "POST" })
  .inputValidator((data: MergeInput) => validateMergeInput(data))
  .handler(async ({ data }) => runMergeCustomerAccounts(data));

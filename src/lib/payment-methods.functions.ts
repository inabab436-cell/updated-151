/**
 * Merchant payment methods: list / create / update / delete.
 * `behavior` decides how the AI agent acts after an order:
 *   auto   → agent continues the conversation normally
 *   manual → agent stops and hands over to the merchant team
 * `detail_type` decides which payment detail field the merchant fills in,
 * and `instructions` holds extra guidance the agent must follow.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type PaymentBehavior = "auto" | "manual";
export type PaymentDetailType = "none" | "phone" | "url" | "text";

export interface PaymentMethod {
  id: string;
  name: string;
  enabled: boolean;
  behavior: PaymentBehavior;
  detail_type: PaymentDetailType;
  detail_value: string;
  instructions: string;
  payment_template: string;
  sort_order: number;
}

const SELECT =
  "id, name, enabled, behavior, detail_type, detail_value, instructions, payment_template, sort_order";

const DEFAULT_METHODS = [
  {
    name: "الدفع عند الاستلام",
    enabled: true,
    behavior: "auto",
    detail_type: "none",
    detail_value: "",
    instructions: "",
    payment_template: "",
    sort_order: 0,
  },
  {
    name: "فودافون كاش",
    enabled: true,
    behavior: "manual",
    detail_type: "phone",
    detail_value: "",
    instructions: "",
    payment_template: "",
    sort_order: 1,
  },
  {
    name: "اتصالات كاش",
    enabled: true,
    behavior: "manual",
    detail_type: "phone",
    detail_value: "",
    instructions: "",
    payment_template: "",
    sort_order: 2,
  },
  {
    name: "إنستا باي",
    enabled: true,
    behavior: "manual",
    detail_type: "text",
    detail_value: "",
    instructions: "",
    payment_template: "",
    sort_order: 3,
  },
];


const detailSchema = z.object({
  detail_type: z.enum(["none", "phone", "url", "text"]).default("none"),
  detail_value: z.string().trim().max(500).default(""),
  instructions: z.string().trim().max(2000).default(""),
  payment_template: z.string().trim().max(2000).default(""),
});

export const listPaymentMethods = createServerFn({ method: "GET" }).handler(
  async (): Promise<PaymentMethod[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { data, error } = await admin
      .from("payment_methods")
      .select(SELECT)
      .eq("user_id", userId)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(error.message);

    if (!data || data.length === 0) {
      const { data: seeded, error: seedErr } = await admin
        .from("payment_methods")
        .insert(DEFAULT_METHODS.map((m) => ({ ...m, user_id: userId })))
        .select(SELECT);
      if (seedErr) throw new Error(seedErr.message);
      return (seeded ?? []) as PaymentMethod[];
    }
    return data as PaymentMethod[];
  },
);

export const createPaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    detailSchema
      .extend({
        name: z.string().trim().min(2).max(60),
        behavior: z.enum(["auto", "manual"]),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<PaymentMethod> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { count } = await admin
      .from("payment_methods")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId);

    const hasDetail = data.detail_type !== "none" && data.detail_value.length > 0;

    const { data: row, error } = await admin
      .from("payment_methods")
      .insert({
        user_id: userId,
        name: data.name,
        behavior: data.behavior,
        detail_type: hasDetail ? data.detail_type : "none",
        detail_value: hasDetail ? data.detail_value : "",
        instructions: data.instructions,
        payment_template: data.payment_template,
        enabled: true,
        sort_order: count ?? 0,
      })
      .select(SELECT)
      .single();
    if (error) throw new Error(error.message);
    return row as PaymentMethod;
  });

export const updatePaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        enabled: z.boolean().optional(),
        behavior: z.enum(["auto", "manual"]).optional(),
        name: z.string().trim().min(2).max(60).optional(),
        detail_type: z.enum(["none", "phone", "url", "text"]).optional(),
        detail_value: z.string().trim().max(500).optional(),
        instructions: z.string().trim().max(2000).optional(),
        payment_template: z.string().trim().max(2000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.enabled !== undefined) patch.enabled = data.enabled;
    if (data.behavior !== undefined) patch.behavior = data.behavior;
    if (data.name !== undefined) patch.name = data.name;
    if (data.instructions !== undefined) patch.instructions = data.instructions;
    if (data.payment_template !== undefined) patch.payment_template = data.payment_template;
    if (data.detail_type !== undefined) {
      const value = data.detail_value ?? "";
      const hasDetail = data.detail_type !== "none" && value.length > 0;
      patch.detail_type = hasDetail ? data.detail_type : "none";
      patch.detail_value = hasDetail ? value : "";
    } else if (data.detail_value !== undefined) {
      patch.detail_value = data.detail_value;
    }

    const { error } = await admin
      .from("payment_methods")
      .update(patch)
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePaymentMethod = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from("payment_methods")
      .delete()
      .eq("id", data.id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

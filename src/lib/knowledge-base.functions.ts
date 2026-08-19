/**
 * Knowledge-base document CRUD.
 *
 * The knowledge_base row IS the single source of truth: the chat agent reads
 * approved rows directly from this table on every message. There is no
 * derived copy to keep in sync.
 */
import { createServerFn } from "@tanstack/react-start";

function invalid(msg: string): never {
  throw new Error(msg);
}

export interface KnowledgeBaseDTO {
  id: string;
  file_name: string | null;
  status: string;
  content_text: string | null;
  created_at: string;
}

export const listKnowledgeBase = createServerFn({ method: "GET" }).handler(
  async (): Promise<KnowledgeBaseDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin, userId);
    if (!merchantId) return [];
    const { data, error } = await admin
      .from("knowledge_base")
      .select("id, file_name, status, content_text, created_at")
      .eq("merchant_id", merchantId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as KnowledgeBaseDTO[];
  },
);

export const upsertKnowledgeBaseEntry = createServerFn({ method: "POST" })
  .inputValidator(
    (d: {
      id?: string;
      file_name?: string | null;
      content_text?: string | null;
      status?: string | null;
    }) => {
      if (!d) invalid("Missing payload.");
      return d;
    },
  )
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin, userId);
    if (!merchantId) invalid("No store found for this account.");

    let entryId = data.id ?? "";
    if (data.id) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (data.file_name !== undefined) patch.file_name = data.file_name;
      if (data.content_text !== undefined) patch.content_text = data.content_text;
      if (data.status !== undefined && data.status !== null) patch.status = data.status;
      const { error } = await admin
        .from("knowledge_base")
        .update(patch)
        .eq("id", data.id)
        .eq("merchant_id", merchantId);
      if (error) throw new Error(error.message);
    } else {
      const { data: row, error } = await admin
        .from("knowledge_base")
        .insert({
          merchant_id: merchantId,
          file_name: data.file_name ?? null,
          content_text: data.content_text ?? null,
          status: data.status ?? "approved",
        })
        .select("id")
        .single();
      if (error || !row) throw new Error(error?.message ?? "Insert failed.");
      entryId = String((row as { id: string }).id);
    }

    return { ok: true, id: entryId };
  });

export const deleteKnowledgeBaseEntry = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id) invalid("Missing id.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { resolveMerchantIdByUser } = await import("@/lib/merchant-data.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const merchantId = await resolveMerchantIdByUser(admin, userId);
    if (!merchantId) invalid("No store found for this account.");

    const { error } = await admin
      .from("knowledge_base")
      .delete()
      .eq("id", data.id)
      .eq("merchant_id", merchantId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

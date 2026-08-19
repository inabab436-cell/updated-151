/**
 * Publish/unpublish helpers for the merchant storefront.
 *
 * Uses ONLY columns that already exist:
 *   products.is_published, products.published_at
 *   policies.is_published, policies.published_at
 *   contact_info.is_published, contact_info.published_at
 *   shipping_rates.is_published, shipping_rates.published_at
 *   staging_products.publish_on_approve  (boolean)
 *   staging_products.image_file_ids      (uuid[])
 *   staging_{contacts,policies,shipping}.status  (text — set to 'publish_selected'
 *     when the merchant opts a row in from the batch review screen)
 */
import { createServerFn } from "@tanstack/react-start";

const LIVE_TABLES = ["products", "policies", "contact_info", "shipping_rates"] as const;
type LiveTable = (typeof LIVE_TABLES)[number];



function bad(msg: string): never { throw new Error(msg); }

// ---------- LIVE publish toggle -------------------------------------------
export const setPublished = createServerFn({ method: "POST" })
  .inputValidator((d: { table: LiveTable; id: string; is_published: boolean }) => {
    if (!d?.id || !LIVE_TABLES.includes(d.table)) bad("Bad input.");
    return d;
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from(data.table).update({
      is_published: data.is_published,
      published_at: data.is_published ? new Date().toISOString() : null,
    }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- LIST all published rows ---------------------------------------
export interface PublishedItem {
  table: LiveTable;
  id: string;
  kind?: string | null;
  title?: string | null;
  label?: string | null;
  value?: string | null;
  content?: string | null;
  name?: string | null;
  category?: string | null;
  price?: number | null;
  currency?: string | null;
  country?: string | null;
  region?: string | null;
  eta?: string | null;
  notes?: string | null;
  images?: any;
  variants?: any;
  description?: string | null;
  published_at: string | null;
}

export const listPublished = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    products: PublishedItem[]; policies: PublishedItem[];
    contacts: PublishedItem[]; shipping: PublishedItem[];
  }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const [p, pol, c, sh] = await Promise.all([
      admin.from("products").select("id,name,description,category,price,currency,images,variants,published_at")
        .eq("user_id", userId).eq("is_published", true).order("category").order("name"),
      admin.from("policies").select("id,kind,title,content,published_at")
        .eq("user_id", userId).eq("is_published", true).order("kind"),
      admin.from("contact_info").select("id,kind,label,value,published_at")
        .eq("user_id", userId).eq("is_published", true).order("kind"),
      admin.from("shipping_rates").select("id,country,region,price,currency,eta,notes,published_at")
        .eq("user_id", userId).eq("is_published", true).order("country", { nullsFirst: false }),
    ]);
    const tag = (t: LiveTable, arr: any[] | null) =>
      (arr ?? []).map((r) => ({ table: t, ...r })) as PublishedItem[];
    const productRows = tag("products", p.data);
    // Overlay canonical variants from product_variants.
    try {
      const { fetchVariantsByProductIds } = await import("@/lib/product-variants.server");
      const map = await fetchVariantsByProductIds(
        admin,
        productRows.map((r) => String(r.id)),
      );
      for (const row of productRows) {
        const canonical = map.get(String(row.id)) ?? [];
        if (canonical.length > 0) row.variants = canonical;
      }
    } catch (e) {
      console.error("listPublished product_variants overlay failed", e);
    }
    return {
      products: productRows,
      policies: tag("policies", pol.data),
      contacts: tag("contact_info", c.data),
      shipping: tag("shipping_rates", sh.data),
    };
  },
);

// ---------- STAGING image resolver ----------------------------------------
// (batch review helpers removed along with the smart upload flow)


// Same resolver for the storefront: takes a list of live product ids and
// returns signed URLs so images survive even if the bucket is private.
export const resolveProductImageUrls = createServerFn({ method: "POST" })
  .inputValidator((d: { productIds: string[] }) => {
    if (!Array.isArray(d?.productIds)) bad("Bad input.");
    return { productIds: d.productIds.map(String) };
  })
  .handler(async ({ data }): Promise<Record<string, string[]>> => {
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createSignedUrl } = await import("@/lib/storage.server");
    if (data.productIds.length === 0) return {};
    const admin = getSupabaseAdmin();
    const { data: prods } = await admin.from("products")
      .select("id, images")
      .in("id", data.productIds);
    // Also join product_images if present.
    const { data: pimg } = await admin.from("product_images")
      .select("product_id, url, position")
      .in("product_id", data.productIds)
      .order("position", { ascending: true });
    const byProduct: Record<string, string[]> = {};
    for (const p of prods ?? []) {
      const arr: string[] = [];
      const imgs = Array.isArray((p as any).images) ? (p as any).images : [];
      for (const x of imgs) {
        const u = typeof x === "string" ? x : (x as any)?.url;
        if (typeof u === "string") arr.push(u);
      }
      // products.image_urls does not exist in this schema.

      byProduct[String((p as any).id)] = arr;
    }
    for (const r of pimg ?? []) {
      const pid = String((r as any).product_id);
      byProduct[pid] = byProduct[pid] ?? [];
      if ((r as any).url) byProduct[pid].push(String((r as any).url));
    }
    // Sign any storage paths (values that aren't http(s)); ignore http(s) URLs.
    for (const pid of Object.keys(byProduct)) {
      const resolved = await Promise.all(byProduct[pid].map(async (u) => {
        if (/^https?:/i.test(u) || /^data:/i.test(u)) return u;
        try { return await createSignedUrl(u, 60 * 60); } catch { return null; }
      }));
      byProduct[pid] = Array.from(new Set(resolved.filter((u): u is string => !!u)));
    }
    return byProduct;
  });
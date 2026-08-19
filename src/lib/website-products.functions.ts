/**
 * Website Products CRUD with structured sizes/colors and 1:N images.
 *
 * - Products live in `products` (existing).
 * - Sizes/colors are stored in `product_sizes` / `product_colors` (NOT JSON).
 * - Images are stored in `product_images` rows (NOT a JSON array on products),
 *   optionally linked to a color or size for per-variant imagery.
 * - Image binaries live in the `cupai-uploads` bucket. `product_images.url`
 *   holds the storage path; the storefront signs it at read time.
 */
import { createServerFn } from "@tanstack/react-start";

function bad(m: string): never { throw new Error(m); }

export interface SizeDTO  { id: string; label: string; position: number }
export interface ColorDTO { id: string; label: string; hex: string | null; position: number }
export interface ImageDTO {
  id: string;
  url: string;                 // signed URL, ready to render
  storage_path: string;        // raw path (for delete)
  color_id: string | null;
  size_id: string | null;
  position: number;
}
/** Status of the internal image description (used for customer photo matching). */
export type DescriptionStatus = "generating" | "ready" | "failed";
/** Per color/size inventory row (canonical `product_variants`). */
export interface VariantDTO {
  color: string | null;
  size: string | null;
  quantity: number | null;
}
export interface WebsiteProductDTO {
  id: string;
  name: string;
  description: string | null;
  /** Material / fabric (الخامة) — part of the basic product settings. */
  material: string | null;
  price: number | null;
  currency: string | null;
  is_published: boolean;
  created_at: string;
  /** Normalized: pending/stale/generating → "generating". */
  description_status: DescriptionStatus;
  sizes: SizeDTO[];
  colors: ColorDTO[];
  images: ImageDTO[];
  variants: VariantDTO[];
}


// ---------- LIST ----------------------------------------------------------
export const listWebsiteProducts = createServerFn({ method: "GET" }).handler(
  async (): Promise<WebsiteProductDTO[]> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createSignedUrl } = await import("@/lib/storage.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const BASE_COLS = "id, name, description, price, currency, is_published, created_at, internal_description_status";
    let res: { data: any[] | null; error: { message: string } | null } = await admin
      .from("products")
      .select(`${BASE_COLS}, material`)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (res.error && /material/i.test(res.error.message)) {
      // `material` column not migrated yet — fall back gracefully.
      res = await admin
        .from("products")
        .select(BASE_COLS)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });
    }
    if (res.error) throw new Error(res.error.message);
    const rows: any[] = res.data ?? [];


    if (rows.length === 0) return [];

    const ids = rows.map((r: any) => r.id as string);
    const [sz, cl, im, vr] = await Promise.all([
      admin.from("product_sizes").select("id, product_id, label, position")
        .in("product_id", ids).order("position", { ascending: true }),
      admin.from("product_colors").select("id, product_id, label, hex, position")
        .in("product_id", ids).order("position", { ascending: true }),
      admin.from("product_images").select("id, product_id, url, position, color_id, size_id")
        .in("product_id", ids).order("position", { ascending: true }),
      admin.from("product_variants").select("product_id, color, size, stock, position")
        .in("product_id", ids).order("position", { ascending: true }),
    ]);

    const byId = new Map<string, WebsiteProductDTO>();
    for (const r of rows) {
      byId.set(String(r.id), {
        id: String(r.id),
        name: (r.name as string) ?? "",
        description: (r.description as string | null) ?? null,
        material: (r.material as string | null) ?? null,

        price: (r.price as number | null) ?? null,
        currency: (r.currency as string | null) ?? null,
        is_published: Boolean(r.is_published),
        created_at: String(r.created_at),
        description_status:
          String((r as any).internal_description_status ?? "") === "ready"
            ? "ready"
            : String((r as any).internal_description_status ?? "") === "failed"
              ? "failed"
              : "generating",
        sizes: [], colors: [], images: [], variants: [],
      });
    }
    for (const v of vr.data ?? []) {
      byId.get(String((v as any).product_id))?.variants.push({
        color: ((v as any).color as string | null) ?? null,
        size: ((v as any).size as string | null) ?? null,
        quantity: (v as any).stock == null ? null : Number((v as any).stock),
      });
    }
    for (const s of sz.data ?? []) {
      byId.get(String(s.product_id))?.sizes.push({
        id: String(s.id), label: String(s.label), position: Number(s.position ?? 0),
      });
    }
    for (const c of cl.data ?? []) {
      byId.get(String(c.product_id))?.colors.push({
        id: String(c.id), label: String(c.label),
        hex: (c.hex as string | null) ?? null, position: Number(c.position ?? 0),
      });
    }
    for (const i of im.data ?? []) {
      const p = byId.get(String(i.product_id));
      if (!p) continue;
      const raw = String(i.url ?? "");
      let signed = raw;
      if (raw && !/^https?:/i.test(raw) && !/^data:/i.test(raw)) {
        try { signed = await createSignedUrl(raw, 60 * 60); } catch { continue; }
      }
      p.images.push({
        id: String(i.id), url: signed, storage_path: raw,
        color_id: (i.color_id as string | null) ?? null,
        size_id:  (i.size_id  as string | null) ?? null,
        position: Number(i.position ?? 0),
      });
    }
    return Array.from(byId.values());
  },
);

// ---------- CREATE / UPDATE product core + sizes + colors -----------------
export interface UpsertProductInput {
  id?: string;
  name: string;
  description?: string | null;
  /** Material / fabric (الخامة). */
  material?: string | null;

  price?: number | null;
  currency?: string | null;
  sizes: { id?: string; label: string }[];
  colors: { id?: string; label: string; hex?: string | null }[];
  /** Optional per color/size inventory. When omitted, variants are untouched. */
  variants?: { color?: string | null; size?: string | null; quantity?: number | null }[];
  /**
   * Re-assign already-saved images to a colour (by label). Used when the AI
   * detects the colour of an image that was still unlinked: the SAME image row
   * becomes the colour image — it is never duplicated or kept as a separate
   * "general" image.
   */
  imageColorAssignments?: { imageId: string; colorLabel: string }[];
}


export const upsertWebsiteProduct = createServerFn({ method: "POST" })
  .inputValidator((d: UpsertProductInput) => {
    const name = (d?.name ?? "").trim();
    if (name.length < 1) bad("Product name is required.");
    if (name.length > 300) bad("Product name too long.");
    const sizes  = Array.isArray(d.sizes)  ? d.sizes.filter((s) => s?.label?.trim())  : [];
    const colors = Array.isArray(d.colors) ? d.colors.filter((c) => c?.label?.trim()) : [];
    return {
      id: d.id ? String(d.id) : undefined,
      name,
      description: (d.description ?? null) as string | null,
      material: (d.material ?? null) ? String(d.material).trim().slice(0, 200) || null : null,

      price:    typeof d.price === "number" && Number.isFinite(d.price) ? d.price : null,
      currency: (d.currency ?? null) as string | null,
      sizes:  sizes.map((s)  => ({ id: s.id, label: s.label.trim() })),
      colors: colors.map((c) => ({
        id: c.id, label: c.label.trim(), hex: c.hex?.trim() || null,
      })),
      variants: Array.isArray(d.variants)
        ? d.variants.map((v) => ({
            color: v.color ? String(v.color).trim() || null : null,
            size:  v.size  ? String(v.size).trim()  || null : null,
            // Quantity is mandatory per variant; a missing value is coerced to
            // 0 ("out of stock") instead of null, because null was read as
            // "unavailable" and then flipped later, contradicting itself.
            quantity:
              v.quantity != null && Number.isFinite(Number(v.quantity))
                ? Number(v.quantity)
                : 0,

          }))
        : undefined,
      imageColorAssignments: Array.isArray(d.imageColorAssignments)
        ? d.imageColorAssignments
            .filter((a) => a?.imageId && a?.colorLabel?.trim())
            .map((a) => ({ imageId: String(a.imageId), colorLabel: a.colorLabel.trim() }))
        : [],
    };
  })

  .handler(async ({ data }): Promise<{ id: string; colors: { id: string; label: string }[]; sizes: { id: string; label: string }[] }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    let productId = data.id;
    // `material` may not be migrated yet on older databases — retry without it.
    const withMaterial = <T extends Record<string, unknown>>(base: T) =>
      ({ ...base, material: data.material }) as T & { material: string | null };
    if (productId) {
      const base = {
        name: data.name, description: data.description,
        price: data.price, currency: data.currency,
      };
      let { error } = await admin.from("products").update(withMaterial(base) as any)
        .eq("id", productId).eq("user_id", userId);
      if (error && /material/i.test(error.message)) {
        ({ error } = await admin.from("products").update(base)
          .eq("id", productId).eq("user_id", userId));
      }
      if (error) throw new Error(error.message);
    } else {
      const base = {
        user_id: userId,
        name: data.name, description: data.description,
        price: data.price, currency: data.currency,
        is_published: false,
      };
      let res = await admin.from("products").insert(withMaterial(base) as any).select("id").single();
      if (res.error && /material/i.test(res.error.message)) {
        res = await admin.from("products").insert(base).select("id").single();
      }
      if (res.error || !res.data) throw new Error(res.error?.message ?? "Insert failed.");
      productId = String((res.data as any).id);
    }


    // Sizes/colors are replaced wholesale, and product_images.(color_id|size_id)
    // is ON DELETE SET NULL — so we snapshot which image pointed at which
    // LABEL before the delete and restore those links against the new rows.
    const [{ data: oldColors }, { data: oldSizes }, { data: oldImages }] = await Promise.all([
      admin.from("product_colors").select("id, label").eq("product_id", productId),
      admin.from("product_sizes").select("id, label").eq("product_id", productId),
      admin.from("product_images").select("id, color_id, size_id").eq("product_id", productId),
    ]);
    const colorLabelById = new Map<string, string>(
      (oldColors ?? []).map((c: any) => [String(c.id), String(c.label ?? "").toLowerCase()]),
    );
    const sizeLabelById = new Map<string, string>(
      (oldSizes ?? []).map((s: any) => [String(s.id), String(s.label ?? "").toLowerCase()]),
    );
    const imageLinks = (oldImages ?? []).map((i: any) => ({
      id: String(i.id),
      colorLabel: i.color_id ? (colorLabelById.get(String(i.color_id)) ?? null) : null,
      sizeLabel: i.size_id ? (sizeLabelById.get(String(i.size_id)) ?? null) : null,
    }));

    // Replace sizes.
    await admin.from("product_sizes").delete()
      .eq("product_id", productId).eq("user_id", userId);
    const newSizes: { id: string; label: string }[] = [];
    if (data.sizes.length > 0) {
      const { data: rows } = await admin.from("product_sizes").insert(
        data.sizes.map((s, i) => ({
          product_id: productId, user_id: userId,
          label: s.label, position: i,
        })),
      ).select("id, label");
      for (const r of rows ?? []) newSizes.push({ id: String((r as any).id), label: String((r as any).label) });
    }
    // Replace colors.
    await admin.from("product_colors").delete()
      .eq("product_id", productId).eq("user_id", userId);
    const newColors: { id: string; label: string }[] = [];
    if (data.colors.length > 0) {
      const { data: rows } = await admin.from("product_colors").insert(
        data.colors.map((c, i) => ({
          product_id: productId, user_id: userId,
          label: c.label, hex: c.hex ?? null, position: i,
        })),
      ).select("id, label");
      for (const r of rows ?? []) newColors.push({ id: String((r as any).id), label: String((r as any).label) });
    }

    // Restore image → color/size links by label (kept stable across the
    // delete/insert cycle). Labels that no longer exist stay unlinked.
    const colorIdByLabel = new Map(newColors.map((c) => [c.label.toLowerCase(), c.id] as const));
    const sizeIdByLabel  = new Map(newSizes.map((s)  => [s.label.toLowerCase(), s.id] as const));
    for (const link of imageLinks) {
      if (!link.colorLabel && !link.sizeLabel) continue;
      const nextColor = link.colorLabel ? (colorIdByLabel.get(link.colorLabel) ?? null) : null;
      const nextSize  = link.sizeLabel  ? (sizeIdByLabel.get(link.sizeLabel)  ?? null) : null;
      if (!nextColor && !nextSize) continue;
      await admin.from("product_images")
        .update({ color_id: nextColor, size_id: nextSize })
        .eq("id", link.id).eq("user_id", userId);
    }

    // Move already-saved images onto their (AI-)detected colour. The image row
    // itself is updated, so the product never ends up with the same photo both
    // as an unlinked "general" image and as a colour image.
    for (const a of data.imageColorAssignments) {
      const cid = colorIdByLabel.get(a.colorLabel.toLowerCase());
      if (!cid) continue;
      await admin.from("product_images")
        .update({ color_id: cid, size_id: null })
        .eq("id", a.imageId).eq("product_id", productId!).eq("user_id", userId);
    }



    // Per color/size inventory (canonical product_variants + legacy jsonb).
    if (data.variants) {
      const { syncVariantsForProduct } = await import("@/lib/product-variants.server");
      const raw = data.variants
        .filter((v) => v.color || v.size || v.quantity != null)
        .map((v, i) => ({ color: v.color, size: v.size, quantity: v.quantity, position: i }));
      await syncVariantsForProduct(admin, productId!, raw);
      await admin.from("products").update({ variants: raw })
        .eq("id", productId!).eq("user_id", userId);
    }

    return { id: productId!, colors: newColors, sizes: newSizes };
  });



// ---------- DELETE product ------------------------------------------------
export const deleteWebsiteProduct = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string }) => {
    if (!d?.id) bad("Missing id.");
    return { id: String(d.id) };
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { UPLOAD_BUCKET } = await import("@/lib/storage.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    // Best-effort remove image blobs from storage before dropping the row.
    const { data: imgs } = await admin.from("product_images")
      .select("url").eq("product_id", data.id).eq("user_id", userId);
    const paths = (imgs ?? [])
      .map((r: any) => String((r as any).url ?? ""))
      .filter((u: any) => u && !/^https?:/i.test(u) && !/^data:/i.test(u));
    if (paths.length > 0) {
      try { await admin.storage.from(UPLOAD_BUCKET).remove(paths); } catch { /* ignore */ }
    }
    // Cascades take care of sizes / colors / images.
    const { error } = await admin.from("products").delete()
      .eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


// ---------- UPLOAD product image (multipart) ------------------------------
// Form fields:
//   file      — image binary (required)
//   productId — target product id (required)
//   colorId   — optional
//   sizeId    — optional
export const uploadProductImage = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) bad("Invalid upload.");
    const file = data.get("file");
    const productId = data.get("productId");
    if (!(file instanceof File)) bad("Missing image file.");
    if (file.size <= 0) bad("Empty file.");
    if (file.size > 15 * 1024 * 1024) bad("Image too large (max 15MB).");
    if (!/^image\//i.test(file.type)) bad("Only image files are allowed.");
    if (typeof productId !== "string" || !productId) bad("Missing productId.");
    const colorId = data.get("colorId");
    const sizeId  = data.get("sizeId");
    return {
      file,
      productId: String(productId),
      colorId: typeof colorId === "string" && colorId ? colorId : null,
      sizeId:  typeof sizeId  === "string" && sizeId  ? sizeId  : null,
    };
  })
  .handler(async ({ data }): Promise<ImageDTO> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadOriginalFile, createSignedUrl } = await import("@/lib/storage.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    // Verify ownership of the product.
    const { data: prod } = await admin.from("products")
      .select("id, user_id").eq("id", data.productId).maybeSingle();
    if (!prod || (prod as any).user_id !== userId) bad("Product not found.");

    const bytes = await data.file.arrayBuffer();
    const { path } = await uploadOriginalFile({
      userId, fileName: data.file.name,
      mimeType: data.file.type || "application/octet-stream", bytes,
    });

    // Determine position.
    const { data: existing } = await admin.from("product_images")
      .select("position").eq("product_id", data.productId)
      .order("position", { ascending: false }).limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;

    const { data: row, error } = await admin.from("product_images").insert({
      product_id: data.productId, user_id: userId,
      url: path, position: nextPos,
      color_id: data.colorId, size_id: data.sizeId,
    }).select("id, url, position, color_id, size_id").single();
    if (error || !row) throw new Error(error?.message ?? "Insert image failed.");

    const signed = await createSignedUrl(path, 60 * 60);

    // Run the existing visual-description mechanism to completion before the
    // upload request finishes. A detached promise can be terminated by the
    // serverless runtime, leaving the product permanently at "generating".
    const { regenerateProductDescription } = await import("@/lib/product-vision.server");
    await regenerateProductDescription({ userId, productId: data.productId });

    return {
      id: String(row.id), url: signed, storage_path: path,
      color_id: (row.color_id as string | null) ?? null,
      size_id:  (row.size_id  as string | null) ?? null,
      position: Number(row.position ?? nextPos),
    };
  });

// ---------- DELETE image --------------------------------------------------
export const deleteProductImage = createServerFn({ method: "POST" })
  .inputValidator((d: { imageId: string }) => {
    if (!d?.imageId) bad("Missing imageId.");
    return { imageId: String(d.imageId) };
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { UPLOAD_BUCKET } = await import("@/lib/storage.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { data: row } = await admin.from("product_images")
      .select("url, user_id").eq("id", data.imageId).maybeSingle();
    if (!row || (row as any).user_id !== userId) bad("Image not found.");

    const path = String((row as any).url ?? "");
    if (path && !/^https?:/i.test(path) && !/^data:/i.test(path)) {
      try { await admin.storage.from(UPLOAD_BUCKET).remove([path]); } catch { /* ignore */ }
    }
    const { error } = await admin.from("product_images").delete()
      .eq("id", data.imageId).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- PUBLISH toggle for a single product ---------------------------
export const setProductPublished = createServerFn({ method: "POST" })
  .inputValidator((d: { id: string; is_published: boolean }) => {
    if (!d?.id) bad("Missing id.");
    return { id: String(d.id), is_published: Boolean(d.is_published) };
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();
    const { error } = await admin.from("products").update({
      is_published: data.is_published,
      published_at: data.is_published ? new Date().toISOString() : null,
    }).eq("id", data.id).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- ANALYZE product image (AI-fill) -------------------------------
// Given the id of a product_images row this user owns, run the smart
// single-image analyzer and return suggested product fields for the editor.
// The colour is returned SEPARATELY (never inside name/description) so the UI
// can put it in the colour field and attach the image to that colour.
export interface AnalyzedImageSuggestion {
  name: string | null;
  description: string | null;
  material: string | null;
  category: string | null;
  price: number | null;
  currency: string | null;
  /** Single detected colour for this image (empty array when unknown). */
  colors: string[];
  hex: string | null;
  sizes: string[];
}

const EMPTY_SUGGESTION: AnalyzedImageSuggestion = {
  name: null, description: null, material: null, category: null,
  price: null, currency: null, colors: [], hex: null, sizes: [],
};

export const analyzeProductImage = createServerFn({ method: "POST" })
  .inputValidator((d: { imageId: string }) => {
    if (!d?.imageId) bad("Missing imageId.");
    return { imageId: String(d.imageId) };
  })
  .handler(async ({ data }): Promise<AnalyzedImageSuggestion> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { createSignedUrl } = await import("@/lib/storage.server");
    const { suggestProductFromImage } = await import("@/lib/product-image-suggest.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { data: row } = await admin.from("product_images")
      .select("url, user_id").eq("id", data.imageId).maybeSingle();
    if (!row || (row as any).user_id !== userId) bad("Image not found.");
    const path = String((row as any).url ?? "");
    if (!path) bad("Image has no storage path.");
    let url = path;
    if (!/^https?:/i.test(path) && !/^data:/i.test(path)) {
      url = await createSignedUrl(path, 60 * 30);
    }
    const s = await suggestProductFromImage(url);
    return {
      ...EMPTY_SUGGESTION,
      name: s.name, description: s.description, material: s.material,
      category: s.category, price: s.price, currency: s.currency,
      colors: s.color ? [s.color] : [], hex: s.hex, sizes: s.sizes,
    };
  });

// ---------- ANALYZE a not-yet-saved image file ----------------------------
// Same analyzer as `analyzeProductImage`, but for a file picked in the
// "add product" dialog before any product row exists. The blob is stored
// temporarily (the analyzer needs a URL) and removed right after.
export const analyzeProductImageFile = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!(data instanceof FormData)) bad("Invalid upload.");
    const file = data.get("file");
    if (!(file instanceof File)) bad("Missing image file.");
    if (file.size <= 0) bad("Empty file.");
    if (file.size > 15 * 1024 * 1024) bad("Image too large (max 15MB).");
    if (!/^image\//i.test(file.type)) bad("Only image files are allowed.");
    return { file };
  })
  .handler(async ({ data }): Promise<AnalyzedImageSuggestion> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { uploadOriginalFile, createSignedUrl, UPLOAD_BUCKET } = await import("@/lib/storage.server");
    const { suggestProductFromImage } = await import("@/lib/product-image-suggest.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const bytes = await data.file.arrayBuffer();
    const { path } = await uploadOriginalFile({
      userId, fileName: data.file.name,
      mimeType: data.file.type || "image/jpeg", bytes,
    });
    try {
      const url = await createSignedUrl(path, 60 * 30);
      const s = await suggestProductFromImage(url);
      return {
        ...EMPTY_SUGGESTION,
        name: s.name, description: s.description, material: s.material,
        category: s.category, price: s.price, currency: s.currency,
        colors: s.color ? [s.color] : [], hex: s.hex, sizes: s.sizes,
      };
    } finally {
      try { await admin.storage.from(UPLOAD_BUCKET).remove([path]); } catch { /* ignore */ }
    }
  });


// ---------- RETRY internal image description ------------------------------

// Fallback for the "failed" state only: re-runs the SAME existing generation
// mechanism (product-vision.server → regenerateProductDescription) that runs
// automatically in the background after an image upload. No new logic.
export const retryProductDescription = createServerFn({ method: "POST" })
  .inputValidator((d: { productId: string }) => {
    if (!d?.productId) bad("Missing productId.");
    return { productId: String(d.productId) };
  })
  .handler(async ({ data }) => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { regenerateProductDescription } = await import("@/lib/product-vision.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const { data: prod } = await admin.from("products")
      .select("id, user_id").eq("id", data.productId).maybeSingle();
    if (!prod || (prod as any).user_id !== userId) bad("Product not found.");

    await regenerateProductDescription({ userId, productId: data.productId });
    return { ok: true };
  });

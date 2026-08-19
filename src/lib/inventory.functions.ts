/**
 * Manual product creation — bypasses AI analysis and the staging/approval
 * flow entirely. Writes the merchant-entered product directly into the
 * published product tables (products, product_variants, product_colors,
 * product_sizes). The AI import flow via analysis_batches / staging_products
 * is unchanged.
 */
import { createServerFn } from "@tanstack/react-start";

export interface ManualVariantInput {
  color?: string | null;
  size?: string | null;
  quantity?: number | null;
  price?: number | null;
}

export interface ManualProductInput {
  name: string;
  description?: string | null;
  /** Material / fabric (الخامة). */
  material?: string | null;
  price?: number | null;
  currency?: string | null;
  colors?: string[];
  sizes?: string[];
  variants?: ManualVariantInput[];
}


export const createManualProduct = createServerFn({ method: "POST" })
  .inputValidator((v: ManualProductInput) => v)
  .handler(async ({ data }): Promise<{ productId: string; colors: { id: string; label: string }[] }> => {
    const { requireUserId } = await import("@/lib/session-guard.server");
    const { getSupabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { userId } = await requireUserId();
    const admin = getSupabaseAdmin();

    const name = String(data.name ?? "").trim();
    if (!name) throw new Error("اسم المنتج مطلوب.");
    if (name.length > 300) throw new Error("اسم المنتج طويل جداً.");
    const description = data.description ? String(data.description).slice(0, 4000) : null;
    const price =
      data.price != null && Number.isFinite(Number(data.price)) ? Number(data.price) : null;
    const currency = data.currency ? String(data.currency).slice(0, 8) : "EGP";

    const colors = (data.colors ?? [])
      .map((c) => String(c ?? "").trim())
      .filter(Boolean);
    const sizes = (data.sizes ?? [])
      .map((s) => String(s ?? "").trim())
      .filter(Boolean);

    const variants = (data.variants ?? [])
      .map((v, i) => ({
        color: v.color ? String(v.color).trim() : null,
        size: v.size ? String(v.size).trim() : null,
        // Mandatory quantity: never persist a null stock (see
        // src/lib/variant-quantity.ts for the reasoning).
        stock:
          v.quantity != null && Number.isFinite(Number(v.quantity)) ? Number(v.quantity) : 0,

        price: v.price != null && Number.isFinite(Number(v.price)) ? Number(v.price) : null,
        position: i,
      }))
      .filter((v) => v.color || v.size || v.stock != null || v.price != null);

    // 1. Insert directly into the published products table.
    const material = data.material ? String(data.material).trim().slice(0, 200) || null : null;
    const baseRow = {
      user_id: userId,
      batch_id: null,
      name,
      description,
      category: null,
      price,
      currency,
      variants,
      images: [],
      is_published: false,
    };
    // `material` may not be migrated yet on older databases — retry without it.
    let ins = await admin
      .from("products")
      .insert({ ...baseRow, material } as any)
      .select("id")
      .single();
    if (ins.error && /material/i.test(ins.error.message)) {
      ins = await admin.from("products").insert(baseRow).select("id").single();
    }
    if (ins.error || !ins.data) throw new Error(ins.error?.message ?? "product create failed");
    const productId = (ins.data as { id: string }).id;


    // 2. Structured variant rows.
    if (variants.length > 0) {
      const { error: vErr } = await admin.from("product_variants").insert(
        variants.map((v) => ({
          product_id: productId,
          color: v.color,
          size: v.size,
          price: v.price,
          stock: v.stock,
          position: v.position,
        })),
      );
      if (vErr) throw new Error(vErr.message);
    }

    // 3. Colors.
    const createdColors: { id: string; label: string }[] = [];
    if (colors.length > 0) {
      const { data: colorRows, error: cErr } = await admin
        .from("product_colors")
        .insert(
          colors.map((label, i) => ({
            product_id: productId,
            user_id: userId,
            label,
            hex: null,
            position: i,
          })),
        )
        .select("id, label");
      if (cErr) throw new Error(cErr.message);
      for (const r of colorRows ?? []) {
        createdColors.push({ id: String((r as any).id), label: String((r as any).label) });
      }
    }

    // 4. Sizes.
    if (sizes.length > 0) {
      const { error: sErr } = await admin.from("product_sizes").insert(
        sizes.map((label, i) => ({
          product_id: productId,
          user_id: userId,
          label,
          position: i,
        })),
      );
      if (sErr) throw new Error(sErr.message);
    }


    // Same missing-information flow as the manual-entry box: a product added
    // from this interface can answer an open topic (price / size / color /
    // availability) and notify the customers who were waiting.
    const { resolveMissingInfoForUser } = await import("@/lib/missing-info-resolve.server");
    await resolveMissingInfoForUser(userId, {
      title: `منتج: ${name}`,
      content: [
        `منتج: ${name}`,
        price != null ? `السعر: ${price} ${currency ?? ""}`.trim() : "",
        colors.length ? `الألوان: ${colors.join("، ")}` : "",
        sizes.length ? `المقاسات: ${sizes.join("، ")}` : "",
        variants.length
          ? variants
              .map(
                (v) =>
                  `- لون: ${v.color ?? "-"} | مقاس: ${v.size ?? "-"} | كمية: ${v.stock ?? 0} | سعر: ${v.price ?? price ?? "-"}`,
              )
              .join("\n")
          : "",
        description ? `الوصف: ${description}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      entryId: productId,
      fields: ["price", "size", "color", "availability", "other"],
    });

    return { productId, colors: createdColors };
  });


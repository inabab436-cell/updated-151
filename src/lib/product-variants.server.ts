/**
 * product_variants is the canonical source of truth for per-variant
 * inventory (color/size/stock/price). Product create/update flows
 * dual-write here alongside the legacy `products.variants` jsonb column
 * so downstream reads (storefront, chatbot, published lists) can migrate
 * to `product_variants` without dropping the jsonb yet.
 *
 * NOTE: the inventory quantity column on product_variants is `stock`.
 * Legacy variant JSON blobs use `quantity` — map here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CanonicalVariant {
  color: string | null;
  size: string | null;
  price: number | null;
  stock: number | null;
  position: number;
}

function toStringOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}
function toNumOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalize a heterogeneous variant JSON blob into the product_variants row
 * shape. Accepts `quantity` or `stock`, `color`/`colour`, `size`, etc.
 */
export function normalizeVariants(raw: unknown): CanonicalVariant[] {
  if (!Array.isArray(raw)) return [];
  const out: CanonicalVariant[] = [];
  raw.forEach((v, i) => {
    if (!v || typeof v !== "object") return;
    const o = v as Record<string, unknown>;
    const color = toStringOrNull(o.color ?? o.colour ?? o.color_name);
    const size = toStringOrNull(o.size ?? o.size_label);
    const price = toNumOrNull(o.price);
    const stockRaw = toNumOrNull(o.stock ?? o.quantity ?? o.qty);
    // Skip completely empty rows.
    if (color == null && size == null && price == null && stockRaw == null) {
      return;
    }
    // product_variants.stock is NOT NULL — default missing values to 0
    // so the DB write cannot fail on a variant the merchant left blank.
    const stock = stockRaw == null ? 0 : stockRaw;
    out.push({
      color,
      size,
      price,
      stock,
      position: typeof o.position === "number" ? o.position : i,
    });
  });
  // Deduplicate by (color,size) — last one wins.
  const dedup = new Map<string, CanonicalVariant>();
  for (const v of out) {
    const k = `${v.color ?? ""}|${v.size ?? ""}`;
    dedup.set(k, v);
  }
  return Array.from(dedup.values());
}

/**
 * Replace all product_variants rows for a product with the given list.
 * Non-destructive: only touches rows keyed by `product_id`.
 */
export async function syncVariantsForProduct(
  admin: SupabaseClient,
  productId: string,
  raw: unknown,
): Promise<void> {
  const rows = normalizeVariants(raw);
  const { error: delErr } = await admin
    .from("product_variants")
    .delete()
    .eq("product_id", productId);
  if (delErr) throw new Error(`variants delete: ${delErr.message}`);
  if (rows.length === 0) return;
  const payload = rows.map((v) => ({ product_id: productId, ...v }));
  const { error: insErr } = await admin.from("product_variants").insert(payload);
  if (insErr) throw new Error(`variants insert: ${insErr.message}`);
}

/**
 * Fetch product_variants for a set of product ids, returning them as
 * legacy-shaped variant JSON blobs (color/size/price/stock) so callers
 * that expect the jsonb array can consume them unchanged.
 */
export async function fetchVariantsByProductIds(
  admin: SupabaseClient,
  productIds: string[],
): Promise<Map<string, CanonicalVariant[]>> {
  const map = new Map<string, CanonicalVariant[]>();
  if (productIds.length === 0) return map;
  const { data, error } = await admin
    .from("product_variants")
    .select("product_id, color, size, price, stock, position")
    .in("product_id", productIds)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  for (const r of data ?? []) {
    const pid = String((r as any).product_id);
    const arr = map.get(pid) ?? [];
    arr.push({
      color: (r as any).color ?? null,
      size: (r as any).size ?? null,
      price: (r as any).price ?? null,
      stock: (r as any).stock ?? null,
      position: Number((r as any).position ?? 0),
    });
    map.set(pid, arr);
  }
  return map;
}

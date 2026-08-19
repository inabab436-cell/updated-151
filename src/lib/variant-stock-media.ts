/**
 * Variant-level stock gate for product media.
 *
 * The agent may only ever SHOW variants that really have stock right now.
 * These pure helpers derive, from this turn's fresh snapshot, which colour
 * labels are live and which ran out — so image attachment is decided by real
 * stock numbers, never by wording in the customer's message.
 */

export type StockVariant = { color?: string | null; size?: string | null; stock?: number | null };
export type StockProduct = { id?: string | null; variants?: StockVariant[] | null };
export type ColorRow = { id: string; label: string | null };

/**
 * Human-readable summary of the variants that REALLY have stock right now,
 * e.g. `أحمر (مقاسات: M، L)`. Built only from the live snapshot lines, so the
 * agent can name what exists instead of answering with a bare "not available".
 */
export function inStockVariantSummary(product: StockProduct | null | undefined): string[] {
  const byColor = new Map<string, string[]>();
  for (const v of product?.variants ?? []) {
    if (Number(v?.stock ?? 0) <= 0) continue;
    const color = String(v?.color ?? "").trim() || "-";
    const size = String(v?.size ?? "").trim();
    const sizes = byColor.get(color) ?? [];
    if (size && !sizes.includes(size)) sizes.push(size);
    byColor.set(color, sizes);
  }
  return [...byColor.entries()].map(([color, sizes]) =>
    sizes.length ? `${color} (مقاسات: ${sizes.join("، ")})` : color,
  );
}


/** Colour labels of a product that still have at least one unit in stock. */
export function inStockColorLabels(product: StockProduct | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of product?.variants ?? []) {
    const label = String(v?.color ?? "").trim();
    if (!label || seen.has(label)) continue;
    const total = (product?.variants ?? [])
      .filter((x) => String(x?.color ?? "").trim() === label)
      .reduce((s, x) => s + Number(x?.stock ?? 0), 0);
    if (total > 0) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

/** Colour labels of a product whose every variant is at zero. */
export function soldOutColorLabels(product: StockProduct | null | undefined): string[] {
  const live = new Set(inStockColorLabels(product).map((l) => l));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of product?.variants ?? []) {
    const label = String(v?.color ?? "").trim();
    if (!label || seen.has(label) || live.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * Map the product's stored colour rows onto the live snapshot stock, so image
 * rows can be filtered by `color_id` without any text matching at query time.
 */
export function partitionColorsByStock(
  colors: ColorRow[],
  product: StockProduct | null | undefined,
  normalize: (v: unknown) => string,
): {
  inStockIds: Set<string>;
  soldOutIds: Set<string>;
  inStockLabels: string[];
  soldOutLabels: string[];
} {
  const live = new Set(inStockColorLabels(product).map((l) => normalize(l)));
  const dead = new Set(soldOutColorLabels(product).map((l) => normalize(l)));
  const inStockIds = new Set<string>();
  const soldOutIds = new Set<string>();
  const inStockLabels: string[] = [];
  const soldOutLabels: string[] = [];
  for (const c of colors) {
    const label = String(c.label ?? "").trim();
    const norm = normalize(label);
    if (!norm) continue;
    if (live.has(norm)) {
      inStockIds.add(c.id);
      if (label) inStockLabels.push(label);
    } else if (dead.has(norm)) {
      soldOutIds.add(c.id);
      if (label) soldOutLabels.push(label);
    }
  }
  return { inStockIds, soldOutIds, inStockLabels, soldOutLabels };
}

/**
 * PRE-ORDER AVAILABILITY CHECK — decides, from the LIVE store data, whether
 * the selection currently held in the structured order state can actually be
 * ordered, BEFORE the order is created.
 *
 * Why: the agent used to discover an unavailable product / colour / size /
 * quantity only at `create_order` time (or, worse, claim unavailability in a
 * run AFTER the order already succeeded). This check runs on every turn while
 * the order is still being built, so the problem is raised at the step where
 * it belongs and never re-opened later.
 *
 * Pure module — the caller passes the already-loaded products.
 */

export interface AvailabilityVariant {
  color: string | null;
  size: string | null;
  stock: number | null;
}

export interface AvailabilityProduct {
  id: string;
  name: string;
  variants: AvailabilityVariant[];
}

export interface AvailabilitySelection {
  product_name?: string | null;
  color?: string | null;
  size?: string | null;
  quantity?: string | number | null;
}

export type AvailabilityStatus =
  | "unknown" // nothing selected yet — nothing to check
  | "ok"
  | "product_not_found"
  | "product_sold_out"
  | "color_unavailable"
  | "size_unavailable"
  | "insufficient_quantity";

export interface AvailabilityResult {
  status: AvailabilityStatus;
  /** Verified fields, safe to promote to stage "verified". */
  verified: Array<"product_name" | "color" | "size" | "quantity">;
  available: number | null;
  requested: number | null;
  /**
   * Quantity of this same line already deducted from stock by an existing
   * order of this conversation. The live stock no longer contains it, so the
   * check must only require the DIFFERENCE.
   */
  alreadyDeducted?: number;
  /** requested − alreadyDeducted (never below 0). */
  additionalNeeded?: number | null;
  inStockColors: string[];
  inStockSizes: string[];
  /** Arabic directive for the agent context; empty when nothing to say. */
  message: string;
}

export interface AvailabilityOptions {
  /** Pieces of this exact line already deducted for this conversation. */
  alreadyDeducted?: number;
}

interface ExistingOrderRow {
  status?: string | null;
  items?: unknown;
  stock_deducted?: unknown;
}

/**
 * Gives the model explicit arithmetic for lines that are already present in a
 * stock-deducted order. Live inventory is the REMAINDER, so it is also exactly
 * how many extra pieces may be added; it must not be compared with the updated
 * line total. Keeping the numbers pre-computed prevents the model from
 * subtracting the existing order a second time.
 */
export function buildExistingOrderAdditionCapacityBlock(
  products: AvailabilityProduct[],
  orders: ExistingOrderRow[],
): string {
  const lines: string[] = [];

  for (const order of orders ?? []) {
    const items = Array.isArray(order.items)
      ? (order.items as Array<Record<string, unknown>>)
      : [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const existingRaw = Number(item.quantity ?? 0);
      const existing = Number.isFinite(existingRaw) && existingRaw > 0
        ? Math.floor(existingRaw)
        : 0;
      if (!existing) continue;

      const selection: AvailabilitySelection = {
        product_name: typeof item.product_name === "string" ? item.product_name : null,
        color: typeof item.color === "string" ? item.color : null,
        size: typeof item.size === "string" ? item.size : null,
        quantity: existing,
      };
      const verdict = checkSelectionAvailability(products, selection, {
        alreadyDeducted: existing,
      });
      if (verdict.status !== "ok" || verdict.available == null) continue;

      const label = [selection.product_name, selection.color, selection.size]
        .filter(Boolean)
        .join(" | ");
      lines.push(
        `line: ${label}`,
        `quantity_already_in_order: ${existing}`,
        `extra_pieces_available_now: ${verdict.available}`,
        `maximum_valid_new_total: ${existing + verdict.available}`,
        `decision: adding any quantity from 1 through ${verdict.available} is AVAILABLE; for example, adding 1 means send new total ${existing + 1}, while only 1 leaves stock.`,
        "---",
      );
    }
  }

  if (!lines.length) return "";
  return [
    "\n\n[EXISTING ORDER ADDITION CAPACITY — deterministic arithmetic; never quote this heading.]",
    "The inventory already excludes quantity_already_in_order. Judge an addition only against extra_pieces_available_now, never compare maximum/new total with live stock.",
    ...lines,
  ].join("\n");
}

/**
 * Render the deterministic result of the live variant check for the model.
 * This is deliberately generated from stock numbers, not from wording in the
 * customer's question or from an earlier assistant reply.
 */
export function buildLiveAvailabilityBlock(result: AvailabilityResult): string {
  if (result.status === "unknown") return "";
  const lines = [
    "\n\n[LIVE AVAILABILITY VERDICT — computed from current product_variants rows for this exact turn; never quote this heading.]",
    `status: ${result.status}`,
  ];
  if (result.available != null) lines.push(`available_quantity: ${result.available}`);
  if (result.requested != null) lines.push(`requested_quantity: ${result.requested}`);
  if (result.alreadyDeducted) {
    lines.push(`already_deducted_for_this_conversation: ${result.alreadyDeducted}`);
    lines.push(`additional_quantity_needed: ${result.additionalNeeded ?? 0}`);
    lines.push(
      "note: the requested quantity is the NEW TOTAL of the line. The already deducted pieces are no longer part of available_quantity, so only additional_quantity_needed has to fit in stock.",
    );
  }
  if (result.inStockColors.length) lines.push(`in_stock_colors: ${result.inStockColors.join(" | ")}`);
  if (result.inStockSizes.length) lines.push(`in_stock_sizes: ${result.inStockSizes.join(" | ")}`);
  lines.push(
    result.status === "ok"
      ? "decision: The selected product/variant is available right now. Answer availability positively."
      : `decision: ${result.message}`,
  );
  return lines.join("\n");
}

function norm(v: unknown): string {
  return String(v ?? "")
    .toLowerCase()
    .replace(/[\u064B-\u0652]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function stockOf(v: AvailabilityVariant): number {
  const n = Number(v.stock ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function uniq(list: string[]): string[] {
  return Array.from(new Set(list.filter((s) => s && s.trim()))).slice(0, 20);
}

export function checkSelectionAvailability(
  products: AvailabilityProduct[],
  selection: AvailabilitySelection,
  options: AvailabilityOptions = {},
): AvailabilityResult {
  const base: AvailabilityResult = {
    status: "unknown",
    verified: [],
    available: null,
    requested: null,
    inStockColors: [],
    inStockSizes: [],
    message: "",
  };

  const wantedName = norm(selection.product_name);
  if (!wantedName) return base;

  const product =
    products.find((p) => norm(p.name) === wantedName) ??
    products.find((p) => norm(p.name).includes(wantedName) || wantedName.includes(norm(p.name))) ??
    null;

  if (!product) {
    return {
      ...base,
      status: "product_not_found",
      message: `المنتج «${selection.product_name}» غير موجود في الكتالوج الحالي. وضّح ذلك للعميل الآن واعرض بديلاً قبل الانتقال لأي خطوة تالية.`,
    };
  }

  const variants = product.variants ?? [];
  // A product with no variant rows is not stock-tracked: it is orderable.
  if (!variants.length) {
    return {
      ...base,
      status: "ok",
      verified: ["product_name"],
    };
  }

  const inStock = variants.filter((v) => stockOf(v) > 0);
  const inStockColors = uniq(inStock.map((v) => String(v.color ?? "")));
  const inStockSizes = uniq(inStock.map((v) => String(v.size ?? "")));

  // With variant rows present, zero live rows means the whole product is sold
  // out. Previously a product-only selection fell through to `ok` because no
  // colour/size/quantity branch ran, while the inventory block simultaneously
  // marked the same product SOLD_OUT. Which instruction the model followed
  // could then change between otherwise identical turns.
  if (inStock.length === 0) {
    return {
      ...base,
      status: "product_sold_out",
      verified: ["product_name"],
      available: 0,
      message: `المنتج «${product.name}» غير متاح حالياً لأن كل نسخه نفدت. قل ذلك للعميل الآن واعرض منتجاً آخر متاحاً.`,
    };
  }

  const wantedColor = norm(selection.color);
  const wantedSize = norm(selection.size);

  if (wantedColor) {
    const colorMatches = inStock.filter((v) => norm(v.color) === wantedColor);
    if (!colorMatches.length) {
      return {
        ...base,
        status: "color_unavailable",
        verified: ["product_name"],
        inStockColors,
        inStockSizes,
        message:
          `اللون «${selection.color}» من «${product.name}» غير متاح حالياً. ` +
          (inStockColors.length
            ? `الألوان المتاحة الآن: ${inStockColors.join("، ")}. `
            : "") +
          "قل ذلك للعميل الآن قبل إكمال باقي خطوات الطلب.",
      };
    }
  }

  const matching = inStock.filter(
    (v) =>
      (!wantedColor || norm(v.color) === wantedColor) &&
      (!wantedSize || norm(v.size) === wantedSize),
  );

  if (wantedSize && !matching.length) {
    const sizesForColor = uniq(
      inStock
        .filter((v) => !wantedColor || norm(v.color) === wantedColor)
        .map((v) => String(v.size ?? "")),
    );
    return {
      ...base,
      status: "size_unavailable",
      verified: ["product_name", ...(wantedColor ? (["color"] as const) : [])],
      inStockColors,
      inStockSizes: sizesForColor,
      message:
        `المقاس «${selection.size}» غير متاح لهذا الاختيار من «${product.name}». ` +
        (sizesForColor.length ? `المقاسات المتاحة: ${sizesForColor.join("، ")}. ` : "") +
        "قل ذلك للعميل الآن قبل إكمال باقي خطوات الطلب.",
    };
  }

  const available = matching.reduce((sum, v) => sum + stockOf(v), 0);
  const qtyRaw = Number(selection.quantity ?? 0);
  const requested = Number.isFinite(qtyRaw) && qtyRaw > 0 ? Math.floor(qtyRaw) : null;
  const creditRaw = Number(options.alreadyDeducted ?? 0);
  const alreadyDeducted =
    Number.isFinite(creditRaw) && creditRaw > 0 ? Math.floor(creditRaw) : 0;
  // Only the pieces that still have to leave the stock are checked against it.
  const additionalNeeded =
    requested != null ? Math.max(0, requested - alreadyDeducted) : null;

  const verified: AvailabilityResult["verified"] = ["product_name"];
  if (wantedColor) verified.push("color");
  if (wantedSize) verified.push("size");

  if (additionalNeeded && available < additionalNeeded) {
    return {
      ...base,
      status: "insufficient_quantity",
      verified,
      available,
      requested,
      alreadyDeducted,
      additionalNeeded,
      inStockColors,
      inStockSizes,
      message:
        (alreadyDeducted
          ? `الكمية الإضافية المطلوبة (${additionalNeeded}) من «${product.name}» غير متاحة؛ المتاح الآن ${available} فقط بعد خصم ${alreadyDeducted} مسجَّلة بالفعل على طلب العميل. `
          : `الكمية المطلوبة (${requested}) من «${product.name}» غير متاحة؛ المتاح الآن ${available} فقط. `) +
        "أبلغ العميل بالكمية المتاحة الآن واعرض عليه إتمام الطلب بها أو بديلاً، قبل الانتقال لأي خطوة تالية.",
    };
  }

  return {
    ...base,
    status: "ok",
    verified: requested ? [...verified, "quantity"] : verified,
    available,
    requested,
    alreadyDeducted,
    additionalNeeded,
    inStockColors,
    inStockSizes,
  };
}

export interface StockShortage {
  product_name?: unknown;
  color?: unknown;
  size?: unknown;
  requested?: unknown;
  available?: unknown;
}

function positiveInteger(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Customer-facing stock rejection built only from the atomic database result. */
export function buildInsufficientStockReply(shortages: StockShortage[]): string {
  const lines = (shortages ?? []).map((shortage) => {
    const product = text(shortage.product_name) || "المنتج ده";
    const variant = [text(shortage.color), text(shortage.size)].filter(Boolean).join("، مقاس ");
    const requested = positiveInteger(shortage.requested);
    const available = positiveInteger(shortage.available);
    const selection = variant ? `${product} ${variant}` : product;

    if (available > 0) {
      return `المتاح حاليًا من ${selection} هو ${available} بدل ${requested}. أظبط الكمية على ${available}؟`;
    }
    return `${selection} خلص حاليًا، فمش هقدر أسجله في الطلب. تحب أقولك على أقرب بديل متاح؟`;
  });

  return lines.join("\n\n") || "الكمية المطلوبة مش متاحة حاليًا. تحب أقولك المتاح بدلها؟";
}

/** A saved approval remains valid; an internal save failure never becomes a confirmation loop. */
export const ORDER_SAVE_REVIEW_REPLY =
  "تمام، موافقتك والبيانات عندي ومش محتاج تقول أي كلمة تأكيد تاني. هراجع تسجيل الطلب ده حالًا.";
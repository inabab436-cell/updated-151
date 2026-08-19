import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildActiveOrderStateBlock,
  ACTIVE_ORDER_STATE_HEADING,
} from "../src/lib/active-order-state";

describe("buildActiveOrderStateBlock", () => {
  it("marks every field unknown when nothing is known yet", () => {
    const out = buildActiveOrderStateBlock({});
    expect(out.startsWith(ACTIVE_ORDER_STATE_HEADING)).toBe(true);
    expect(out).toContain("الاسم: غير معروف");
    expect(out).toContain("الموبايل: غير معروف");
    expect(out).toContain("العنوان: غير معروف");
    expect(out).toContain("طريقة الدفع: غير معروف");
    expect(out).toContain(
      "الحقول الناقصة فقط: [الاسم، الموبايل، العنوان، المنتج، اللون، المقاس، الكمية، طريقة الدفع]",
    );
  });

  it("renders known customer and order fields and leaves them out of the missing list", () => {
    const out = buildActiveOrderStateBlock({
      customer: { name: "منى", phone: "01000000000", address: "المعادي، القاهرة" },
      order: {
        order_number: "ORD-1",
        status: "new",
        payment_method: "الدفع عند الاستلام",
        items: [{ product_name: "هودي بيج", color: "بيج", size: "L", quantity: 2 }],
      },
    });
    expect(out).toContain("الاسم: منى");
    expect(out).toContain("الموبايل: 01000000000");
    expect(out).toContain("العنوان: المعادي، القاهرة");
    expect(out).toContain("المنتج: هودي بيج | اللون: بيج | المقاس: L | الكمية: 2");
    expect(out).toContain("طريقة الدفع: الدفع عند الاستلام");
    expect(out).toContain("رقم الطلب المسجَّل: ORD-1 | الحالة: new");
    expect(out).toContain("الحقول الناقصة فقط: []");
  });

  it("lists only the genuinely missing fields", () => {
    const out = buildActiveOrderStateBlock({
      customer: { name: "أحمد", phone: "  ", address: null },
      order: { items: [{ product_name: "تيشيرت", size: "M", quantity: 1 }] },
    });
    expect(out).toContain("الحقول الناقصة فقط: [الموبايل، العنوان، اللون، طريقة الدفع]");
    expect(out).not.toContain("رقم الطلب المسجَّل");
  });

  it("treats placeholder and zero-quantity values as missing", () => {
    const out = buildActiveOrderStateBlock({
      customer: { name: "-", phone: "null", address: "" },
      order: { payment_method: "-", items: [{ product_name: "شورت", quantity: 0 }] },
    });
    expect(out).toContain("الاسم: غير معروف");
    expect(out).toContain("الكمية: غير معروف");
    expect(out).toContain("الموبايل، العنوان");
    expect(out).toContain("الكمية، طريقة الدفع");
  });

  it("carries the ask-only-missing rule", () => {
    const out = buildActiveOrderStateBlock({});
    expect(out).toContain(
      "اسأل فقط عن الحقول المذكورة في «الحقول الناقصة». أي حقل له قيمة هنا مؤكَّد ولا تسأل عنه ولا تطلب تأكيده مرة أخرى.",
    );
  });

  it("is safe against non-array / non-object items payloads", () => {
    expect(() =>
      buildActiveOrderStateBlock({ order: { items: "oops" as unknown } }),
    ).not.toThrow();
    expect(buildActiveOrderStateBlock({ order: { items: [null] } })).toContain(
      "المنتج: غير معروف",
    );
  });
});

describe("ACTIVE ORDER STATE wiring", () => {
  const source = readFileSync(
    resolve(__dirname, "../src/routes/api/chat-ai.ts"),
    "utf8",
  );

  it("is appended to the pinned fresh store snapshot", () => {
    const start = source.indexOf("const buildFreshStoreSnapshot =");
    const snap = source.slice(start, source.indexOf("let freshStoreSnapshot", start));
    expect(snap).toContain("activeOrderStateBlock");
  });

  it("is built from the live order row, not from chat text", () => {
    expect(source).toContain("buildActiveOrderStateBlock({");
    expect(source).toContain("latestConversationOrder");
  });

  it("keeps the heading strippable by the reply sanitizer", () => {
    const sanitizer = readFileSync(
      resolve(__dirname, "../src/routes/api/chat-ai.ts"),
      "utf8",
    );
    expect(sanitizer).toContain('"ACTIVE ORDER STATE"');
  });
});

describe("selection fallback (long conversations)", () => {
  it("uses the conversation selection when no order row exists yet", () => {
    const out = buildActiveOrderStateBlock({
      customer: { name: "منى", phone: "01000000000", address: "المعادي" },
      selection: { product_name: "هودي بيج", color: "بيج", size: "L", quantity: "2", payment_method: "الدفع عند الاستلام" },
    });
    expect(out).toContain("المنتج: هودي بيج | اللون: بيج | المقاس: L | الكمية: 2");
    expect(out).toContain("طريقة الدفع: الدفع عند الاستلام");
    expect(out).toContain("الحقول الناقصة فقط: []");
  });

  it("lets the real order row win over the selection", () => {
    const out = buildActiveOrderStateBlock({
      order: { items: [{ product_name: "تيشيرت", color: "أسود", size: "M", quantity: 1 }] },
      selection: { product_name: "هودي", color: "بيج", size: "L", quantity: "5" },
    });
    expect(out).toContain("المنتج: تيشيرت | اللون: أسود | المقاس: M | الكمية: 1");
  });

  it("ignores an invalid selection quantity", () => {
    const out = buildActiveOrderStateBlock({ selection: { quantity: "كتير" } });
    expect(out).toContain("الكمية: غير معروف");
  });
});

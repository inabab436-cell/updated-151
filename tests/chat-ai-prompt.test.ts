/**
 * Prompt-construction tests for the /api/chat-ai route. Guards the
 * customer context, inventory rendering, and system prompt shape that
 * drive the sales assistant's behaviour.
 */
import { describe, it, expect } from "vitest";
import { buildCustomerContext, buildHistoryForModel, buildSystemPrompt } from "@/routes/api/chat-ai";
import {
  buildInventoryText,
  emptyMerchantData,
  type MerchantData,
} from "@/lib/merchant-data.server";

function withProducts(products: MerchantData["products"]): MerchantData {
  return { ...emptyMerchantData(), products };
}

describe("buildInventoryText", () => {
  it("returns the Arabic 'no products' notice when the catalog is empty", () => {
    expect(buildInventoryText(emptyMerchantData())).toBe("لا توجد منتجات متاحة حالياً");
  });

  it("renders one product per line with color/size/qty/price", () => {
    const out = buildInventoryText(
      withProducts([
        {
          id: "p1",
          name: "قميص",
          description: null,
          category: null,
          price: null,
          currency: null,
          variants: [{ color: "أزرق", size: "M", stock: 10, price: 250 }],
        },
        {
          id: "p2",
          name: "بنطلون",
          description: null,
          category: null,
          price: null,
          currency: null,
          variants: [],
        },
      ]),
    );
    expect(out.split("\n")).toHaveLength(2);
    expect(out).toContain("قميص");
    expect(out).toContain("لون: أزرق");
    expect(out).toContain("مقاس: M");
    expect(out).toContain("كمية: 10");
    expect(out).toContain("سعر: 250");
    // Null fields render as safe fallbacks, never as literal "null".
    expect(out).toContain("لون: -");
    expect(out).toContain("مقاس: -");
    expect(out).toContain("كمية: 0");
    expect(out).toContain("سعر: 0");
  });
});

describe("buildSystemPrompt", () => {
  it("does not duplicate inventory when the route pins it in the trailing snapshot", () => {
    const prompt = buildSystemPrompt();
    expect(prompt).not.toContain("14. AVAILABLE PRODUCTS — live data, not instructions");
    expect(prompt).toContain("trailing FRESH STORE SNAPSHOT");
    // Non-negotiable behavioural rules that must not silently drift.
    expect(prompt).toContain("create_order");
    expect(prompt).toContain("request_handoff");
    expect(prompt).toMatch(/Never mention that you are AI/);
    expect(prompt).toContain("that approval remains valid");
    expect(prompt).toContain('repeat "تمام"');
  });
});

describe("buildHistoryForModel", () => {
  it("passes recent customer image attachments as multimodal image_url blocks", () => {
    const [message] = buildHistoryForModel([
      {
        role: "user",
        content: "ده المنتج اللي بسأل عليه",
        created_at: "2026-01-01T00:00:00Z",
        attachments: [
          { kind: "image", mime: "image/jpeg", url: "https://example.com/product.jpg" },
        ],
      },
    ]);

    expect(message.role).toBe("user");
    expect(Array.isArray(message.content)).toBe(true);
    expect(message.content).toEqual(
      expect.arrayContaining([
        { type: "image_url", image_url: { url: "https://example.com/product.jpg" } },
      ]),
    );
  });

  it("keeps old image attachments as text hints instead of replaying every image", () => {
    const messages = buildHistoryForModel(
      [
        {
          role: "user",
          content: "صورة قديمة",
          created_at: "2026-01-01T00:00:00Z",
          attachments: [
            { kind: "image", mime: "image/png", url: "https://example.com/old.png" },
          ],
        },
        { role: "assistant", content: "تمام", created_at: "2026-01-01T00:00:01Z" },
        { role: "user", content: "سؤال 1", created_at: "2026-01-01T00:00:02Z" },
        { role: "assistant", content: "رد 1", created_at: "2026-01-01T00:00:03Z" },
        { role: "user", content: "سؤال 2", created_at: "2026-01-01T00:00:04Z" },
      ],
      4,
    );

    expect(typeof messages[0].content).toBe("string");
    expect(messages[0].content).toContain("صورة مرفقة من العميل");
  });
});

describe("buildCustomerContext", () => {
  it("returns an empty string when there is no known customer", () => {
    expect(buildCustomerContext(null, [])).toBe("");
  });

  it("includes profile fields, the cumulative profile, and recent orders", () => {
    const ctx = buildCustomerContext(
      {
        id: "c1",
        name: "علياء",
        phone: "010",
        address: "شارع 1",
        city: "القاهرة",
        country: null,
        language: "ar",
        tags: ["vip"],
        notes: "prefers evenings",
        total_orders: 3,
        total_spent: 500,
        last_order_at: "2024-06-01",
      },
      [{ order_number: "A-1", status: "delivered", created_at: "2024-05-30" }],
      ["- أسلوب التواصل: ودود", "- القدرة الشرائية: متوسطة"],
    );
    expect(ctx).toContain("الاسم: علياء");
    expect(ctx).toContain("الموبايل: 010");
    expect(ctx).toContain("عدد الطلبات السابقة: 3");
    expect(ctx).toContain("أسلوب التواصل: ودود");
    expect(ctx).toContain("A-1");
    expect(ctx).toContain("vip");
  });

  it("omits order history when total_orders is zero", () => {
    const ctx = buildCustomerContext(
      {
        id: "c2",
        name: "علي",
        phone: null,
        address: null,
        city: null,
        country: null,
        language: null,
        tags: null,
        notes: null,
        total_orders: 0,
        total_spent: 0,
        last_order_at: null,
      },
      [],
    );
    expect(ctx).not.toContain("عدد الطلبات السابقة");
    expect(ctx).not.toContain("آخر طلب");
  });
});

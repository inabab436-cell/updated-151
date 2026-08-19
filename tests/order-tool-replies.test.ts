import { describe, expect, it } from "vitest";

import {
  buildInsufficientStockReply,
  ORDER_SAVE_REVIEW_REPLY,
} from "@/lib/order-tool-replies";

describe("deterministic order failure replies", () => {
  it("states the atomic live shortage and offers only the available quantity", () => {
    const reply = buildInsufficientStockReply([
      {
        product_name: "هودي سادة",
        color: "أسود",
        size: "S",
        requested: 4,
        available: 3,
      },
    ]);

    expect(reply).toContain("المتاح حاليًا");
    expect(reply).toContain("3 بدل 4");
    expect(reply).toContain("أظبط الكمية على 3؟");
    expect(reply).not.toMatch(/سيستم|نظام|حاول|أكد|تمام/);
  });

  it("does not ask for another confirmation after an internal save failure", () => {
    expect(ORDER_SAVE_REVIEW_REPLY).toContain("موافقتك والبيانات عندي");
    expect(ORDER_SAVE_REVIEW_REPLY).toContain("مش محتاج تقول أي كلمة تأكيد تاني");
    expect(ORDER_SAVE_REVIEW_REPLY).not.toMatch(/حاول|أكد الأوردر|قول.*تمام|سيستم|نظام/);
  });
});
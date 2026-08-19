/**
 * Guard tests for the reply sanitizer: whole internal blocks that the model
 * sometimes pastes before its real answer (payment methods block, store
 * knowledge, matched-product hint, raw inventory lines) must never reach
 * the customer, while the human reply survives untouched.
 */
import { describe, it, expect } from "vitest";
import { sanitizeAssistantReply } from "@/routes/api/chat-ai";

describe("sanitizeAssistantReply — internal block leaks", () => {
  it("drops a leaked PAYMENT METHODS block and keeps the human line", () => {
    const raw = [
      "PAYMENT METHODS (live, merchant-configured — the ONLY payment options that exist):",
      "",
      "طريقة الدفع: الدفع عند الاستلام",
      "النوع: تلقائي",
      "",
      "طريقة الدفع: فودافون كاش",
      "النوع: يدوي",
      "رقم الهاتف: 01204664848",
      "تعليمات هذه الطريقة: بتدفع ديبوزت وباقي المبلغ عند الاستلام",
      "",
      "وده السويتشيرت البيج يا فندم. إيه رأيك فيه؟",
    ].join("\n");

    const out = sanitizeAssistantReply(raw);
    expect(out).toBe("وده السويتشيرت البيج يا فندم. إيه رأيك فيه؟");
    expect(out).not.toMatch(/PAYMENT METHODS|طريقة الدفع|01204664848/);
  });

  it("drops a leaked matched-product hint and store-knowledge heading", () => {
    const raw = [
      "STORE KNOWLEDGE (read DIRECTLY from the live database)",
      "[MATCHED_PRODUCT] product_id: abc confidence: 0.82 match_kind: similar",
      "",
      "أيوه متوفر يا فندم.",
    ].join("\n");
    expect(sanitizeAssistantReply(raw)).toBe("أيوه متوفر يا فندم.");
  });

  it("drops raw inventory lines pasted into the reply", () => {
    const raw = [
      "- هودي | لون: بيج | مقاس: L | كمية: 2 | سعر: 850",
      "",
      "عندنا البيج مقاس L 👌",
    ].join("\n");
    expect(sanitizeAssistantReply(raw)).toBe("عندنا البيج مقاس L 👌");
  });

  it("leaves an ordinary reply completely unchanged", () => {
    const raw = "أيوه يا فندم متوفر.\n\nتحب أبعتلك صورته؟";
    expect(sanitizeAssistantReply(raw)).toBe(raw);
  });

  it("keeps a normal payment answer at the payment step readable", () => {
    const raw = "بنقبل الدفع عند الاستلام أو فودافون كاش، تحب أنهي واحدة؟";
    expect(sanitizeAssistantReply(raw)).toBe(raw);
  });

  it("keeps a three-paragraph sales reply that mentions cash on delivery", () => {
    const raw = [
      "أهلًا يا فندم، الهودي البيج متوفر مقاس L 👌",
      "",
      "السعر 850 جنيه، والدفع عند الاستلام متاح لو تحب.",
      "",
      "أأكد لحضرتك الطلب؟",
    ].join("\n");
    expect(sanitizeAssistantReply(raw)).toBe(raw);
  });
});


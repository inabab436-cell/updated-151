import { describe, expect, it } from "vitest";
import { sanitizeAssistantReply } from "@/routes/api/chat-ai";

describe("general technical-leak scrubber", () => {
  it("drops a sentence naming an internal tool/function", () => {
    const out = sanitizeAssistantReply(
      "تمام يا فندم.\nهستخدم report_missing_information(order) الأول.\nالسويتشيرت متوفر."
    );
    expect(out).not.toMatch(/report_missing_information/);
    expect(out).toContain("السويتشيرت متوفر.");
  });

  it("removes programming vocabulary inside a normal sentence", () => {
    const out = sanitizeAssistantReply(
      "أيوه متوفر يا فندم. بشوف الكمية من قاعدة البيانات حالًا. تحب أحجزه؟"
    );
    expect(out).not.toMatch(/قاعدة البيانات/);
    expect(out).toContain("أيوه متوفر يا فندم.");
    expect(out).toContain("تحب أحجزه؟");
  });

  it("removes AI / automated-system self references", () => {
    const out = sanitizeAssistantReply(
      "أنا مساعد آلي مبرمج للرد. المقاس L متوفر يا فندم."
    );
    expect(out).not.toMatch(/مساعد آلي|مبرمج/);
    expect(out).toContain("المقاس L متوفر يا فندم.");
  });

  it("strips inline code spans and API talk", () => {
    const out = sanitizeAssistantReply(
      "هبعت الطلب على `POST /api/orders` من السيرفر. الأوردر اتسجل يا فندم."
    );
    expect(out).not.toMatch(/api|السيرفر/i);
    expect(out).toContain("الأوردر اتسجل يا فندم.");
  });

  it("never returns an empty reply", () => {
    expect(sanitizeAssistantReply("system prompt: database token")).not.toBe("");
  });

  it("leaves an ordinary reply unchanged", () => {
    const raw = "أيوه يا فندم متوفر.\n\nتحب أبعتلك صورته؟";
    expect(sanitizeAssistantReply(raw)).toBe(raw);
  });
});

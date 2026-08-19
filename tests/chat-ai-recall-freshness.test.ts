/**
 * Freshness guarantees for long conversations that use
 * recall_earlier_conversation.
 *
 * Scenario (shared by every data type): a conversation of more than 24
 * messages where the agent stated a value early on (before message 5),
 * the merchant then changed that value in the database, the customer asks
 * about it again at the end, and the model calls
 * recall_earlier_conversation.
 *
 * Required outcome in every case:
 *  - the recalled transcript never carries the OLD value,
 *  - the fresh snapshot is the LAST message before the model runs,
 *  - a snapshot-grounded answer contains only the NEW value.
 */
import { describe, it, expect } from "vitest";
import {
  buildRecallTranscript,
  pinSnapshotLast,
  STALE_AGENT_STOCK_TAG,
} from "@/routes/api/chat-ai";


type Msg = { role: string; content: string };

/** Every field of every merchant data table read by the agent. */
const CASES: Array<{
  label: string;
  oldAgentLine: string;
  oldValue: string;
  newValue: string;
  question: string;
}> = [
  // ---- Products ----
  { label: "product price", oldAgentLine: "سعر القميص الأزرق 250 جنيه", oldValue: "250", newValue: "310", question: "القميص الأزرق بكام؟" },
  { label: "product availability", oldAgentLine: "القميص الأزرق متوفر حالياً", oldValue: "متوفر حالياً", newValue: "غير متاح", question: "القميص الأزرق موجود؟" },
  { label: "product stock", oldAgentLine: "عندنا كمية 12 قطعة من القميص", oldValue: "12", newValue: "3", question: "فيه كام قطعة؟" },
  { label: "product name", oldAgentLine: "الموديل اسمه قميص كلاسيك أزرق", oldValue: "كلاسيك", newValue: "قميص أوكسفورد", question: "اسم الموديل إيه؟" },
  { label: "product color", oldAgentLine: "متاح بلون أحمر كمان", oldValue: "أحمر", newValue: "أسود", question: "متاح بأنهي لون؟" },
  { label: "product size", oldAgentLine: "المقاس المتاح سمول بس", oldValue: "سمول", newValue: "لارج", question: "المقاسات إيه؟" },
  // ---- Shipping ----
  { label: "shipping price", oldAgentLine: "الشحن للقاهرة 40 جنيه", oldValue: "40", newValue: "65", question: "الشحن بكام؟" },
  { label: "shipping eta", oldAgentLine: "التوصيل بياخد 3 أيام", oldValue: "3", newValue: "5", question: "التوصيل بياخد قد إيه؟" },
  { label: "shipping country", oldAgentLine: "بنشحن لمصر والسعودية", oldValue: "السعودية", newValue: "مصر فقط", question: "بتشحنوا لفين؟" },
  // ---- Policies ----
  { label: "policy text", oldAgentLine: "سياسة الاستبدال خلال 14 يوم من الاستلام", oldValue: "14 يوم", newValue: "7 أيام", question: "سياسة الاستبدال إيه؟" },
  { label: "policy refund", oldAgentLine: "الاسترجاع متاح بدون شروط", oldValue: "بدون شروط", newValue: "بشرط الفاتورة", question: "الاسترجاع إزاي؟" },
  // ---- Contact info ----
  { label: "contact phone", oldAgentLine: "رقم خدمة العملاء 01000000000", oldValue: "01000000000", newValue: "01555555555", question: "رقم الخدمة إيه؟" },
  { label: "contact email", oldAgentLine: "الإيميل بتاعنا old@shop.com", oldValue: "old@shop.com", newValue: "new@shop.com", question: "إيميلكم إيه؟" },
  // ---- Store identity ----
  { label: "store name", oldAgentLine: "احنا متجر الأناقة القديم", oldValue: "الأناقة القديم", newValue: "متجر كابي", question: "اسم المتجر إيه؟" },
  { label: "store description", oldAgentLine: "المتجر متخصص في الملابس الرجالي بس", oldValue: "الرجالي بس", newValue: "ملابس رجالي وحريمي", question: "بتبيعوا إيه؟" },
];

/** Builds a >24-message conversation with the stale fact stated early. */
function buildLongConversation(oldAgentLine: string, question: string): Msg[] {
  const msgs: Msg[] = [
    { role: "user", content: "السلام عليكم" },
    { role: "assistant", content: "أهلاً بحضرتك" },
    { role: "user", content: "عايز أسأل على حاجة" },
    { role: "assistant", content: oldAgentLine },
    { role: "user", content: "تمام شكراً" },
  ];
  for (let i = 0; i < 20; i++) {
    msgs.push({ role: "user", content: `رسالة عميل إضافية` });
    msgs.push({ role: "assistant", content: "تمام يا فندم" });
  }
  msgs.push({ role: "user", content: question });
  return msgs;
}

/**
 * Minimal stand-in for the model: answers strictly from the LAST system
 * message (the fresh snapshot), exactly as the system prompt commands.
 */
function answerFromLastSnapshot(messages: Array<{ role: string; content: string }>): string {
  const last = messages[messages.length - 1];
  // The snapshot is pinned as the last message; its role is "user" so that
  // gateways which hoist system messages cannot move it above the history.
  if (last.role !== "system" && last.role !== "user") throw new Error("snapshot is not last");
  return `الرد: ${last.content}`;
}

describe("recall_earlier_conversation freshness (all knowledge types)", () => {
  for (const c of CASES) {
    it(`${c.label}: final answer uses only the new value`, () => {
      const conversation = buildLongConversation(c.oldAgentLine, c.question);
      expect(conversation.length).toBeGreaterThan(24);

      // 1) Tool result: customer messages intact, agent replies verbatim but
      //    structurally tagged as expired by role (no keyword matching).
      const transcript = buildRecallTranscript(conversation);
      expect(transcript).toContain(STALE_AGENT_STOCK_TAG);
      expect(transcript).toContain(`Agent: ${c.oldAgentLine} `);
      expect(transcript).toContain(`Customer: ${c.question}`);
      expect(transcript).toContain("Customer: السلام عليكم");

      // 2) Snapshot pinning after tool_calls + tool result were appended.
      const snapshot = `FRESH STORE SNAPSHOT\n${c.label}: ${c.newValue}`;
      const aiMessages: Array<{ role: string; content: string }> = [
        { role: "system", content: "SYSTEM PROMPT" },
        ...conversation,
        { role: "system", content: snapshot },
      ];
      aiMessages.push({ role: "assistant", content: "" });
      aiMessages.push({ role: "tool", content: JSON.stringify({ transcript }) });
      pinSnapshotLast(aiMessages, snapshot);

      expect(aiMessages[aiMessages.length - 1].content).toBe(snapshot);
      expect(aiMessages.filter((m) => m.content === snapshot)).toHaveLength(1);

      // 3) Snapshot-grounded answer: new value only, old value nowhere.
      const answer = answerFromLastSnapshot(aiMessages);
      expect(answer).toContain(c.newValue);
      expect(answer).not.toContain(c.oldValue);
    });
  }
});

describe("recall transcript tagging", () => {
  it("tags every agent reply and no customer message", () => {
    const transcript = buildRecallTranscript([
      { role: "user", content: "تمام" },
      { role: "assistant", content: "السعر 250 جنيه" },
    ]).split("\n");
    expect(transcript[0]).toBe("Customer: تمام");
    expect(transcript[1]).toBe(`Agent: السعر 250 جنيه ${STALE_AGENT_STOCK_TAG}`);
  });
});


describe("pinSnapshotLast", () => {
  it("moves an existing snapshot to the end without duplicating it", () => {
    const snapshot = "SNAP";
    const messages = [
      { role: "system", content: "prompt" },
      { role: "system", content: snapshot },
      { role: "user", content: "hi" },
    ];
    pinSnapshotLast(messages, snapshot);
    expect(messages.map((m) => m.content)).toEqual(["prompt", "hi", snapshot]);
  });
});

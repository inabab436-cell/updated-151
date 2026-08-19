/**
 * Guard tests: internal system-context delimiters ("[SYSTEM CONTEXT …]",
 * "[END OF SYSTEM CONTEXT]", "End of FRESH STORE SNAPSHOT", "End of MISSING
 * INFORMATION STATUS") and the internal English instructions between them
 * must never reach the customer.
 */
import { describe, it, expect } from "vitest";
import { sanitizeAssistantReply } from "@/routes/api/chat-ai";

describe("sanitizeAssistantReply — system context delimiters", () => {
  it("drops a full leaked system-context dump and keeps the human reply", () => {
    const raw = [
      "[SYSTEM CONTEXT — NOT a message from the customer. Do not reply to it, do not quote it.]",
      "FRESH STORE SNAPSHOT (authoritative, just retrieved from the live database).",
      "The customer already gave name and phone. Do not ask again.",
      "End of FRESH STORE SNAPSHOT",
      "MISSING INFORMATION STATUS (خاص بهذه المحادثة فقط):",
      "- \"وزن الهودي\" — لسه الإدارة ما ردتش.",
      "End of MISSING INFORMATION STATUS",
      "[END OF SYSTEM CONTEXT]",
      "",
      "أهلًا يا فندم، الهودي البيج متوفر مقاس L 👌",
    ].join("\n");

    const out = sanitizeAssistantReply(raw);
    expect(out).toBe("أهلًا يا فندم، الهودي البيج متوفر مقاس L 👌");
    expect(out).not.toMatch(/SYSTEM CONTEXT|End of|SNAPSHOT|MISSING/i);
  });

  it("never empties a reply when the delimiter comes last", () => {
    const raw = ["تم تسجيل الطلب يا فندم ✅", "", "[END OF SYSTEM CONTEXT]"].join("\n");
    expect(sanitizeAssistantReply(raw)).toBe("تم تسجيل الطلب يا فندم ✅");
  });

  it("leaves an ordinary reply unchanged", () => {
    const raw = "أيوه يا فندم متوفر.\n\nتحب أبعتلك صورته؟";
    expect(sanitizeAssistantReply(raw)).toBe(raw);
  });
});

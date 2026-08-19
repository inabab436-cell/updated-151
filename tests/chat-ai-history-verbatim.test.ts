/**
 * Regression guard for the history-redaction fix.
 *
 * Old assistant messages used to be passed through
 * `redactStoreFactsFromAgentText` inside `buildHistoryForModel`, which
 * wiped every sentence containing a digit or a store-fact keyword
 * (phone, address, colour, size, totals). That destroyed confirmed
 * order state and forced the agent to re-ask for data it already had.
 *
 * These tests lock in the new behaviour:
 *   - assistant history is passed VERBATIM, no matter how old
 *   - the redactor still exists and still works for the recall tool
 */
import { describe, it, expect } from "vitest";
import {
  buildHistoryForModel,
  buildRecallTranscript,
  STALE_AGENT_STOCK_TAG,
  RECALL_REDACTION_MARKER,
} from "@/routes/api/chat-ai";


type Row = { role: string; content: string | null };

function longConversation(oldAgentLine: string, turns = 20): Row[] {
  const rows: Row[] = [
    { role: "user", content: "السلام عليكم" },
    { role: "assistant", content: oldAgentLine },
  ];
  for (let i = 0; i < turns; i++) {
    rows.push({ role: "user", content: `رسالة ${i}` });
    rows.push({ role: "assistant", content: `رد ${i}` });
  }
  rows.push({ role: "user", content: "تمام كمل الطلب" });
  return rows;
}

describe("buildHistoryForModel — assistant history stays verbatim", () => {
  const confirmed =
    "تمام يا فندم، سجلت الطلب: هودي بيج مقاس L، الموبايل 01001234567، العنوان شارع 9 المعادي، الإجمالي 890 جنيه.";

  it("keeps a very old assistant message with numbers and store keywords untouched", () => {
    const out = buildHistoryForModel(longConversation(confirmed));
    const first = out[1];

    expect(first.role).toBe("assistant");
    // Text is untouched; only the structural expiry tag is appended.
    expect(first.content).toBe(`${confirmed}\n\n${STALE_AGENT_STOCK_TAG}`);
  });

  it("tags EVERY prior agent reply by position, with no keyword matching", () => {
    const rows = longConversation(confirmed);
    const out = buildHistoryForModel(rows);

    for (let i = 0; i < rows.length; i++) {
      const content = typeof out[i].content === "string" ? (out[i].content as string) : "";
      if (rows[i].role === "assistant") {
        expect(content).toContain(STALE_AGENT_STOCK_TAG);
      } else {
        expect(content).not.toContain(STALE_AGENT_STOCK_TAG);
      }
    }
  });

  it("never injects the redaction marker into model history", () => {
    const out = buildHistoryForModel(longConversation(confirmed));
    const joined = out
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("\n");

    expect(joined).not.toContain(RECALL_REDACTION_MARKER);
  });

  it("preserves confirmed order details (phone, address, size, total) in old turns", () => {
    const out = buildHistoryForModel(longConversation(confirmed));
    const joined = out
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    expect(joined).toContain("01001234567");
    expect(joined).toContain("شارع 9 المعادي");
    expect(joined).toContain("مقاس L");
    expect(joined).toContain("890");
  });

  it("also keeps recent assistant messages untouched (unchanged behaviour)", () => {
    const rows = longConversation(confirmed);
    const out = buildHistoryForModel(rows);

    expect(out).toHaveLength(rows.length);
    expect(out[out.length - 2].content).toBe(
      `${rows[rows.length - 2].content}\n\n${STALE_AGENT_STOCK_TAG}`,
    );
  });

  it("keeps customer messages intact as before", () => {
    const out = buildHistoryForModel(longConversation(confirmed));

    expect(out[0]).toEqual({ role: "user", content: "السلام عليكم" });
    expect(out[out.length - 1]).toEqual({ role: "user", content: "تمام كمل الطلب" });
  });
});

describe("recall transcript — structural role tagging, no keyword matching", () => {
  it("keeps agent replies verbatim and tags them by role", () => {
    const rows = longConversation("السعر 250 جنيه");
    const transcript = buildRecallTranscript(rows as Array<{ role: string; content: string | null }>);
    const history = buildHistoryForModel(rows)
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");

    expect(transcript).toContain("Agent: السعر 250 جنيه");
    expect(transcript).toContain(STALE_AGENT_STOCK_TAG);
    expect(transcript).not.toContain(RECALL_REDACTION_MARKER);
    expect(history).toContain("السعر 250 جنيه");
  });

  it("preserves collected customer/order data inside recalled agent replies", () => {
    const confirmed =
      "تمام يا فندم، سجلت الطلب: هودي بيج مقاس L، الموبايل 01001234567، العنوان شارع 9 المعادي، الإجمالي 890 جنيه.";
    const transcript = buildRecallTranscript(longConversation(confirmed));

    for (const v of ["01001234567", "شارع 9 المعادي", "مقاس L", "890"]) {
      expect(transcript).toContain(v);
    }
  });

  it("leaves customer messages untagged", () => {
    const transcript = buildRecallTranscript([
      { role: "user", content: "السلام عليكم" },
    ]);
    expect(transcript).toBe("Customer: السلام عليكم");
  });
});


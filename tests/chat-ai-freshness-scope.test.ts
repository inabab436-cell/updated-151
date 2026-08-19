import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Point 3 guard: the freshness directive must be scoped to MUTABLE STORE FACTS
// and must explicitly exempt customer/order data, otherwise the agent re-asks
// the customer for the name/phone/address/size it already has.
const source = readFileSync(
  resolve(__dirname, "../src/routes/api/chat-ai.ts"),
  "utf8",
);

function freshnessDirective(): string {
  const start = source.indexOf("const freshnessDirective =");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(";", start);
  return source.slice(start, end);
}

describe("freshnessDirective scope", () => {
  const directive = freshnessDirective();

  it("scopes the source-of-truth claim to mutable store facts", () => {
    expect(directive).toContain("MUTABLE STORE FACTS ONLY");
  });

  it("orders the model to ignore only stale store facts", () => {
    expect(directive).toContain(
      "تجاهل أي سعر أو كمية أو توفّر أو سياسة ذكرتها سابقًا في هذه المحادثة، واعتمد على FRESH STORE SNAPSHOT وحدها.",
    );
  });

  it("carves out customer and order data explicitly", () => {
    for (const field of [
      "الاسم",
      "الموبايل",
      "العنوان",
      "المقاس",
      "الكمية المختارة",
      "طريقة الدفع",
    ]) {
      expect(directive).toContain(field);
    }
    expect(directive).toContain("ولا يُعاد سؤال العميل عنها");
  });

  it("no longer tells the model to ignore prior conversation wholesale", () => {
    expect(directive).not.toContain(
      "IGNORE and DO NOT REUSE any store fact mentioned earlier",
    );
    expect(directive).not.toContain("Use prior conversation ONLY to remember");
    expect(directive).toContain("Prior conversation REMAINS valid");
  });

  it("keeps the snapshot header and the redaction-marker hint", () => {
    expect(directive).toContain("FRESH STORE SNAPSHOT (authoritative");
    expect(directive).toContain("RECALL_REDACTION_MARKER");
  });
});
